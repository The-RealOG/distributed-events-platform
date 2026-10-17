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

**What if Kafka fails?** Writes continue, the outbox backlog grows and consumers wait. When Kafka
returns, the publisher drains the backlog in order and consumers catch up. Until it is acked, the
outbox row is the source of truth.

- **Measured on MSK:** during a broker reboot, 170/170 writes succeeded and there were 0 publish
  failures. The cluster was back to ACTIVE in 194 s.
- **Caveat:** with `min.insync.replicas=1`, `acks=-1` only means the _current_ ISR has the event.
  While a broker is down that can be the leader alone, so an acknowledged event can still be lost
  if that broker dies. `min.insync.replicas=2` trades that for retried publishes.

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

**What was the bottleneck, and how did you find it?** project-service CPU on its 0.25 vCPU task, in
every workload.

- **How it showed:** its CPU was at 97–100 % at saturation while RDS stayed at 8–28 %.
- **Profiling:** a CPU profile of the saturated task (the Node inspector inside the task, via ECS
  Exec) put the largest single share of busy time in drizzle-orm query building, not in PostgreSQL I/O: about 29 % of busy time in September's balanced profile and about 20 % in the 2026-10-17 read-heavy one, with pg I/O about 5 %.
- **A symptom, not the cause:** DB pool waiting. Requests queue behind a saturated event loop, and
  under write-heavy load that exhausts the 10-connection pool (503 after 5 s).
- **Scaling confirmed it:** a second project-service task doubled read-heavy throughput (151–156
  → 298–312 req/s). The single api-gateway task then became the limit, at about 300 req/s per
  0.25 vCPU. Its profile showed the inherent HTTP proxy work and no single hotspot.

**Why did one SQL statement help, and by how much?** A board cache miss used to run authorization,
then BEGIN, authorization again, board, columns, tasks, assignees and COMMIT: up to 8 round trips
and 6 query builds.

- **The change:** authorize once, then load the board with one JSON-aggregating statement. One
  statement still reads one snapshot, so the no-duplicates guarantee under concurrent moves holds.
- **Controlled A/B (same host model, same session):** −22 % project-service CPU per request and
  +25 % saturated throughput (67 → 84 req/s at 100 VUs).
- **What was withdrawn:** the first measurement claimed +104 %, but it compared runs on different,
  unrecorded compute (bug ledger #25). Lesson: record the host CPU model and compare within one.

**Did Redis improve performance?** Less than expected, so it says so.

- **Read-heavy:** +13 % saturated throughput, and 4–14× fewer tuples read from PostgreSQL.
- **Balanced:** no gain at all. About 20 writes/s invalidate each of 20 boards roughly once a
  second, and the cache path's own CPU costs about what it saves.
- **Verdict:** at this scale it is justified by database offload and headroom, not by latency.
  With one hot project it barely helps: ~0 % hit rate on a 71 KB unpaginated board.

**How did the publisher behave under load?** At the API's sustainable write rate (about 30–33
writes/s), PostgreSQL-measured arrival equalled publication in every 30 s bucket.

- **Lag:** p50 0.27 s, p95 0.51 s (the 500 ms poll), backlog ≤ 19, publisher CPU ≤ 38 %.
- **When it fell behind:** backlogs (peak 1,990) appeared only once the API itself was saturated.
- **Decision:** batch publishing was not justified by the data, so it was not built.

**What happened during the Redis failure?** A real ElastiCache node reboot. Reads fell back to
PostgreSQL, writes were unaffected, and caching resumed 8.4 s later with no repair.

**How does realtime recover missed events?** It doesn't replay them. A notification is a hint, so on
(re)subscribe the client refetches the board.

- **On AWS:** a task created while a client was disconnected was on its board 39 ms after
  resubscribing.
- **Replica replacement:** the socket closed with 1001, the client reconnected and live events
  resumed.
- **Under load:** 100 % delivery at 100–1,000 connections and across two replicas, with p95 about
  0.5 s from commit to the client.

**Scaling strategy.** Stateless services scale horizontally (ECS desired count); the board cache
removes most read load from PostgreSQL; Kafka parallelism is bounded by partitions (3) and
per-project ordering; the realtime tier scales by replicas (each reads all events). Next steps
in order of evidence: see "Future improvements" in the Phase-10 report.

**What would you redesign for production?** In order of measured evidence:

1. project-service gets more vCPU and a pool sized to it, plus earlier load shedding: today
   overload surfaces as 503 after a 5 s pool wait.
2. An outbox retention job. Published rows are never deleted, and in the soak, periodic stalls
   coincided with ANALYZE of the growing table.
3. A non-burstable database class: a `db.t4g.micro` exhausted its storage burst after about 3.5 h
   of benchmark writes, and commits then took more than 15 s.
4. `min.insync.replicas=2`.
5. Board pagination. One large project costs 4× per request.
6. Idempotency keys for POSTs, and rate limiting at the edge (there is none).
7. Multi-AZ RDS for real failover, and managed Prometheus.

Batch publishing is _not_ on the list: the publisher kept up.

**Current limitations.** See [consistency-and-delivery.md](consistency-and-delivery.md#limitations-verified-not-fixed).
Briefly: Kafka durability with `min.insync.replicas=1`; non-idempotent POST retries; no rate
limiting; unbounded outbox growth; a single task per service (stopping one costs 27–38 s of 503s);
the S3 outage test not run on AWS; Playwright runs locally only.
