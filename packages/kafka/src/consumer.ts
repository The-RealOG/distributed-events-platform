import { decodeDomainEvent, type DomainEvent, type EventParseFailure } from '@dpp/contracts';
import type { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
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
}

/**
 * Consumes and validates DomainEvents.
 *
 * Offsets: KafkaJS auto-commit. An offset is marked consumed only after `handler` resolves,
 * and committed after each batch. A crash between handling and commit redelivers the
 * message: processing is at-least-once and duplicates are expected (idempotency is Phase 5).
 *
 * Malformed messages (bad JSON, bad envelope, unsupported schemaVersion, unknown type, bad
 * payload) are logged with their coordinates and skipped. Their offset is committed, so one
 * bad message cannot block its partition or loop forever. They are not yet copied to the
 * DLQ (Phase 9).
 *
 * Handler failures are different: the error is logged and rethrown, the offset is not
 * committed, and KafkaJS retries the message (and, when its retries are exhausted, restarts the
 * consumer from the last committed offset). Handlers with side effects wrap them with
 * createIdempotentHandler (@dpp/database, ADR-013) so these redeliveries are harmless. Bounded
 * retries plus a DLQ for poison messages arrive in Phase 9.
 */
export class DomainEventConsumer {
  readonly #consumer: Consumer;
  readonly #logger: Logger;
  readonly #options: DomainEventConsumerOptions;
  #assigned: { topic: string; partitions: number[] }[] = [];
  readonly #joinWaiters: (() => void)[] = [];
  #joined = false;
  #crashed = false;

  constructor(options: DomainEventConsumerOptions) {
    this.#options = options;
    this.#logger = options.logger.child({
      component: 'event-consumer',
      consumerGroup: options.groupId,
    });
    this.#consumer = options.kafka.consumer({
      groupId: options.groupId,
      allowAutoTopicCreation: false,
      sessionTimeout: options.sessionTimeoutMs ?? 30_000,
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
    await withTimeout(this.#consumer.disconnect(), timeoutMs, () =>
      this.#logger.warn({ timeoutMs }, 'consumer disconnect timed out'),
    );
  }

  async #handle({ topic, partition, message }: EachMessagePayload): Promise<void> {
    const metadata: MessageMetadata = {
      topic,
      partition,
      offset: message.offset,
      key: message.key?.toString() ?? null,
      headers: headersToStrings(message.headers),
      consumerGroup: this.#options.groupId,
    };
    const where = { topic, partition, offset: message.offset, key: metadata.key };

    const decoded = decodeDomainEvent(message.value);
    if (!decoded.ok) {
      // Diagnostics only: never the raw payload, which may be huge or contain anything.
      const { ok: _ok, ...failure } = decoded;
      const issues = 'issues' in failure ? failure.issues.slice(0, 5) : undefined;
      this.#logger.warn(
        { ...where, ...failure, ...(issues ? { issues } : {}) },
        'skipping malformed event',
      );
      this.#options.hooks?.onInvalidMessage?.(decoded, metadata);
      return;
    }

    const { event } = decoded;
    const log = this.#logger.child({
      ...where,
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
    });
    const started = performance.now();
    try {
      await this.#options.handler(event, metadata);
    } catch (err) {
      log.error({ err }, 'event handler failed; message will be redelivered');
      throw err;
    }
    const durationMs = Math.round(performance.now() - started);
    log.debug({ durationMs }, 'event processed');
    this.#options.hooks?.onProcessed?.(event, metadata, durationMs);
  }
}
