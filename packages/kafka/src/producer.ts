import { domainEventSchema, type DomainEvent } from '@dpp/contracts';
import type { Kafka, Producer } from 'kafkajs';
import type { Logger } from 'pino';
import { encodeDomainEvent } from './encoding.js';
import { createPartitioner } from './partitioning.js';
import { TOPICS } from './topics.js';

export interface PublishResult {
  topic: string;
  partition: number;
  offset: string;
  key: string;
}

export class ProducerClosedError extends Error {
  constructor() {
    super('Producer is closing or closed; no new publishes are accepted');
    this.name = 'ProducerClosedError';
  }
}

/** A publish that Kafka did not acknowledge. `cause` is the KafkaJS error. */
export class PublishError extends Error {
  constructor(
    readonly eventId: string,
    cause: unknown,
  ) {
    super(`Failed to publish event ${eventId}`, { cause });
    this.name = 'PublishError';
  }
}

export interface DomainEventProducerOptions {
  kafka: Kafka;
  logger: Logger;
  topic?: string;
}

/**
 * Publishes validated DomainEvents to Kafka.
 *
 * Semantics:
 * - `publish` resolves only after the broker acknowledges with acks=-1 (all in-sync
 *   replicas; with one local broker, that one). Anything else rejects with PublishError.
 * - KafkaJS retries transient send failures itself (see DEFAULT_RETRY). A retry after a lost
 *   acknowledgement can write the message twice, so delivery is at-least-once and consumers
 *   must be idempotent (Phase 5). The idempotent producer is not enabled: KafkaJS documents it
 *   as experimental.
 * - maxInFlightRequests=1, so a retried batch cannot overtake a later one; per-key order
 *   within a partition is preserved across retries.
 * - No application-level retries: the caller (Phase 4: the outbox publisher) decides.
 */
export class DomainEventProducer {
  readonly #producer: Producer;
  readonly #logger: Logger;
  readonly #topic: string;
  readonly #inFlight = new Set<Promise<unknown>>();
  #state: 'new' | 'connected' | 'closing' | 'closed' = 'new';

  constructor(options: DomainEventProducerOptions) {
    this.#producer = options.kafka.producer({
      createPartitioner,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
    });
    this.#logger = options.logger.child({ component: 'event-producer' });
    this.#topic = options.topic ?? TOPICS.domainEvents.name;
  }

  async connect(): Promise<void> {
    await this.#producer.connect();
    this.#state = 'connected';
  }

  /**
   * `key` overrides the partition key derived from the event. The outbox publisher passes the
   * key persisted with the row, so an event keeps the key it was written with even if the
   * derivation (partitionKeyOf) changes between write and publish.
   */
  async publish(event: DomainEvent, options: { key?: string } = {}): Promise<PublishResult> {
    if (this.#state === 'closing' || this.#state === 'closed') throw new ProducerClosedError();
    // Never put an invalid event on the wire, even if the caller bypassed the factories.
    const valid = domainEventSchema.parse(event);
    const encoded = encodeDomainEvent(valid);
    const message = options.key === undefined ? encoded : { ...encoded, key: options.key };
    const log = this.#logger.child({
      eventId: valid.eventId,
      eventType: valid.eventType,
      correlationId: valid.correlationId,
      topic: this.#topic,
      key: message.key,
    });

    const started = performance.now();
    const sending = this.#producer.send({ topic: this.#topic, acks: -1, messages: [message] });
    this.#inFlight.add(sending);
    try {
      const [record] = await sending;
      if (!record) throw new Error('Kafka returned no record metadata');
      const result = {
        topic: record.topicName,
        partition: record.partition,
        offset: record.baseOffset ?? '',
        key: message.key,
      };
      log.info(
        {
          partition: result.partition,
          offset: result.offset,
          durationMs: Math.round(performance.now() - started),
        },
        'event published',
      );
      return result;
    } catch (err) {
      log.error(
        { err, durationMs: Math.round(performance.now() - started) },
        'event publish failed',
      );
      throw new PublishError(valid.eventId, err);
    } finally {
      this.#inFlight.delete(sending);
    }
  }

  /**
   * Stops accepting publishes, waits up to `drainTimeoutMs` for in-flight sends to settle,
   * then disconnects. Disconnect is also bounded so a dead broker cannot block shutdown.
   */
  async close({ drainTimeoutMs = 5_000, disconnectTimeoutMs = 5_000 } = {}): Promise<void> {
    if (this.#state === 'closed') return;
    this.#state = 'closing';
    await withTimeout(Promise.allSettled([...this.#inFlight]), drainTimeoutMs, () =>
      this.#logger.warn({ pending: this.#inFlight.size }, 'producer drain timed out'),
    );
    await withTimeout(this.#producer.disconnect(), disconnectTimeoutMs, () =>
      this.#logger.warn('producer disconnect timed out'),
    );
    this.#state = 'closed';
  }
}

export async function withTimeout(promise: Promise<unknown>, ms: number, onTimeout: () => void) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    const outcome = await Promise.race([
      promise.then(
        () => 'done' as const,
        () => 'done' as const,
      ),
      timeout,
    ]);
    if (outcome === 'timeout') onTimeout();
  } finally {
    clearTimeout(timer);
  }
}
