# ADR-019: Bounded retries, failure classification and a dead-letter queue

**Status:** Accepted

## Context

Before this, a handler failure was rethrown and KafkaJS retried the message forever: one poison
event blocked its partition indefinitely, and malformed messages were skipped with only a log
line. Retrying forever is right when a dependency is down, and wrong when the event itself can
never be processed.

## Decision

`DomainEventConsumer` (`packages/kafka/src/consumer.ts`) classifies every handler failure:

| Kind                   | Examples                                                                       | Policy                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **transient**          | SQLSTATE 08/53/57, `ECONN*`, timeouts, `KafkaJS*` errors                       | up to 5 in-process attempts, then hand back **unacknowledged**; KafkaJS redelivers from the last committed offset. Order is preserved; nothing goes to the DLQ. |
| **permanent (poison)** | constraint violations, invalid data, programming errors, `PermanentEventError` | 3 attempts, then write a DLQ record, wait for the broker's ack (`acks=-1`), and only then acknowledge the source offset.                                        |
| **malformed**          | not JSON, bad envelope, unknown type, bad payload                              | dead-lettered once (with a DLQ configured) with bounded raw bytes (base64, ≤64 KiB).                                                                            |

- Backoff between attempts: equal jitter, 200 ms base, 5 s cap (heartbeats sent while waiting).
- Classification uses the **root cause** (`rootCause()` unwraps `.cause`): Drizzle wraps pg
  errors, and classifying the wrapper would turn a database outage into "poison" and copy the
  wrapper's query parameters (user data) into the DLQ. Found and fixed while building this.
- **DLQ record** (`domain.events.dlq`, 1 partition): `dlqVersion`, `category`, `consumer` (group),
  sanitized `error`, `attempts`, `failedAt`, `source {topic, partition, offset, key}`, and the
  original `event` (poison) or `rawBase64` (malformed). Errors are sanitized: credentials in
  URLs, Bearer tokens, JWTs, AWS keys and `password/secret/token=` values are redacted; 500
  characters max.
- **If the DLQ write fails, the source is not acknowledged.** The consumer throws a
  **retriable** `RedeliverError`, so KafkaJS redelivers and, when its own retries run out,
  restarts the consumer. (Found on AWS: an MSK authorization error from the DLQ producer is
  non-retriable in KafkaJS; rethrowing it as-is stopped the consumer for good while `/health`
  stayed green. Fixed in commit 8703533, with a real-broker regression test and break
  `p8-d09`.) Consumer services' `/health` now fails if KafkaJS gave up, so ECS replaces the
  task.
- **Replay** (`kafka-tools dlq-replay --event-id ID --operator NAME`): republishes the stored
  event with the **same eventId and key**, marked `x-replayed-from-dlq`/`x-replayed-by`, and logs
  it. Idempotent consumers (ADR-013) make a replay of an already-applied event a no-op.
  Malformed records are never replayed.
- Only the activity-service dead-letters (it has a durable side effect). The cache-invalidator
  classifies everything as transient (a DEL cannot be poison); the realtime service neither
  retries nor dead-letters (notifications are best effort).

## Consequences

- A poison event delays its partition by ~0.6 s (3 attempts), not forever.
- The DLQ needs an operator: `kafka-tools dlq-list` shows records; replay is explicit and
  audited in logs.
- Tests: `packages/kafka/test/dlq.int.test.ts` (8 real-broker tests), `failures.test.ts`,
  deliberate breaks `p8-d01…d09`. AWS: `npm run aws:demo:dlq`.
