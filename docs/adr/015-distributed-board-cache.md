# ADR-015: Shared board cache with Kafka-driven invalidation

**Status:** Accepted

## Context

`GET /projects/:id/board` is the most frequent read: every board view, refocus and refresh
fetches it. It assembles the project, board, columns, active tasks and their assignees from four
queries in a REPEATABLE READ snapshot. The data changes far less often than it is read. Several
Project Service replicas serve it, so a per-process cache would give each replica its own,
differently stale copy.

## Decision

Cache the board in a **shared** Redis-protocol store (Valkey: ElastiCache in AWS, a container
locally) with **cache-aside reads** and **asynchronous, event-driven invalidation**. PostgreSQL
stays authoritative, and Redis is disposable.

```
read:        project-service ─ access check (PostgreSQL) ─ Redis GET ── HIT ─▶ return
                                                               └ MISS ─▶ PostgreSQL ─▶ SET (TTL) ─▶ return
write:       project-service ─ PostgreSQL (change + outbox) ─▶ 200      (Redis not involved)
invalidate:  outbox-publisher ─▶ Kafka ─▶ cache-invalidator ─▶ DEL board:v1:{projectId}
```

### Keys and value

- Key: `board:v1:{projectId}`, built only by `boardCacheEntry()` in `@dpp/cache`, so the reader
  and the invalidator cannot disagree. Bump `v1` when the cached shape changes.
- Value: the public `BoardDto` as JSON, which is API-shaped data, not driver rows. Every hit is
  validated with the DTO schema. A corrupt or unparseable entry counts as a miss and is deleted.
- The board is project-level: nothing in it depends on who is asking. **Authorization runs on
  every request, before the cache is read**, so a cached board is never served to someone who
  can't read the project.

### Invalidation is event-driven, not a write-path side effect

The Project Service does not delete cache entries when it writes. That would be a new dual
write (PostgreSQL commit + Redis DEL, where either can fail independently), the same problem the
outbox exists to avoid. Invalidation comes only from committed events:

- A rolled-back change produces no outbox row and no event, so it never invalidates anything.
- A committed change always produces its event, so its invalidation eventually happens.
- Redis never takes part in a write, so a Redis outage cannot fail a change.

The **cache-invalidator** (consumer group `cache-invalidator`) handles every `task.*` event by
invalidating that project's board. It ignores `comment.created`, because the board carries no
comments. The map is exhaustive over event types, so a new type won't compile until someone
decides. A failed invalidation (Redis down) throws, the offset is not committed, and Kafka
redelivers until it succeeds.

### No processed_events here: invalidation is naturally idempotent

ADR-013's marker exists for side effects that must not repeat, such as inserting an activity
row. Deleting a key that's already gone is a no-op, and the generation bump below only forces
one extra miss. So duplicate deliveries of the same event are harmless, and a database round
trip per invalidation would buy nothing. Before adding deduplication, the question to ask is:
is the side effect already idempotent?

### Read your own writes

The stale window must not apply to the person who made the change. Right after a successful
write, the web client refetches the board, and it would otherwise read the pre-change entry
(this was caught by the post-deploy smoke test in AWS). So:

- For 10 s after a tab's own successful write, its GETs send `Cache-Control: no-cache`. That's
  standard HTTP; the React code has no cache logic.
- The gateway forwards that header.
- The board read then skips the cached value, reads PostgreSQL, and refreshes the shared entry
  (`x-board-cache: REFRESH`). The refresh uses the generation it read _before_ querying, so it can't
  overwrite a newer invalidation.

Other users stay eventually consistent. Their window is normally sub-second, and often zero,
because the writer's refresh already replaced the shared entry.

### The stale window, and the one race we close

Between a commit and its invalidation, the cache can serve the previous board:

```
T0 change commits (HTTP 200)     T1 cached board still old
T2 event reaches the invalidator  T3 DEL      T4 next read: MISS → PostgreSQL → SET
```

Normally that's well under a second, and longer while the invalidator or Kafka is down. That is
accepted: the board is also refreshed by the client (TanStack Query) and is not a decision
point. Writes are protected by optimistic concurrency, so a stale board can't cause a lost
update; a stale version yields 409 (ADR-008).

Plain cache-aside has a worse case: a slow reader that missed _before_ a change can write its
old snapshot back _after_ the invalidation. That stale value then lives until the TTL. A
**generation counter** per board prevents this:

- invalidation = `INCR gen; DEL value` (one Lua script)
- write-back = `SET value EX ttl` only if `gen` still equals what the reader saw on its miss
  (one Lua script)

A late write is refused, and `staleWritesSkipped` counts it. This isn't a lock: readers never
wait, and simultaneous repopulations of a hot key simply write the same fresh value.

### TTL is a safety net

The TTL is `CACHE_TTL_SECONDS`, default 300, always finite (validated). It bounds staleness if
an invalidation is ever lost (for example, consumer-group offsets expiring after a very long
invalidator outage). It is not how freshness normally works.

### Failure behaviour

| Failure            | Behaviour                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis down or slow | The client has no offline queue, no per-command retries and a 250 ms command timeout. Reads fall back to PostgreSQL (`x-board-cache: BYPASS`). Writes are unaffected. It reconnects by itself.                                              |
| Redis SET fails    | The PostgreSQL result is still returned.                                                                                                                                                                                                    |
| Corrupt entry      | Treated as a miss and deleted.                                                                                                                                                                                                              |
| Invalidator down   | Writes continue, and boards may be stale. On restart it consumes the backlog from its committed offsets. A new group starts from the beginning of the topic: replaying only forces misses, while starting at "latest" could skip a backlog. |
| Duplicate events   | Harmless (see above).                                                                                                                                                                                                                       |

### Multiple replicas

Every Project Service replica reads and fills the same keys. A board that replica A loaded is a
hit on replica B, and one invalidation clears it for all replicas at once. A per-process cache
couldn't do either.

### Stampede

When a popular board is invalidated, the next concurrent reads all miss and each queries
PostgreSQL. This is correct (they store the same value, guarded by the generation). At this
scale it is also cheap, so no single-flight or distributed lock was added. If measurements ever
show it matters, per-process request coalescing is the first step.

### Observability now, metrics later

- An `x-board-cache: HIT | MISS | BYPASS` response header. It is diagnostic only, like a CDN's; the
  web app ignores it.
- Project Service `/status` (internal, not routed by the gateway) exposes hits, misses, errors,
  corrupt entries, writes, skipped stale writes and invalidations.
- Invalidator `/status` exposes invalidated, ignored and failed counts.

These are exported as Prometheus metrics.

### Client cache vs. server cache

TanStack Query in the browser caches _per user tab_ and decides when to refetch. Redis caches
_per project, shared by all users and replicas_, and decides whether a refetch touches
PostgreSQL. They are independent, and the web app has no Redis-specific logic.

## Consequences

- Board reads mostly skip four PostgreSQL queries. The cost is a sub-second (normally)
  staleness window after changes, bounded by the TTL in the worst case.
- In AWS: one `cache.t4g.micro` Valkey node ($0.0128/h in us-east-2), TLS in transit,
  encrypted at rest, in the data subnets. Only the project-service and cache-invalidator
  security groups can reach it. There is no AUTH token; access is by network only.
- The cache is optional (`CACHE_ENABLED`). With it off, `x-board-cache: BYPASS` and behaviour is
  identical except for speed.
