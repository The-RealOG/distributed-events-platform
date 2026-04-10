# ADR-011: Transactional outbox for PostgreSQL-to-Kafka delivery

**Status:** Accepted (Phase 4)

## Context

Every task and comment change in PostgreSQL must also reach Kafka as a domain event (ADR-010),
for activity history, realtime updates and cache invalidation. PostgreSQL and Kafka cannot share
one atomic transaction.

## Problem: the dual write

```ts
await db.update(task); // commits
await kafka.send(event); // Kafka down, process dies, timeout…
```

If the send fails after the commit, the change is permanent and its event is lost. Every
downstream view silently misses it forever. Reversing the order is also wrong: if the send
succeeds and the transaction then rolls back, consumers act on a change that never happened.
Retrying the send inside the request makes user writes depend on Kafka availability, and
still loses the event if the process dies between the commit and the send.

## Decision

1. **Write the event in the same transaction as the change.** Every task/comment mutation in
   the Project Service inserts one row into `outbox_events` using the transaction handle of the
   change (`insertOutboxEvent(tx, event)`, which only accepts a transaction by type). Both commit
   or neither does. The HTTP request succeeds when that transaction commits. It never waits
   for Kafka or for publication.
2. **Publish from a separate process.** `apps/outbox-publisher` reads committed outbox rows,
   sends them to Kafka and marks them published. It owns no domain state and has its own
   lifecycle, scaling and failure domain. The Project Service does not depend on it or on Kafka.

**The outbox guarantees that a committed domain change has a durable event awaiting
publication. It does not guarantee that Kafka receives each event exactly once.**

### Row design

The complete `DomainEvent` built during the transaction is stored in `event` (JSONB). The
publisher sends those bytes unchanged, so `eventId`, `occurredAt` and `correlationId` are fixed at
commit time and identical on every retry and republish. A few envelope fields are copied into
columns because the publisher's queries or diagnostics use them: `partition_key` (ordering and
the Kafka key), `event_id` (unique), `correlation_id`, `aggregate_*` and `event_type`. Operational
columns: `published_at`, `attempt_count`, `last_attempt_at`, `last_error` (one line, ≤500 chars),
`next_attempt_at`, `claimed_by`, `claimed_until`.

`sequence_id` (a `BIGINT` identity) is the **publication order**. `event_id` (UUID) is the event's
**global identity**. They solve different problems: UUIDs carry no order, and timestamps cannot
separate concurrent inserts. The sequence is never exposed as the event's identity.

Indexes exist only for real queries: `(sequence_id) WHERE published_at IS NULL` for the claim
scan, and `(partition_key, sequence_id) WHERE published_at IS NULL` for the "is there an earlier
unpublished event for this key?" check. Both are partial, so they stay small as published rows
accumulate.

### Claiming: short transactions and leases, no locks during network I/O

A cycle is:

1. **Claim** (one short statement): `UPDATE … SET claimed_by = me, claimed_until = now() + lease
WHERE sequence_id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)`, which commits immediately.
   Eligible rows are unpublished, have `next_attempt_at <= now()`, have no live lease, and **are
   the oldest unpublished event for their partition key**.
2. **Send** each claimed event with no database transaction open.
3. **Mark** each event with `published_at = now()` in its own statement, only after Kafka
   acknowledged it (`acks=-1`).

`SKIP LOCKED` stops two concurrent claimers from taking the same row at the same instant. The
committed lease keeps other workers away while the owner publishes. A crashed worker's lease
expires (`OUTBOX_LEASE_MS`, default 60 s), so its rows become claimable again. Graceful shutdown
releases unsent leases at once. The lease must be longer than the longest publish attempt; if it
expires mid-send, another worker may republish, which is a duplicate, never a loss.

Alternatives: holding `SELECT … FOR UPDATE` across the Kafka call is simpler, but it pins a
connection and row locks for the whole duration of a network call (up to ~15 s during an
outage), and pool exhaustion then spreads to other work. A single-publisher design with no
claims would make scaling and failover a manual operation.

### Ordering

Per partition key (project), events are published in `sequence_id` order, which is the order
their transactions inserted them. The head-of-line rule means a project's next event is not
claimable until the previous one is published. With any number of publishers, one project's
events are never in flight concurrently and cannot overtake each other; a batch holds at most one
event per project. Kafka then preserves that order within the key's partition. **No order is
promised across projects.**

Two caveats, both documented and tested:

- **Commit order vs. sequence order.** Identity values are assigned at insert, not at commit.
  Two concurrent transactions touching the same project can commit in the other order than their
  sequence values. The publisher only sees committed rows, so a later-sequence row can be
  published before an earlier-sequence row commits. Where it matters (the same task), optimistic
  concurrency serializes writers anyway, because the second writer blocks on the row lock and
  commits after the first. For unrelated tasks in one project, the order between them is simply
  the order in which they became visible.
- **Head-of-line blocking.** An event that keeps failing holds back later events of **its
  project only**. Other projects keep flowing. Phase 9 adds a dead-letter policy for events that
  can never be published.

### Retries: two layers, both bounded

1. **Inside one attempt:** KafkaJS retries transient errors (4 retries, 250 ms to 2 s, about 4 s
   total) before `publish()` rejects.
2. **Across attempts:** the row gets `attempt_count += 1`, `last_error`, and
   `next_attempt_at = now + delay`, with

   ```
   ceiling = min(OUTBOX_BACKOFF_MAX_MS, OUTBOX_BACKOFF_BASE_MS × 2^(attempt − 1))
   delay   = ceiling/2 + random × ceiling/2        (equal jitter; defaults 1 s … 60 s)
   ```

   A failure that means Kafka is unreachable (anything except an invalid or oversized event)
   stops the rest of the batch. Those rows are released untouched and the worker itself backs off
   with the same formula. So an outage costs one attempt per cycle, not one per row. While events
   are found the worker re-polls at once; it sleeps `OUTBOX_POLL_INTERVAL_MS` only when idle.

No dead-lettering yet: a persistently failing row stays pending with growing backoff. It is
visible via `scripts/outbox failing`, the publisher's `/status`, and `outbox publish failed` logs.

### Delivery semantics: at-least-once

The critical window:

```
send → Kafka acknowledges → publisher dies → published_at never written
```

After the lease expires, another worker (or the restarted one) publishes the **same stored
event** again: the same `eventId` and the same bytes, in a second Kafka record. This is expected and
tested (`crash-and-shutdown.int.test.ts`, "Invariant 5"). Removing the window would need an atomic
commit across Kafka and PostgreSQL, which we don't have. Kafka's transactional producer would cover
only the Kafka side. Instead, **Phase 5 consumers deduplicate on `eventId`**, recording it in the same
database transaction as their side effect.

Tests distinguish two kinds of duplicate:

- **Bad duplicate (a bug):** two healthy workers claim the same row. `SKIP LOCKED` plus leases
  prevent it. Tests: concurrent claims return disjoint sets, and two running publishers deliver
  200 events exactly once each.
- **Expected duplicate:** acknowledged but not marked, then republished.

## Failure windows

| Failure                                               | Outcome                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Outbox insert fails (or anything fails before COMMIT) | whole transaction rolls back: no change, no event; HTTP 500                                              |
| Domain write fails at COMMIT                          | whole transaction rolls back: no event for a change that didn't happen                                   |
| Kafka down                                            | requests unaffected; rows stay pending; attempts recorded with backoff; drains automatically on recovery |
| Publisher down                                        | requests unaffected; rows pending, never attempted; drained after restart                                |
| Publisher dies after claiming, before sending         | lease expires, another worker publishes it; no loss, no duplicate                                        |
| Publisher dies after ack, before marking              | republished with the same eventId (expected duplicate)                                                   |
| PostgreSQL unavailable to the publisher               | cycle fails (client-side query timeout), publisher not ready, backs off, resumes                         |
| Publisher SIGTERM mid-batch                           | in-flight send finishes and is marked; unsent leases released                                            |

## Alternatives considered

- **Dual write with retries in the request.** Loses events on a crash after commit, and couples
  write availability to Kafka.
- **Two-phase commit / XA between PostgreSQL and Kafka.** Kafka doesn't participate in XA, and
  2PC adds blocking failure modes.
- **Change data capture (Debezium on the WAL).** Also correct, and avoids the publisher, but adds
  Kafka Connect and replication-slot operations. Worth revisiting at larger scale. The outbox
  table could be the CDC source.
- **`LISTEN/NOTIFY` to wake the publisher.** An optimization only (notifications aren't durable).
  Polling is enough until measured otherwise (Phase 11).

## Consequences

- Writes succeed while Kafka or the publisher is down. Consumers are eventually consistent,
  and during an outage the lag is the outage.
- Every consumer must be idempotent on `eventId` (Phase 5).
- Published rows accumulate. A retention job (for example, delete rows published more than 7
  days ago) is deferred; kept rows are useful for debugging and publish-latency analysis.
- Every task version has exactly one event. A save that changes nothing writes nothing (no
  version bump, no event), and no-op assignment changes were already silent.

## Relationship to Phase 5

This ADR delivers "every committed change is eventually published at least once, with a
stable `eventId`". Phase 5 adds the other half: consumers record processed `eventId`s in the same
transaction as their side effect, so the duplicates this design permits have no effect.
