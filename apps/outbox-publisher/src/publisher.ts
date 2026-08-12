import { setTimeout as sleep } from 'node:timers/promises';
import type { DomainEvent } from '@dpp/contracts';
import {
  claimOutboxBatch,
  markOutboxPublished,
  recordOutboxFailure,
  releaseOutboxClaims,
  sanitizeOutboxError,
  type ClaimedOutboxEvent,
  type DbExecutor,
} from '@dpp/database';
import type { PublishResult } from '@dpp/kafka';
import type { Logger } from 'pino';
import { computeBackoffMs, type BackoffPolicy } from './backoff.js';
import { classifyPublishFailure } from './classify.js';

/** The part of DomainEventProducer the publisher uses (a real producer in production). */
export interface EventSink {
  connect(): Promise<void>;
  publish(event: DomainEvent, options?: { key?: string }): Promise<PublishResult>;
  close(options?: { drainTimeoutMs?: number; disconnectTimeoutMs?: number }): Promise<void>;
}

/**
 * Fault-injection points, for tests only. They can only be supplied through the constructor by
 * code; there is no environment variable or config path to them, so a deployed publisher
 * (server.ts) cannot enable them. Throwing SimulatedCrash from a hook stops the worker as if the
 * process had died at that instant: no marking, no releasing of claims, no cleanup.
 */
export interface PublisherFaults {
  /** After the row was claimed, before it is sent to Kafka. */
  beforePublish?: (row: ClaimedOutboxEvent) => void | Promise<void>;
  /** After Kafka acknowledged the event, before published_at is written. */
  afterAck?: (row: ClaimedOutboxEvent, result: PublishResult) => void | Promise<void>;
}

export class SimulatedCrash extends Error {
  constructor(where: string) {
    super(`simulated crash ${where}`);
    this.name = 'SimulatedCrash';
  }
}

export interface OutboxPublisherOptions {
  db: DbExecutor;
  sink: EventSink;
  logger: Logger;
  workerId: string;
  batchSize: number;
  pollIntervalMs: number;
  leaseMs: number;
  backoff: BackoffPolicy;
  faults?: PublisherFaults;
  random?: () => number;
  observer?: PublisherObserver;
}

/** Counting hooks for metrics (server.ts wires them to Prometheus). */
export interface PublisherObserver {
  /** Kafka acknowledged the event; latency = commit (created_at) → acknowledgement. */
  published(latencyMs: number, attempts: number): void;
  failed(kind: string): void;
  staleClaimRecovered(): void;
}

export interface CycleResult {
  claimed: number;
  published: number;
  failed: number;
  /** The cycle stopped early (Kafka unreachable, or the database failed); back off. */
  aborted: boolean;
}

/**
 * Moves events from outbox_events to Kafka. At-least-once: an event is marked published only
 * after Kafka acknowledged it, so a crash between the acknowledgement and the marker republishes
 * the same event (same eventId) later. Nothing here can lose a committed event: until
 * published_at is set, the row stays eligible.
 *
 * Each cycle: claim a batch (short transaction, leases rows), then for each row in sequence
 * order: send → on ack mark published (short statement). No database transaction or row lock
 * is held while waiting on Kafka.
 */
export class OutboxPublisher {
  readonly #o: OutboxPublisherOptions;
  readonly #log: Logger;
  readonly #wake = new AbortController();
  #loop: Promise<void> | undefined;
  #stopping = false;
  #crashed = false;
  #sinkConnected = false;
  #kafkaReachable = false;
  #databaseReachable = false;
  #consecutiveAborts = 0;

  constructor(options: OutboxPublisherOptions) {
    this.#o = options;
    this.#log = options.logger.child({ component: 'outbox-publisher', workerId: options.workerId });
  }

  /** Useful work is possible: running, database reachable, and Kafka accepting publishes. */
  get ready(): boolean {
    return !this.#stopping && !this.#crashed && this.#databaseReachable && this.#kafkaReachable;
  }

  get crashed(): boolean {
    return this.#crashed;
  }

  start(): void {
    this.#loop ??= this.#run();
  }

  async #run(): Promise<void> {
    while (!this.#stopping) {
      let result: CycleResult;
      try {
        result = await this.runOnce();
        this.#databaseReachable = true;
      } catch (err) {
        if (err instanceof SimulatedCrash) {
          this.#crashed = true;
          this.#log.warn({ err }, 'simulated crash: worker stopped without cleanup');
          return;
        }
        this.#databaseReachable = false;
        this.#log.error({ err: sanitizeOutboxError(err) }, 'outbox cycle failed');
        result = { claimed: 0, published: 0, failed: 0, aborted: true };
      }
      if (this.#stopping) break;

      let delayMs: number;
      if (result.aborted) {
        this.#consecutiveAborts++;
        delayMs = computeBackoffMs(this.#consecutiveAborts, this.#o.backoff, this.#o.random);
        this.#log.warn({ delayMs, consecutiveFailures: this.#consecutiveAborts }, 'backing off');
      } else {
        this.#consecutiveAborts = 0;
        // Keep draining while there is work; sleep only when idle.
        delayMs = result.claimed > 0 ? 0 : this.#o.pollIntervalMs;
      }
      if (delayMs > 0) {
        await sleep(delayMs, undefined, { signal: this.#wake.signal }).catch(() => undefined);
      }
    }
  }

  /** One claim/publish cycle. Exposed for deterministic tests. */
  async runOnce(): Promise<CycleResult> {
    const result: CycleResult = { claimed: 0, published: 0, failed: 0, aborted: false };

    if (!this.#sinkConnected) {
      try {
        await this.#o.sink.connect();
        this.#sinkConnected = true;
        // Reachable until a publish says otherwise: an idle publisher with an empty outbox is
        // ready, not waiting for its first event to prove it.
        this.#kafkaReachable = true;
      } catch (err) {
        // Don't claim rows we cannot publish; nothing is attempted, so nothing is recorded.
        this.#kafkaReachable = false;
        this.#log.warn({ err: sanitizeOutboxError(err) }, 'kafka connect failed');
        return { ...result, aborted: true };
      }
    }

    const batch = await claimOutboxBatch(this.#o.db, {
      workerId: this.#o.workerId,
      limit: this.#o.batchSize,
      leaseMs: this.#o.leaseMs,
    });
    result.claimed = batch.length;
    for (const row of batch)
      if (row.recoveredFromStaleClaim) this.#o.observer?.staleClaimRecovered();

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]!;
      if (this.#stopping) {
        await this.#release(batch.slice(i));
        break;
      }
      const log = this.#log.child({
        eventId: row.eventId,
        eventType: row.eventType,
        correlationId: row.correlationId,
        sequenceId: row.sequenceId.toString(),
      });

      await this.#o.faults?.beforePublish?.(row);

      let published: PublishResult;
      try {
        // The stored event, byte-for-byte as built in the original transaction (same eventId on
        // every attempt), under the partition key stored with it.
        published = await this.#o.sink.publish(row.event, { key: row.partitionKey });
      } catch (err) {
        const attempt = row.attemptCount + 1;
        const retryAfterMs = computeBackoffMs(attempt, this.#o.backoff, this.#o.random);
        const kind = classifyPublishFailure(err);
        await recordOutboxFailure(this.#o.db, {
          sequenceId: row.sequenceId,
          workerId: this.#o.workerId,
          error: err,
          retryAfterMs,
        });
        result.failed++;
        this.#o.observer?.failed(kind);
        log.warn(
          { attempt, retryAfterMs, kind, error: sanitizeOutboxError(err) },
          'outbox publish failed',
        );
        if (kind === 'kafka_unavailable') {
          this.#kafkaReachable = false;
          await this.#release(batch.slice(i + 1));
          return { ...result, aborted: true };
        }
        continue;
      }

      await this.#o.faults?.afterAck?.(row, published);
      // Only now, after the acknowledgement, is the row marked.
      await markOutboxPublished(this.#o.db, row.sequenceId);
      this.#kafkaReachable = true;
      result.published++;
      this.#o.observer?.published(Date.now() - row.createdAt.getTime(), row.attemptCount + 1);
      log.info(
        {
          partition: published.partition,
          offset: published.offset,
          attempts: row.attemptCount + 1,
          latencyMs: Date.now() - row.createdAt.getTime(),
        },
        'outbox event published',
      );
    }
    return result;
  }

  async #release(rows: ClaimedOutboxEvent[]): Promise<void> {
    if (rows.length === 0) return;
    await releaseOutboxClaims(
      this.#o.db,
      this.#o.workerId,
      rows.map((r) => r.sequenceId),
    );
  }

  /**
   * Graceful stop: no new cycles or claims; the event being sent finishes (bounded); leases on
   * unsent rows are released so another replica can take them at once; the producer disconnects.
   */
  async stop({ timeoutMs = 15_000 } = {}): Promise<void> {
    this.#stopping = true;
    this.#wake.abort();
    if (this.#loop) {
      const finished = await Promise.race([
        this.#loop.then(() => true),
        sleep(timeoutMs).then(() => false),
      ]);
      if (!finished) this.#log.warn({ timeoutMs }, 'in-flight outbox work did not finish in time');
    }
    if (!this.#crashed) {
      const released = await releaseOutboxClaims(this.#o.db, this.#o.workerId).catch(
        (err: unknown) => {
          this.#log.warn(
            { err: sanitizeOutboxError(err) },
            'could not release claims; leases will expire',
          );
          return 0;
        },
      );
      if (released > 0) this.#log.info({ released }, 'released outbox claims');
    }
    await this.#o.sink.close({ drainTimeoutMs: 5_000, disconnectTimeoutMs: 5_000 });
  }
}
