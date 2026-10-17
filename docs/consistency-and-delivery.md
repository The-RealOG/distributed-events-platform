# Consistency model and delivery semantics

The system is **not** "eventually consistent" as a whole. Each piece of state has one owner and
one precisely stated guarantee.

## Consistency

| Data / path                                        | Guarantee                                                                                                                                                                                      | Mechanism                                                                                                                                                                  | Staleness bound (measured where noted)                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tasks, columns, comments, memberships (PostgreSQL) | **Strong, transactional.** A write is visible to every later read once its HTTP response is sent.                                                                                              | Single PostgreSQL primary; one transaction per command; optimistic concurrency on `version` (409 on a stale `expectedVersion`) (ADR-001, ADR-008)                          | none                                                                                                                  |
| Domain change + its event                          | **Atomic.** Both commit or neither does.                                                                                                                                                       | Transactional outbox: the event row is inserted in the same transaction (ADR-011)                                                                                          | none                                                                                                                  |
| Event publication (outbox → Kafka)                 | **Eventual, at least once, in per-project order.** Every committed event is published; Kafka-side durability of an acknowledged event is limited by `min.insync.replicas=1` (see Limitations). | Outbox publisher polls every 500 ms, sends with `acks=-1`, marks published after the ack; key = projectId                                                                  | poll interval + publish; see docs/performance.md                                                                      |
| Activity feed (`activity_events`)                  | **Eventually consistent projection**, never wrong, never duplicated.                                                                                                                           | Kafka consumer; side effect + `processed_events` marker in one transaction (ADR-013, ADR-014)                                                                              | consumer lag                                                                                                          |
| Board cache (Valkey)                               | **Disposable projection, eventually invalidated.** Never authoritative; never served without an authorization check.                                                                           | Cache-aside; Kafka-driven invalidation with generation-guarded write-back; 300 s TTL as a backstop; the writer's own tab reads fresh for 10 s (read-your-writes) (ADR-015) | invalidation lag (AWS demo: a reconnecting client saw a stale board once, then the change 351 ms after resubscribing) |
| Realtime notifications                             | **Best effort, ephemeral.** Hints to refetch, not state.                                                                                                                                       | WebSocket push from committed events; client invalidates and refetches over HTTP on every notification and every (re)subscription (ADR-016/018)                            | notification after writer's 201: see docs/performance.md                                                              |
| Attachments (PostgreSQL row + S3 object)           | **Coordinated, not atomic.** Users only ever see `ready` rows whose object was verified by HEAD.                                                                                               | pending → ready → deleted; delete is row-first; a sweep converges leftovers (ADR-021/022)                                                                                  | ≤ one sweep interval (10 min) for an unreachable leftover object                                                      |

## Delivery semantics

| Hop                  | Semantics                                           | Why                                                                                                                                      | Duplicate handling                                                                                                                          |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Request → PostgreSQL | exactly once per successful response                | one transaction; client retries of a non-idempotent POST can create a second task (no idempotency keys; see limitations)                 | n/a                                                                                                                                         |
| Outbox → Kafka       | **at least once**                                   | a publisher crash between the broker ack and `published_at` resends the row; the same `eventId` is sent every time (never regenerated)   | consumers deduplicate by `eventId`                                                                                                          |
| Kafka → consumers    | **at least once**                                   | offsets are committed after the handler; a crash or rebalance redelivers                                                                 | per consumer, below                                                                                                                         |
| Activity side effect | **effectively once per (consumer, eventId)**        | `processed_events (consumer_name, event_id)` inserted in the same transaction as the side effect; a duplicate finds the marker and skips | transactional idempotency                                                                                                                   |
| Cache invalidation   | at least once, **naturally idempotent**             | `DEL` of a missing key and an extra generation bump are harmless                                                                         | none needed                                                                                                                                 |
| Poison events        | to the DLQ **after** the DLQ ack, then acknowledged | a failed DLQ write leaves the source unacknowledged (redelivered)                                                                        | replay keeps the `eventId`, so idempotent consumers skip already-applied events                                                             |
| Realtime → browser   | **best effort** (0..n times)                        | sockets drop; no replay                                                                                                                  | ring of the last 1024 eventIds per replica suppresses immediate duplicates; the client's refetch makes any number of notifications converge |
| Browser ⇄ S3         | the upload is single-shot; `complete` is idempotent | HEAD decides; a second `complete` returns the ready row                                                                                  | n/a                                                                                                                                         |

**There is no end-to-end exactly-once.** What the system guarantees is: no committed change is
lost from PostgreSQL, no rolled-back change is ever announced, durable side effects happen once per
consumer, and every read model converges to PostgreSQL, within the Kafka durability limit below.

## Measured (AWS dev, 2026-10-17; docs/performance.md, docs/failure-testing.md)

- **Commit → published to Kafka.** Lag p50 0.27 s, p95 0.51 s, p99 0.6 s at the sustainable write
  rate (about 30–33 writes/s). It is bounded by the 500 ms outbox poll.
- **Commit → WebSocket notification on the writer's own socket.** p95 about 0.5 s, the same at
  100–1,000 connections.
- **Convergence of the read models.** Activity caught up 1.1 s after a change and the board cache
  was fresh 1.1 s after one. After outages, activity caught up 11.7 s after restart (no
  duplicates), the cache converged 6.4 s after the invalidator restarted, and caching resumed
  8.4 s after a Redis reboot.
- **Invariants audit after every load and failure experiment of the day.** No lost or unpublished
  events, gap-free task versions, no duplicate activity rows, and markers and side effects 1:1.

## Limitations (verified, not fixed)

- **Kafka durability.** MSK runs `default.replication.factor=2` with `min.insync.replicas=1`. The
  producer uses `acks=-1` without the idempotent producer.
  - While one broker is down, an acknowledged event can exist on the leader alone. Had that broker
    then been lost, the event would be gone from Kafka.
  - The outbox would already have marked it published, so it would not be resent, and the change
    would never be announced to consumers.
  - `min.insync.replicas=2` trades this for failed, retried publishes during a broker outage.
- **HTTP requests are not idempotent.** Consumer-side idempotency does not make a retried `POST`
  safe: a client that retries `POST /tasks` after a lost response creates a second task. Updates
  and moves are protected by `expectedVersion` (409 on a stale retry). There are no idempotency
  keys.
- **Outcome of a timed-out statement.** Pool-acquisition and connection failures return 503 (the
  request never reached the database). A statement that exceeded its 15 s client query timeout
  returns 500, and its outcome is unknown to the client (it may have committed).
- **Overload.** At saturation, requests queue for project-service's 10-connection pool and fail
  after its 5 s connect timeout (503). There is no load shedding earlier.
- **No rate limiting.** Neither the gateway, the ALB nor CloudFront limits request rates per client.
  One client can saturate the service.
- **Realtime.** Delivery is best effort (no replay). Clients recover by refetching on (re)subscribe,
  which was verified on AWS.
