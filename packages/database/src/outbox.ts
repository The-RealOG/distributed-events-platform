import { partitionKeyOf, type DomainEvent } from '@dpp/contracts';
import { sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import type * as schema from './schema.js';
import { outboxEvents } from './schema.js';

/**
 * An open transaction. The request-side outbox insert accepts only this type, so writing an
 * event outside the transaction of the change it describes does not compile by accident.
 */
export type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

// ---------------------------------------------------------------------------------------------
// Request side (Project Service): the only outbox operation allowed in the transactional path.

/** Records an event in the caller's transaction. It commits or rolls back with the change. */
export async function insertOutboxEvent(tx: DbTransaction, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({
    eventId: event.eventId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    partitionKey: partitionKeyOf(event),
    correlationId: event.correlationId,
    schemaVersion: event.schemaVersion,
    event,
  });
}

// ---------------------------------------------------------------------------------------------
// Publisher side (Outbox Publisher only). Each function is one short statement/transaction;
// none of them is held open across a Kafka call.

export interface ClaimedOutboxEvent {
  sequenceId: bigint;
  eventId: string;
  eventType: string;
  partitionKey: string;
  correlationId: string;
  attemptCount: number;
  createdAt: Date;
  event: DomainEvent;
  /** The row's lease had expired (its previous owner crashed or stalled): a stale-claim recovery. */
  recoveredFromStaleClaim: boolean;
}

interface ClaimedRow extends Record<string, unknown> {
  sequence_id: string;
  event_id: string;
  event_type: string;
  partition_key: string;
  correlation_id: string;
  attempt_count: number;
  created_at: Date | string;
  event: DomainEvent;
  previous_owner: string | null;
}

/**
 * Leases up to `limit` publishable events to `workerId` for `leaseMs`, in sequence order.
 *
 * An event is publishable when it is unpublished, its retry time has come, it is not under a
 * live lease, and it is the oldest unpublished event for its partition key. That last rule
 * keeps one project's events strictly in sequence even with several publishers: its next event
 * only becomes claimable once the previous one is published. A batch therefore holds at most one
 * event per project.
 *
 * FOR UPDATE SKIP LOCKED makes concurrent claimers skip rows another claimer is taking right now;
 * the lease (committed immediately) keeps them skipping afterwards while the owner publishes.
 */
export async function claimOutboxBatch(
  db: DbExecutor,
  options: { workerId: string; limit: number; leaseMs: number },
): Promise<ClaimedOutboxEvent[]> {
  // A locking CTE rather than UPDATE … WHERE IN (…) so the previous owner can be returned:
  // RETURNING only sees new values, and a non-null previous owner means a stale lease.
  const result = await db.execute<ClaimedRow>(sql`
    WITH picked AS (
      SELECT c.sequence_id, c.claimed_by AS previous_owner
      FROM outbox_events AS c
      WHERE c.published_at IS NULL
        AND c.next_attempt_at <= now()
        AND (c.claimed_until IS NULL OR c.claimed_until < now())
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events AS earlier
          WHERE earlier.partition_key = c.partition_key
            AND earlier.published_at IS NULL
            AND earlier.sequence_id < c.sequence_id
        )
      ORDER BY c.sequence_id
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events AS o
    SET claimed_by = ${options.workerId},
        claimed_until = now() + make_interval(secs => ${options.leaseMs / 1000})
    FROM picked
    WHERE o.sequence_id = picked.sequence_id
    RETURNING o.sequence_id, o.event_id, o.event_type, o.partition_key, o.correlation_id,
              o.attempt_count, o.created_at, o.event, picked.previous_owner
  `);
  return result.rows
    .map((row) => ({
      sequenceId: BigInt(row.sequence_id),
      eventId: row.event_id,
      eventType: row.event_type,
      partitionKey: row.partition_key,
      correlationId: row.correlation_id,
      attemptCount: row.attempt_count,
      createdAt: new Date(row.created_at),
      event: row.event,
      recoveredFromStaleClaim: row.previous_owner !== null,
    }))
    .sort((a, b) => (a.sequenceId < b.sequenceId ? -1 : 1));
}

/**
 * Marks an event published. Call only after Kafka acknowledged it. Deliberately not conditioned
 * on the lease: if the lease expired and another worker also published it, the event is in
 * Kafka twice (an expected at-least-once duplicate), and either marker is true.
 */
export async function markOutboxPublished(db: DbExecutor, sequenceId: bigint): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE outbox_events
    SET published_at = now(), claimed_by = NULL, claimed_until = NULL
    WHERE sequence_id = ${sequenceId} AND published_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

const MAX_ERROR_LENGTH = 500;

/** One line, bounded, no stack trace: last_error is operational metadata, not a log. */
export function sanitizeOutboxError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? ` (cause: ${error.cause.message})`
      : '';
  return `${message}${cause}`.replace(/\s+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

/** Records a failed attempt, schedules the retry and releases the lease. Owner-checked. */
export async function recordOutboxFailure(
  db: DbExecutor,
  options: { sequenceId: bigint; workerId: string; error: unknown; retryAfterMs: number },
): Promise<void> {
  await db.execute(sql`
    UPDATE outbox_events
    SET attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        last_error = ${sanitizeOutboxError(options.error)},
        next_attempt_at = now() + make_interval(secs => ${options.retryAfterMs / 1000}),
        claimed_by = NULL,
        claimed_until = NULL
    WHERE sequence_id = ${options.sequenceId}
      AND claimed_by = ${options.workerId}
      AND published_at IS NULL
  `);
}

/** Gives back leases this worker still holds (unpublished rows), e.g. on shutdown. */
export async function releaseOutboxClaims(
  db: DbExecutor,
  workerId: string,
  sequenceIds?: bigint[],
): Promise<number> {
  const only =
    sequenceIds === undefined
      ? sql``
      : sql`AND sequence_id = ANY(${`{${sequenceIds.join(',')}}`}::bigint[])`;
  const result = await db.execute(sql`
    UPDATE outbox_events SET claimed_by = NULL, claimed_until = NULL
    WHERE claimed_by = ${workerId} AND published_at IS NULL ${only}
  `);
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics (scripts/outbox, logs).

export interface OutboxStatus {
  pending: number;
  pendingClaimed: number;
  pendingWithFailures: number;
  oldestPendingAgeSeconds: number | null;
  published: number;
}

export async function outboxStatus(db: DbExecutor): Promise<OutboxStatus> {
  const result = await db.execute<Record<string, string | null>>(sql`
    SELECT
      count(*) FILTER (WHERE published_at IS NULL) AS pending,
      count(*) FILTER (WHERE published_at IS NULL AND claimed_until > now()) AS pending_claimed,
      count(*) FILTER (WHERE published_at IS NULL AND attempt_count > 0) AS pending_with_failures,
      extract(epoch FROM now() - min(created_at) FILTER (WHERE published_at IS NULL)) AS oldest_age,
      count(*) FILTER (WHERE published_at IS NOT NULL) AS published
    FROM outbox_events
  `);
  const row = result.rows[0] ?? {};
  const num = (v: string | null | undefined) => Number(v ?? 0);
  return {
    pending: num(row['pending']),
    pendingClaimed: num(row['pending_claimed']),
    pendingWithFailures: num(row['pending_with_failures']),
    oldestPendingAgeSeconds:
      row['oldest_age'] == null ? null : Math.round(Number(row['oldest_age'])),
    published: num(row['published']),
  };
}

export async function outboxRecent(
  db: DbExecutor,
  options: { kind: 'published' | 'pending' | 'failing'; limit: number },
) {
  const where =
    options.kind === 'published'
      ? sql`published_at IS NOT NULL`
      : options.kind === 'pending'
        ? sql`published_at IS NULL`
        : sql`published_at IS NULL AND attempt_count > 0`;
  const order = options.kind === 'published' ? sql`published_at DESC` : sql`sequence_id ASC`;
  const result = await db.execute(sql`
    SELECT sequence_id::text, event_id, event_type, partition_key, correlation_id,
           aggregate_id, aggregate_version, created_at, published_at,
           round(extract(epoch FROM published_at - created_at) * 1000) AS publish_latency_ms,
           attempt_count, last_attempt_at, next_attempt_at, last_error, claimed_by, claimed_until
    FROM outbox_events WHERE ${where} ORDER BY ${order} LIMIT ${options.limit}
  `);
  return result.rows;
}
