# Consistency model and delivery semantics

The system is **not** "eventually consistent" as a whole. Each piece of state has one owner and
one precisely stated guarantee.

## Consistency

| Data / path                                        | Guarantee                                                                                                                                                  | Mechanism                                                                                                                                                                  | Staleness bound (measured where noted)                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tasks, columns, comments, memberships (PostgreSQL) | **Strong, transactional.** A write is visible to every later read once its HTTP response is sent.                                                          | Single PostgreSQL primary; one transaction per command; optimistic concurrency on `version` (409 on a stale `expectedVersion`) (ADR-001, ADR-008)                          | none                                                                                                                  |
| Domain change + its event                          | **Atomic.** Both commit or neither does.                                                                                                                   | Transactional outbox: the event row is inserted in the same transaction (ADR-011)                                                                                          | none                                                                                                                  |
| Event publication (outbox → Kafka)                 | **Eventual, at least once, in per-project order.** Every committed event is published; An acknowledged event is on both brokers (`min.insync.replicas=2`). | Outbox publisher polls every 500 ms, sends with `acks=-1`, marks published after the ack; key = projectId                                                                  | poll interval (500 ms) + publish; about 0.5 s at p95 when measured                                                    |
| Activity feed (`activity_events`)                  | **Eventually consistent projection**, never wrong, never duplicated.                                                                                       | Kafka consumer; side effect + `processed_events` marker in one transaction (ADR-013, ADR-014)                                                                              | consumer lag                                                                                                          |
| Board cache (Valkey)                               | **Disposable projection, eventually invalidated.** Never authoritative; never served without an authorization check.                                       | Cache-aside; Kafka-driven invalidation with generation-guarded write-back; 300 s TTL as a backstop; the writer's own tab reads fresh for 10 s (read-your-writes) (ADR-015) | invalidation lag (AWS demo: a reconnecting client saw a stale board once, then the change 351 ms after resubscribing) |
| Realtime notifications                             | **Best effort, ephemeral.** Hints to refetch, not state.                                                                                                   | WebSocket push from committed events; client invalidates and refetches over HTTP on every notification and every (re)subscription (ADR-016/018)                            | notification after the writer's 201: about 0.5 s at p95 when measured                                                 |
| Attachments (PostgreSQL row + S3 object)           | **Coordinated, not atomic.** Users only ever see `ready` rows whose object was verified by HEAD.                                                           | pending → ready → deleted; delete is row-first; a sweep converges leftovers (ADR-021/022)                                                                                  | ≤ one sweep interval (10 min) for an unreachable leftover object                                                      |

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

## Limitations (verified, not fixed)

- **Kafka durability vs availability.** MSK runs replication factor 2 with
  `min.insync.replicas=2`, and the producer uses `acks=-1`. An acknowledged event is therefore on
  both brokers and survives losing either one. While a broker is down, publishes (and consumer
  offset commits) fail and are retried. Events wait in the outbox and HTTP writes are unaffected,
  so a broker outage delays events rather than risking them. **This setting is not yet verified
  on AWS:** the broker-reboot test last ran with `min.insync.replicas=1`, and it should be
  rerun after the next `aws:rebuild`.
- **Retried creates are safe with an `Idempotency-Key`.** `POST /tasks` and
  `POST /tasks/:id/comments` accept the header. The key is claimed in the same transaction as the
  change and stores its response: a retry replays it, a concurrent duplicate waits and then
  replays it, the same key with a different request is refused (422), and a rolled-back attempt
  frees the key. Keys are per user and expire after 24 h. The web client sends one per draft.
  Requests without the header are not deduplicated. Updates and moves are protected by
  `expectedVersion` instead.
- **Timeouts say whether a retry is safe.** Pool-acquisition and connection failures, and
  statements cancelled by the server's `statement_timeout` (which roll back), return
  **503 DEPENDENCY_UNAVAILABLE**: nothing was applied. When a response simply did not arrive in
  time (the database client's query timeout, or the gateway's upstream timeout), a read still
  returns 503, but a mutation returns **504 OUTCOME_UNKNOWN**: it may have been applied, so the
  client must refetch before retrying.
- **Overload.** At saturation, requests queue for project-service's 10-connection pool and fail
  after its 5 s connect timeout (503). There is no load shedding earlier.
- **Outbox retention.** The outbox publisher deletes events Kafka acknowledged more than
  `OUTBOX_RETENTION_HOURS` ago (default 168, matching Kafka's 7-day retention), in batches.
  Unpublished events are never deleted. Consumers' `processed_events` markers are kept: a DLQ
  replay can deliver an old event long after Kafka's retention, and the marker is what keeps it
  from applying twice, so that table still grows and needs a deliberate archiving policy.
  Migration 0006 creates its index with a plain `CREATE INDEX`, which blocks writes while it
  builds; on a large existing table it should be built `CONCURRENTLY` instead.
- **Rate limiting is per gateway task.** The gateway allows `RATE_LIMIT_MAX` requests (default 600) per `RATE_LIMIT_WINDOW_MS` (default 60 s) per client, where a client is a user's bearer
  token. Over the limit it answers 429 `RATE_LIMITED` with `Retry-After`. The counters are
  in-memory, so with N gateway tasks a user gets up to N × the limit. Requests without a token
  are keyed by the caller's address, which behind the ALB is the load balancer's (the gateway
  does not trust `X-Forwarded-For`), so they share one bucket. Probes, CORS preflights and the
  WebSocket upgrade are not counted.
- **Realtime.** Delivery is best effort (no replay). Clients recover by refetching on (re)subscribe,
  which was verified on AWS.
