# ADR-010: Kafka as the domain-event transport

**Status:** Accepted. Events reach Kafka only through the transactional outbox (see
"Relationship to the outbox").

## Context

Several upcoming responsibilities react to project changes but must not sit in the request
path: activity history, realtime fan-out to browsers, cache invalidation and notifications. If
the Project Service called each of them synchronously, a slow or failed consumer would slow
down or fail user writes, and every new consumer would mean changing the Project Service. We
need an asynchronous, durable stream of "what changed" that several independent consumers can
read at their own pace, replay after downtime and scale separately.

## Decision

### Transport

Apache Kafka (single-node KRaft locally; MSK or another managed Kafka later), with **one
topic for all domain events**, `domain.events`, plus `domain.events.dlq` for dead-lettered
messages (ADR-019). Topics are created by an idempotent init job (`kafka-init`). Broker-side
auto-creation is disabled, so a mistyped topic fails loudly.

Why Kafka rather than a queue: consumers need **independent copies of the same stream**
(consumer groups), **replay** from a retained log after downtime (offsets), and **per-key
ordering**. A work queue gives one copy per message and no replay.

### Partitioning and ordering

- Message key = `payload.projectId` for every current event.
- Kafka orders messages **only within a partition**. With a key, all of one project's events
  land on the same partition, so a consumer sees them in the order they were written.
- There is **no ordering across projects**, and no global order. Two projects may share a
  partition or not; nothing may depend on either.
- The producer runs with `maxInFlightRequests: 1`, so KafkaJS's internal retries cannot reorder
  messages within a partition.
- Keys map to partitions with the murmur2 partitioner (KafkaJS `DefaultPartitioner`, the same
  hashing as the Java client). **Adding partitions later remaps keys.** Ordering for a project
  would break across the change, so it has to be a planned migration. `ensureTopics` refuses a
  partition-count mismatch rather than "fixing" it.
- `domain.events` has 3 partitions locally: enough to show key routing and to split a group
  across two members. Production would size this for throughput.

### Consumer groups

- One consumer **group per logical consumer** (activity-service, realtime-service,
  cache-invalidation, …). Each group receives every event.
- **Replicas of one service share its group** and split the partitions, so each event is
  handled by one replica.
- Both properties are verified against a real broker (`packages/kafka/test/groups.int.test.ts`).

### Delivery semantics: at-least-once, not exactly-once

- Producer: `acks=-1`. `publish()` resolves only after the broker acknowledges. KafkaJS retries
  transient failures a bounded number of times (about 4 s total). A retry after a lost
  acknowledgement can duplicate a message. The idempotent producer is not enabled because
  KafkaJS documents it as experimental.
- Consumer: the offset is marked only after the handler resolves, and auto-committed per batch.
  A crash between handling and commit means redelivery.
- So every consumer must tolerate duplicates. Idempotency uses `eventId` recorded in the same
  database transaction as the side effect (ADR-013). **We do not claim exactly-once.** Kafka's
  transactions give exactly-once only for Kafka-to-Kafka pipelines, and our side effects are in
  PostgreSQL, Redis and WebSockets.

### Envelope, contracts and versioning

A shared envelope (`packages/contracts/src/events.ts`): `eventId` (UUID, the idempotency key),
`eventType`, `aggregateType`, `aggregateId`, `aggregateVersion` (the aggregate's
optimistic-concurrency version **after** the change), `occurredAt` (ISO-8601 UTC), `producer`,
`correlationId` (the originating request's, unchanged), optional `causationId`,
`schemaVersion`, `payload`.

- **`schemaVersion` versions the event format. `aggregateVersion` versions the task.** They are
  unrelated.
- Consumers accept only schema versions they know (`[1]`) and check the version **before**
  interpreting anything type-specific. A message with `schemaVersion: 900` is classified
  `unsupported_schema_version`, not parsed as v1. Evolving the format means adding a v2 schema,
  deploying consumers that accept both, then switching producers.
- Payloads carry what consumers need to act without calling back to the Project Service
  (IDs, the task title, column IDs, the new position). They leave out large fields: task
  descriptions are reduced to `descriptionChanged`, and comment bodies to a 280-character
  excerpt plus length.

### Serialization: JSON + Zod + schemaVersion

JSON is readable in every tool (`kafka-console-consumer`, logs, `scripts/kafka consume`), needs
no extra infrastructure, and matches the HTTP contracts. Zod schemas in one shared package
give both TypeScript types and runtime validation on the consumer side, which matters because
Kafka payloads are untrusted input. A schema registry with Avro/Protobuf pays off when many
teams publish and consume independently and compatibility must be enforced centrally. With
one repository and one contracts package, that isn't the case yet. The schemaVersion field
keeps that migration open.

### Malformed messages

A message that fails decoding or validation is logged (topic, partition, offset, key,
classified reason; never the raw bytes), reported to a hook, and **skipped** (its offset is
committed). One bad message can never block its partition or loop forever. With a DLQ configured
it is also copied to `domain.events.dlq` for inspection and replay. Handler failures on _valid_
events are a different case: they are retried within bounds and then dead-lettered (ADR-019).

### Client library

KafkaJS, as the project specification requires. Its last release (2.2.4) was in February 2023.
It works against Kafka 4.1.1 for everything used here (verified by the integration suite), but
it is effectively unmaintained. Under Node ≥ 23 it emits a harmless `TimeoutNegativeWarning`
(a negative `setTimeout` that Node clamps to 1 ms, as older Node did silently). Our tools
disable that one warning. If KafkaJS becomes a problem, `@confluentinc/kafka-javascript`
offers a KafkaJS-compatible API. The package boundary (`@dpp/kafka`) keeps that swap local.

## Alternatives considered

- **Direct HTTP calls from the Project Service to each consumer.** Couples user-facing latency
  and availability to every consumer.
- **A work queue (SQS, RabbitMQ).** One copy per message, no replay, and no per-key ordering
  without extra machinery.
- **Topic per event type.** Loses per-project ordering across types (a `task.moved` could
  overtake the `task.created` for the same task).
- **Postgres LISTEN/NOTIFY.** Not durable: listeners that are down miss events.
- **Exactly-once via Kafka transactions.** Doesn't cover side effects outside Kafka. Consumer
  idempotency is still required.

## Consequences

- Consumers are eventually consistent with PostgreSQL and must be idempotent.
- Correlation IDs continue from HTTP into events, so one ID links the browser request, the
  services, and every consumer's logs.
- One shared topic means consumers filter by `eventType`. That is cheap at this scale.

## Relationship to the transactional outbox

The Project Service must not call `kafka.send()` after committing a database change. If Kafka
is down, or the process dies between the commit and the send, the event is lost while the
change stands. A send before the commit can announce a change that is then rolled back.
The project service writes each event into an `outbox_events` row **in the same transaction** as the
change. A separate publisher then delivers outbox rows with `DomainEventProducer`.
`tests/architecture/request-path.test.ts` fails if the Project Service, the gateway or the web
app depends on KafkaJS or `@dpp/kafka`. The Playwright spec `kafka-independence.spec.ts` shows
the whole application working with the broker stopped.
