# ADR-016: Realtime collaboration as notifications over WebSockets, fed only by Kafka

**Status:** Accepted (Phase 8)

## Context

Two people on the same board should see each other's changes without refreshing. The board state
is authoritative in PostgreSQL, and every change already becomes a committed domain event on
Kafka through the transactional outbox (ADR-011). WebSocket delivery is inherently unreliable:
tabs sleep, networks drop, replicas are replaced during deploys.

## Decision

A separate **realtime-service** pushes **notifications, not state**, and only for committed
events it reads from Kafka:

```
browser ─wss /api/realtime─▶ CloudFront ─▶ ALB ─▶ gateway (relay, Origin check) ─▶ realtime-service
project-service ─ PostgreSQL (change + outbox) ─▶ outbox-publisher ─▶ Kafka ─▶ realtime-service ─▶ sockets
```

- **No direct broadcast from the Project Service.** It never talks to sockets, so a rolled-back
  transaction can never be announced, and a realtime outage can never fail a write. (Guarded by
  `tests/architecture/boundaries.test.ts`: no WebSocket dependency, import or broadcast.)
- **Authentication:** the same JWT as the HTTP API, sent as the **first message**
  (`{type:"auth"}`), never in the URL where proxies and access logs keep it. No auth within
  5 s → close 4408; bad token → 4401.
- **Authorization per subscription:** `subscribe(projectId)` checks membership in PostgreSQL
  (`projectReadAccess`) on every request; the UI's word is never trusted. Refusals are
  `FORBIDDEN`/`NOT_FOUND`.
- **Rooms:** projectId → local sockets; membership is removed on disconnect and empty rooms are
  deleted (bounded memory).
- **Sanitized envelope:** type, eventId, projectId, aggregateId/version, taskId, actorId,
  correlationId, occurredAt. No payload bodies, no Kafka partition/offset.
- **Client contract: invalidate and refetch.** On a notification the browser invalidates the
  affected queries and refetches over HTTP. A missed, duplicated or reordered notification can
  therefore only make the UI briefly stale, never wrong.
- **Backpressure:** a socket whose unsent data exceeds 1 MiB is closed with 4429 (it reconnects
  and refetches); the server never queues without bound for a client that is not reading.
- **Heartbeats:** ping every 15 s; a peer that misses a full interval is terminated.
- **Duplicates:** Kafka is at-least-once; a bounded ring (1024 eventIds) suppresses immediate
  re-sends. Older duplicates are harmless under invalidate-and-refetch.
- **Graceful shutdown:** every socket is closed with 1001 (going away) so clients reconnect to a
  healthy replica.
- **Origin check at the gateway:** WebSocket handshakes are not covered by CORS, so the relay
  refuses upgrades whose `Origin` is not the app (403).

## Consequences

- Realtime is **best effort and ephemeral**; correctness comes from PostgreSQL via HTTP. This is
  why no replay, sequence numbers or per-client buffers are needed.
- Notification latency = outbox poll + publish + consumer fetch + send. Measured on AWS in the
  Phase-9 demo: B was notified ~300–350 ms after A's HTTP response (docs/performance.md).
- An extra small service and an extra hop (gateway relay) versus exposing the realtime service
  directly; in exchange there is one public origin, one TLS termination and one place for the
  Origin check.
