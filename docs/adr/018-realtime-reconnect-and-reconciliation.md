# ADR-018: Client reconnect with bounded jittered backoff, and reconciliation by refetch

**Status:** Accepted (Phase 8)

## Context

Sockets drop: network changes, laptop sleep, slow-client disconnects (4429), replica
replacement during deploys (1001). Events committed while a client was away are not replayed
by the realtime service (ADR-016). Hundreds of clients losing a replica at the same moment must
not reconnect in lockstep.

## Decision

`apps/web/src/lib/realtime/connection.ts` (`RealtimeConnection`):

- **Backoff:** attempt n waits uniformly in `[c/2, c]` with `c = min(30 s, 500 ms · 2^(n-1))`
  ("equal jitter"): never a tight loop, never synchronized.
- **Reset:** the attempt counter resets only after a successful **subscribe**, not on TCP open,
  so a server that accepts and immediately closes still backs off.
- **Stop conditions:** `FORBIDDEN`/`NOT_FOUND` or close 4401 are permanent: no retry loop
  against an authorization decision.
- **Reconciliation:** every successful (re)subscription calls `onResync`, which invalidates the
  board and activity queries; TanStack Query refetches over HTTP. Missed events are recovered
  from the authoritative source, not from a replay buffer.
- **Status indicator:** Live / Reconnecting / Offline next to the board title.

## Consequences

- Reconciliation reads the board through the cache (ADR-015), which is invalidated
  asynchronously. The AWS demo measured the missed task visible 351 ms after resubscribing,
  on the 2nd read; the pending notification then triggers another refetch, so the client
  converges.
- A reconnect storm costs one board read per client, spread over the jitter window.
- Tested by `connection.test.ts` (ordering, growth/cap/jitter bounds, stop conditions) and
  deliberate breaks `p8-12-no-reconcile-after-reconnect` and `p8-13-reconnect-without-jitter`.
