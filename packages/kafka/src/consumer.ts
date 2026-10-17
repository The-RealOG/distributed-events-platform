import { decodeDomainEvent, type DomainEvent, type EventParseFailure } from '@dpp/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Consumer, EachMessagePayload, Kafka, Producer } from 'kafkajs';
import {
  classifyFailure,
  DEFAULT_CONSUMER_RETRY,
  DLQ_RECORD_VERSION,
  rawForDlq,
  retryDelayMs,
  sanitizeError,
  type DlqRecord,
  type FailureKind,
  type RetryPolicy,
} from './failures.js';
import { TOPICS } from './topics.js';
import type { Logger } from 'pino';
import { headersToStrings } from './encoding.js';
import { withTimeout } from './producer.js';

/** Where a message came from. Offsets are strings because they can exceed 2^53. */
export interface MessageMetadata {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  headers: Record<string, string>;
  consumerGroup: string;
}

export type EventHandler = (event: DomainEvent, metadata: MessageMetadata) => Promise<void>;

export interface ConsumerHooks {
  /** A message that failed decoding/validation and was skipped (see malformed-message policy). */
  onInvalidMessage?: (failure: EventParseFailure, metadata: MessageMetadata) => void;
  onProcessed?: (event: DomainEvent, metadata: MessageMetadata, durationMs: number) => void;
  /** A failed attempt that will be retried in-process. */
  onRetry?: (kind: FailureKind, attempt: number, delayMs: number) => void;
  /** A message written to the DLQ (and then acknowledged). */
  onDeadLetter?: (category: DlqRecord['category']) => void;
  /** Writing to the DLQ failed; the message stays unacknowledged. */
  onDeadLetterFailure?: () => void;
}

export interface DomainEventConsumerOptions {
  kafka: Kafka;
  logger: Logger;
  /**
   * One group per logical consumer (activity-service, realtime-service, …). Replicas of the
   * same service share it and split the partitions; different services use different groups
   * and each receive every event.
   */
  groupId: string;
  topics: string[];
  handler: EventHandler;
  /**
   * Where a *new* group starts (no committed offsets yet). Services start from the beginning
   * so events published before their first deployment are not missed. Existing groups always
   * resume from their committed offsets.
   */
  fromBeginning?: boolean;
  hooks?: ConsumerHooks;
  sessionTimeoutMs?: number;
  /**
   * Longest time a fetch waits on the broker for new data. stop() waits for the fetch in flight,
   * so this bounds shutdown (and every rolling deploy) when idle. KafkaJS defaults to 5 s; 1 s
   * costs one idle fetch per second and makes stop() about 1 s instead of 5 s.
   */
  maxWaitTimeMs?: number;
  /**
   * Dead-letter poison and malformed messages to this topic (ADR-019). Without it, handler
   * failures are retried by KafkaJS indefinitely and malformed messages are skipped with a log
   * line.
   */
  deadLetter?: { topic?: string };
  retry?: Partial<RetryPolicy>;
  /** Transient vs permanent; defaults to classifyFailure. */
  classify?: (err: unknown) => FailureKind;
}

/**
 * Consumes and validates DomainEvents.
 *
 * Offsets: KafkaJS auto-commit. An offset is marked consumed only after `handler` resolves,
 * and committed after each batch. A crash between handling and commit redelivers the
 * message: processing is at-least-once, so handlers must be idempotent (processEventOnce in
 * @dpp/database).
 *
 * Malformed messages (bad JSON, bad envelope, unsupported schemaVersion, unknown type, bad
 * payload) never block their partition: with a DLQ they are dead-lettered, without one they are
 * logged with their coordinates and skipped.
 *
 * Handler failures (ADR-019): bounded in-process retries; then poison events go to the DLQ and
 * are acknowledged, while transient failures (and failed DLQ writes) are handed back to KafkaJS
 * unacknowledged, always as a RETRIABLE error, so KafkaJS redelivers from the last committed
 * offset and, when its own retries run out, restarts the consumer. (A non-retriable error, e.g.
 * an MSK authorization failure surfacing from the DLQ producer, would otherwise stop the
 * consumer for good while the process stayed up.) Handlers with side effects wrap them with
 * createIdempotentHandler (@dpp/database, ADR-013) so redeliveries are harmless.
 */
/**
 * What the consumer throws to KafkaJS when a message must be redelivered. Always retriable (see
 * the class comment); the original error is logged, not attached, because KafkaJS decides
 * whether to restart from the innermost `cause`.
 */
export class RedeliverError extends Error {
  readonly retriable = true;
  constructor(message: string) {
    super(message);
    this.name = 'RedeliverError';
  }
}

export class DomainEventConsumer {
  readonly #consumer: Consumer;
  readonly #logger: Logger;
  readonly #options: DomainEventConsumerOptions;
  #assigned: { topic: string; partitions: number[] }[] = [];
  readonly #joinWaiters: (() => void)[] = [];
  #joined = false;
  #crashed = false;
  #stopping = false;
  readonly #retry: RetryPolicy;
  readonly #dlqProducer: Producer | undefined;

  constructor(options: DomainEventConsumerOptions) {
    this.#options = options;
    this.#retry = { ...DEFAULT_CONSUMER_RETRY, ...options.retry };
    this.#dlqProducer = options.deadLetter
      ? options.kafka.producer({ allowAutoTopicCreation: false, maxInFlightRequests: 1 })
      : undefined;
    this.#logger = options.logger.child({
      component: 'event-consumer',
      consumerGroup: options.groupId,
    });
    this.#consumer = options.kafka.consumer({
      groupId: options.groupId,
      allowAutoTopicCreation: false,
      sessionTimeout: options.sessionTimeoutMs ?? 30_000,
      maxWaitTimeInMs: options.maxWaitTimeMs ?? 1_000,
    });
    this.#consumer.on(this.#consumer.events.CRASH, ({ payload }) => {
      if (!payload.restart) this.#crashed = true;
      this.#logger.error({ err: payload.error, restart: payload.restart }, 'consumer crashed');
    });
    this.#consumer.on(this.#consumer.events.STOP, () => {
      this.#joined = false;
    });
    this.#consumer.on(this.#consumer.events.GROUP_JOIN, ({ payload }) => {
      this.#assigned = Object.entries(payload.memberAssignment).map(([topic, partitions]) => ({
        topic,
        partitions: [...partitions].sort(),
      }));
      this.#joined = true;
      this.#crashed = false;
      this.#logger.info({ assignment: this.#assigned }, 'joined consumer group');
      this.#joinWaiters.splice(0).forEach((resolve) => resolve());
    });
  }

  /** Crashed and KafkaJS will not restart it: the process should be replaced (liveness). */
  get crashed(): boolean {
    return this.#crashed;
  }

  /**
   * In the group and consuming. False before the first join, after stop(), and after a crash
   * KafkaJS will not restart from (it restarts from retriable ones by itself).
   */
  get running(): boolean {
    return this.#joined && !this.#crashed;
  }

  get groupId(): string {
    return this.#options.groupId;
  }

  /** Partitions currently assigned to this member (after the latest rebalance). */
  get assignment(): { topic: string; partitions: number[] }[] {
    return this.#assigned;
  }

  /** Resolves on the next successful group join (initial join or rebalance). */
  nextGroupJoin(): Promise<void> {
    return new Promise((resolve) => this.#joinWaiters.push(resolve));
  }

  async start(): Promise<void> {
    this.#stopping = false;
    await this.#dlqProducer?.connect();
    await this.#consumer.connect();
    for (const topic of this.#options.topics) {
      await this.#consumer.subscribe({ topic, fromBeginning: this.#options.fromBeginning ?? true });
    }
    await this.#consumer.run({ autoCommit: true, eachMessage: (payload) => this.#handle(payload) });
  }

  /**
   * Stops fetching, waits for the message in progress to finish, commits offsets and leaves
   * the group (so partitions are reassigned promptly). Bounded so an unreachable broker cannot
   * hang shutdown.
   */
  async stop({ timeoutMs = 10_000 } = {}): Promise<void> {
    // In-process retry loops check this and hand the message back unacknowledged.
    this.#stopping = true;
    await withTimeout(this.#consumer.disconnect(), timeoutMs, () =>
      this.#logger.warn({ timeoutMs }, 'consumer disconnect timed out'),
    );
    if (this.#dlqProducer) {
      await withTimeout(this.#dlqProducer.disconnect(), timeoutMs, () =>
        this.#logger.warn({ timeoutMs }, 'dead-letter producer disconnect timed out'),
      );
    }
  }

  async #handle(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const metadata: MessageMetadata = {
      topic,
      partition,
      offset: message.offset,
      key: message.key?.toString() ?? null,
      headers: headersToStrings(message.headers),
      consumerGroup: this.#options.groupId,
    };
    const where = { topic, partition, offset: message.offset, key: metadata.key };
    const source = { topic, partition, offset: message.offset, key: metadata.key };

    const decoded = decodeDomainEvent(message.value);
    if (!decoded.ok) {
      // Diagnostics only: never the raw payload, which may be huge or contain anything.
      const { ok: _ok, ...failure } = decoded;
      const issues = 'issues' in failure ? failure.issues.slice(0, 5) : undefined;
      this.#logger.warn(
        { ...where, ...failure, ...(issues ? { issues } : {}) },
        this.#dlqProducer ? 'malformed event; dead-lettering' : 'skipping malformed event',
      );
      this.#options.hooks?.onInvalidMessage?.(decoded, metadata);
      if (this.#dlqProducer) {
        await this.#deadLetter(
          {
            dlqVersion: DLQ_RECORD_VERSION,
            category: 'malformed',
            consumer: this.#options.groupId,
            error: `${failure.reason}${issues ? `: ${issues.slice(0, 3).join('; ')}` : ''}`.slice(
              0,
              500,
            ),
            attempts: 1,
            failedAt: new Date().toISOString(),
            source,
            ...rawForDlq(message.value),
          },
          where,
        );
      }
      return;
    }

    const { event } = decoded;
    const log = this.#logger.child({
      ...where,
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
    });
    const classify = this.#options.classify ?? classifyFailure;
    for (let attempt = 1; ; attempt++) {
      const started = performance.now();
      try {
        await this.#options.handler(event, metadata);
        const durationMs = Math.round(performance.now() - started);
        log.debug({ durationMs, attempt }, 'event processed');
        this.#options.hooks?.onProcessed?.(event, metadata, durationMs);
        return;
      } catch (err) {
        const kind = classify(err);
        const error = sanitizeError(err);
        const limit =
          kind === 'permanent' ? this.#retry.permanentAttempts : this.#retry.transientAttempts;
        if (attempt >= limit || this.#stopping) {
          if (kind === 'permanent' && this.#dlqProducer && !this.#stopping) {
            log.error(
              { error, attempts: attempt },
              'poison event: retries exhausted; dead-lettering',
            );
            await this.#deadLetter(
              {
                dlqVersion: DLQ_RECORD_VERSION,
                category: 'poison',
                consumer: this.#options.groupId,
                error,
                attempts: attempt,
                failedAt: new Date().toISOString(),
                source,
                event,
              },
              where,
            );
            return; // acknowledged only now that the DLQ has it
          }
          // Transient (or no DLQ, or stopping): not acknowledged. KafkaJS redelivers from the
          // last committed offset, so the event is retried later, in order.
          log.error(
            { error, kind, attempts: attempt },
            'event handler failed; message will be redelivered',
          );
          throw new RedeliverError(`handler failed (${kind}): ${error}`);
        }
        const delayMs = retryDelayMs(attempt, this.#retry);
        log.warn({ error, kind, attempt, delayMs }, 'event handler failed; retrying');
        this.#options.hooks?.onRetry?.(kind, attempt, delayMs);
        // No transaction is open here: each attempt is a fresh handler call. Keep the group
        // session alive while waiting.
        await sleep(delayMs);
        await payload.heartbeat().catch(() => undefined);
      }
    }
  }

  /** Writes to the DLQ and waits for the acknowledgement; throws (no offset commit) if it fails. */
  async #deadLetter(record: DlqRecord, where: Record<string, unknown>): Promise<void> {
    const topic = this.#options.deadLetter?.topic ?? TOPICS.domainEventsDlq.name;
    try {
      await this.#dlqProducer!.send({
        topic,
        acks: -1,
        messages: [
          {
            key: record.source.key,
            value: JSON.stringify(record),
            headers: { 'dlq-category': record.category, 'dlq-consumer': record.consumer },
          },
        ],
      });
    } catch (err) {
      this.#options.hooks?.onDeadLetterFailure?.();
      this.#logger.error(
        { ...where, error: sanitizeError(err) },
        'dead-letter write failed; message left unacknowledged for redelivery',
      );
      throw new RedeliverError(`dead-letter write failed: ${sanitizeError(err)}`);
    }
    this.#options.hooks?.onDeadLetter?.(record.category);
    this.#logger.warn(
      { ...where, category: record.category, dlqTopic: topic },
      'message dead-lettered',
    );
  }
}
