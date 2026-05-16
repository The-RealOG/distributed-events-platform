# ADR-013: Idempotent Kafka consumers

**Status:** Accepted (Phase 5)

## Context

Delivery is at least once at both ends of Kafka:

- **Publication (ADR-011).** The outbox publisher marks an event published only after Kafka
  acknowledges it. A crash between the acknowledgement and the marker republishes the same
  event, with the same `eventId`. Kafka can hold `E123, E123`.
- **Consumption.** A consumer's offset is committed after its handler finishes. A crash, rebalance
  or lost commit between "handled" and "offset committed" makes Kafka deliver the message again.

Exactly-once across PostgreSQL and Kafka would need a distributed transaction between them,
which Kafka does not offer. Kafka transactions cover Kafka-to-Kafka only. So duplicates are
normal input, and every consumer with side effects has to make them harmless.

## Decision

### The marker commits with the side effects

Each logical consumer records the events whose side effects have committed in
`processed_events`. The marker is written **in the same PostgreSQL transaction** as those side
effects:

```
BEGIN
  INSERT INTO processed_events (consumer_name, event_id, …) ON CONFLICT DO NOTHING RETURNING 1
  no row  → already processed: nothing to do        → 'duplicate'
  row     → apply side effects with the same transaction
COMMIT                                               → 'processed'
then Kafka commits the offset
```

| Failure                                 | Result                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Crash before COMMIT                     | Nothing persists, neither effects nor marker. The redelivery processes the event.      |
| COMMIT succeeded, offset commit lost    | The redelivery finds the marker and skips. Effects are not repeated.                   |
| Handler throws                          | Rollback removes the marker too. The error propagates, so the offset is not committed. |
| Two replicas get the same event at once | See below. One applies it, the other skips.                                            |
| Same event, different logical consumers | Each has its own marker and each processes it once.                                    |

### The unique key decides, not a prior SELECT

The claim is the INSERT itself, not "SELECT marker; if absent, process; INSERT". A second
transaction inserting the same `(consumer_name, event_id)` **waits** on the first one's
uncommitted key:

- If the first commits, the second's insert conflicts and it reports a duplicate without
  running the handler.
- If the first rolls back, the second's insert succeeds and it processes the event.

A check-then-act version would let both see "absent" and both apply the effects. The deliberate
break `p5-06` proves the tests catch that.

### Unique per (consumer, event), not per event

`PRIMARY KEY (consumer_name, event_id)`. The activity log, the cache invalidator and the
realtime fan-out each need to process every event once. A global `UNIQUE(event_id)` would let
the first consumer silently suppress all the others.

### Consumer identity is the logical service, never the instance

`consumer_name` is the service's role, for example `activity-service`. All replicas and restarts
share it, and it is also the Kafka consumer group. A host, task ID or random value would make
each replica a "different consumer", and every duplicate would be processed again. This is
enforced in two places:

- in code, by `assertConsumerName` (`^[a-z][a-z0-9-]{1,62}$`)
- in the database, by a CHECK constraint that rejects host-style names

Nothing can stop someone from appending a random suffix, so it is also documented here and
covered by a test (break `p5-02`).

### Offset ordering

`DomainEventConsumer` (KafkaJS auto-commit) resolves a message's offset only after the handler
returns, and the handler returns only after COMMIT. So the database commit always precedes the
offset commit. Committing the offset first would lose events on a crash (break `p5-05`).

### A primitive, not a framework

`@dpp/database` provides:

- `processEventOnce(db, { consumerName, event }, work)`, the transaction above
- `createIdempotentHandler({ db, consumerName, logger, handle, onOutcome })`, which adapts it to
  a `DomainEventConsumer` handler

The wrapper logs the consumer, `eventId`, `eventType`, `correlationId`, topic, partition, offset
and duration, never the payload. It reports `processed` / `duplicate` / `failed` through
`onOutcome`, ready for metrics in Phase 10. Its structural types keep `@dpp/database` free of
any Kafka dependency.

## Boundaries

- **Only PostgreSQL side effects are covered.** An email or an HTTP call can't join the
  transaction. Such effects need their own idempotency key (for example the `eventId` passed to
  the provider) or an outbox of their own.
- **Malformed messages** are unchanged from Phase 3: `DomainEventConsumer` logs and skips them
  before any handler runs, so they never produce a marker. Poison messages that fail repeatedly
  in the handler are Phase 9 (bounded retries plus the DLQ). Until then KafkaJS retries them and
  restarts the consumer from the committed offset.
- **Ordering** is per partition, as in ADR-010. The marker makes processing idempotent; it does
  not reorder anything.

## Retention

`processed_events` grows by one row per event per consumer. A marker must be kept for as long
as a duplicate of its event can still arrive. That means as long as the event can be redelivered
or replayed from Kafka: the topic's retention, plus any deliberate replay window. Deleting
markers earlier would let a replay apply the effects again.

The future cleanup is a periodic
`DELETE FROM processed_events WHERE processed_at < now() - <topic retention + margin>`. If the
table gets large, add an index on `processed_at` or range-partition by month. None of this is
implemented yet: at development volumes the table is small. The primary key already serves the
only hot query, the conflict check.

## Why not exactly once

There's no atomic commit spanning the PostgreSQL transaction and the Kafka offset, so a gap
between them always exists. This design makes that gap harmless for database effects: an effect
is applied at most once, and at least once, so **effectively once**. It doesn't pretend the gap
isn't there.
