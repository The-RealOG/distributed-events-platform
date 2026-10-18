import type { DomainEvent } from '@dpp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import type { DbTransaction } from './outbox.js';

/**
 * Idempotent event consumption (ADR-013).
 *
 * Kafka delivers at least once (the outbox republishes after a crash between ack and mark; a
 * consumer that dies before committing its offset is sent the message again). A logical
 * consumer must still apply each event's side effects once. It does so by recording
 * (consumerName, eventId) in processed_events in the SAME transaction as the side effects:
 *
 *   BEGIN
 *     INSERT processed_events (consumer, eventId) ON CONFLICT DO NOTHING
 *     no row inserted → already processed: COMMIT nothing, report 'duplicate'
 *     row inserted    → apply side effects (same transaction)
 *   COMMIT                         ← effects + marker become visible together
 *   (then the caller lets Kafka commit the offset)
 *
 * - Crash before COMMIT: nothing persists (no effects, no marker); the redelivery processes it.
 * - COMMIT, then the offset commit is lost: the redelivery finds the marker; effects are not
 *   repeated.
 * - Two replicas race on the same event: the second INSERT waits on the first's uncommitted
 *   unique-key entry. If the first commits, the second sees a conflict and reports a
 *   duplicate; if the first rolls back, the second proceeds. The unique key, not a prior
 *   SELECT, decides, so there is no check-then-act window.
 * - Handler throws: the transaction rolls back, taking the marker with it, and the error
 *   propagates so the offset is not committed.
 *
 * This covers side effects in PostgreSQL. Effects elsewhere (sending email, calling an API)
 * need their own idempotency key; the marker cannot make them atomic.
 */

export type ProcessOutcome = 'processed' | 'duplicate';

/**
 * A logical consumer's stable name: the service's role, shared by all its replicas and
 * restarts (and also its Kafka consumer group). Never a hostname, task ID or random value:
 * each replica would then be a "different consumer" and every duplicate would be processed.
 */
export const CONSUMER_NAME = /^[a-z][a-z0-9-]{1,62}$/;

export function assertConsumerName(name: string): string {
  if (!CONSUMER_NAME.test(name)) {
    throw new Error(`invalid consumer name ${JSON.stringify(name)}: expected ${CONSUMER_NAME}`);
  }
  return name;
}

export async function processEventOnce(
  db: Database,
  input: { consumerName: string; event: Pick<DomainEvent, 'eventId' | 'eventType'> },
  work: (tx: DbTransaction) => Promise<void>,
): Promise<ProcessOutcome> {
  const consumerName = assertConsumerName(input.consumerName);
  return db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      INSERT INTO processed_events (consumer_name, event_id, event_type)
      VALUES (${consumerName}, ${input.event.eventId}, ${input.event.eventType})
      ON CONFLICT (consumer_name, event_id) DO NOTHING
      RETURNING 1
    `);
    if (claimed.rows.length === 0) return 'duplicate';
    await work(tx);
    return 'processed';
  });
}

/** Whether this consumer has committed its side effects for this event. */
export async function isEventProcessed(
  db: Database,
  consumerName: string,
  eventId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM processed_events WHERE consumer_name = ${consumerName} AND event_id = ${eventId}
  `);
  return result.rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Kafka glue. Structural types keep this package free of a Kafka dependency; the result plugs
// into DomainEventConsumer's `handler`.

/** The part of a message's coordinates used for logging. */
export interface DeliveryMetadata {
  topic: string;
  partition: number;
  offset: string;
}

interface LogFn {
  (obj: object, msg: string): void;
}
export interface ConsumerLogger {
  child(bindings: Record<string, unknown>): ConsumerLogger;
  debug: LogFn;
  info: LogFn;
  error: LogFn;
}

export type ConsumerOutcome = ProcessOutcome | 'failed';

export interface IdempotentHandlerOptions {
  db: Database;
  consumerName: string;
  logger: ConsumerLogger;
  /** The side effects. Must write only through `tx` for the once-only guarantee to hold. */
  handle: (event: DomainEvent, tx: DbTransaction, metadata: DeliveryMetadata) => Promise<void>;
  /** Counting hook (processed / duplicate / failed), wired to Prometheus by the services. */
  onOutcome?: (outcome: ConsumerOutcome, event: DomainEvent, durationMs: number) => void;
}

/**
 * Wraps a side-effect function as a duplicate-safe DomainEventConsumer handler. It resolves
 * only after the transaction committed (or the event proved a duplicate), and DomainEventConsumer
 * marks the offset only after the handler resolves: the database commit always precedes the
 * offset commit. A thrown error rolls back and propagates, so Kafka redelivers.
 */
export function createIdempotentHandler(options: IdempotentHandlerOptions) {
  const consumerName = assertConsumerName(options.consumerName);
  const logger = options.logger.child({ consumer: consumerName });
  return async (event: DomainEvent, metadata: DeliveryMetadata): Promise<void> => {
    const log = logger.child({
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      projectId: event.payload.projectId,
      topic: metadata.topic,
      partition: metadata.partition,
      offset: metadata.offset,
    });
    const started = performance.now();
    let outcome: ProcessOutcome;
    try {
      outcome = await processEventOnce(options.db, { consumerName, event }, (tx) =>
        options.handle(event, tx, metadata),
      );
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      options.onOutcome?.('failed', event, durationMs);
      // The payload is not logged: it can be large and user-authored.
      log.error({ err, durationMs }, 'event processing failed; rolled back, will be redelivered');
      throw err;
    }
    const durationMs = Math.round(performance.now() - started);
    options.onOutcome?.(outcome, event, durationMs);
    if (outcome === 'duplicate') log.info({ durationMs }, 'duplicate event skipped');
    else log.info({ durationMs }, 'event processed');
  };
}
