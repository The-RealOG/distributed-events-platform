# Interview guide

Short, implementation-grounded answers. Numbers live in [performance.md](performance.md) and
[failure-testing.md](failure-testing.md); every claim there points to a run, a test or a commit.

**Why Kafka?** Several independent consumers (activity, cache invalidation, realtime) react to
the same committed changes at their own pace. Kafka gives durable, replayable, ordered-per-key
delivery with consumer groups, so a consumer can be down for an hour and catch up without the
Project Service knowing it exists. Key = projectId: per-project order, parallelism across
projects (3 partitions).

**Why a transactional outbox?** "Write PostgreSQL, then publish to Kafka" is a dual write: a crash
between them loses the event or announces a change that rolled back. The event row is inserted
in the same transaction as the change; a separate publisher reads committed rows and publishes
them (`acks=-1`), marking them afterwards. Kafka being down never fails a write; it only grows a
backlog (measured: publisher-outage test).

**Why do duplicates happen?** The publisher can crash after the broker ack but before marking the
row → the row is resent (same eventId). A consumer can crash after its side effect but before the
offset commit → Kafka redelivers. Rebalances do the same. At-least-once is the honest guarantee.

**Idempotent consumer design.** `processed_events(consumer_name, event_id)` primary key. The
handler inserts the marker **in the same transaction** as its side effect; `ON CONFLICT DO
NOTHING` returning no row means "already done" → skip. Crash before commit: neither exists, the
redelivery applies once. Crash after commit: the marker exists, the redelivery is skipped.
Invalidation doesn't need it: `DEL` is naturally idempotent. (ADR-013; failure at COMMIT tested.)

**Eventual consistency, where exactly?** Only in projections: activity feed, board cache,
realtime notifications. Tasks themselves are strongly consistent (one primary, one transaction,
optimistic concurrency). See [consistency-and-delivery.md](consistency-and-delivery.md).

**Redis invalidation.** Cache-aside for the board; the Project Service never deletes cache keys
(that would be a new dual write). The cache-invalidator consumes task events and bumps a
generation + DELs the key. The reader's write-back is a Lua compare-and-set on the generation,
so a slow reader can't store a board snapshotted before an invalidation. TTL 300 s as a backstop.
Authorization runs before the cache on every request.

**What if Redis fails?** Reads fall back to PostgreSQL (250 ms command timeout, no offline queue,
no retries), writes are unaffected (Redis is not in the write path). Measured in the Redis
outage demo (real ElastiCache node reboot).

**What if Kafka fails?** Writes continue; the outbox backlog grows; consumers wait. When it
returns, the publisher drains the backlog in order and consumers catch up; nothing is lost
because the outbox row is the source of truth until acked.

**Realtime architecture.** The Project Service never touches sockets. The realtime-service
consumes committed events and pushes a sanitized envelope to project rooms; the browser treats it
as "something changed, refetch". JWT as the first WebSocket message, membership checked per
subscription, bounded buffers (slow clients get 4429), heartbeats, 1001 on shutdown.

**Multi-replica WebSocket fanout.** Each replica has its own consumer group
(`realtime-service.<instance>`) so every replica sees every event and serves its own sockets. No
Redis Pub/Sub layer: Kafka already fans out, and one less lossy hop. Trade-off: each replica reads
the whole topic (fine at these rates).

**DLQ.** Classify failures: transient (dependency down) → block the partition and retry, never
dead-letter; permanent (poison) → 3 attempts, write a sanitized DLQ record (original event,
source partition/offset, consumer, attempts), wait for the ack, then commit. If the DLQ write
fails, don't commit (redelivered). Replay keeps the eventId, so idempotency makes it safe.

**Distributed debugging.** One `correlationId` from the browser (`x-correlation-id`) through the
gateway, the Project Service log, the outbox row, the Kafka event, every consumer's log, and the
realtime notification. Metrics say _that_ something is wrong (p95, backlog, lag, dead-letters);
the correlation ID says _which request_.

**S3 control plane vs data plane.** The API authorizes and signs (presigned POST binding key,
content type and size range; 5-minute expiry); bytes go browser ⇄ S3. The API never streams a
byte, so file size doesn't affect API capacity. HEAD verifies before "ready". Metadata/object
consistency via a small state machine and a sweep (ADR-022).

**Hardest bugs.** See [bug-ledger.md](bug-ledger.md). Best stories: (1) consumers that died
silently on MSK because of a non-retriable authorization error on the DLQ write, found only on
real AWS; (2) Drizzle-wrapped pg errors that would have turned a DB outage into "poison" and
leaked SQL params into the DLQ; (3) a pg-pool crash when a connection died mid-transaction;
(4) rollout "success" reported after a circuit-breaker rollback.

**Performance bottleneck.** See [performance.md](performance.md#saturation): measured, not assumed.

**Scaling strategy.** Stateless services scale horizontally (ECS desired count); the board cache
removes most read load from PostgreSQL; Kafka parallelism is bounded by partitions (3) and
per-project ordering; the realtime tier scales by replicas (each reads all events). Next steps
in order of evidence: see "Future improvements" in the Phase-10 report.

**What I'd improve next.** Batch publishing in the outbox publisher (one send per event today);
a larger DB pool/CPU for the Project Service before any architectural change; rate limiting at
the edge; idempotency keys for POSTs; managed Prometheus in AWS; multi-AZ RDS for real failover.
