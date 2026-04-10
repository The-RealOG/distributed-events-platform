# ADR-001: PostgreSQL is the transactional source of truth

**Status:** Accepted (Phase 1)

## Context

The platform will propagate changes through Kafka, cache reads in Redis and push updates over
WebSockets. Each of those copies can lag, be lost or be duplicated. Clients and services need
one place whose answer is definitive when copies disagree.

## Decision

All authoritative project-management state (users, workspaces, membership, projects, boards,
columns, tasks, assignees, comments) lives in PostgreSQL and is only changed inside PostgreSQL
transactions by the Project Service. Every other store is derived:

- Kafka carries notifications of committed changes (Phase 3–4, via a transactional outbox).
- Redis holds disposable copies of read models with finite TTLs (Phase 7).
- WebSocket messages are hints that tell clients to reconcile (Phase 6).

Whenever a derived copy is suspect, the recovery path is to re-read PostgreSQL.

## Alternatives considered

- **Kafka as the system of record (event sourcing).** Would make every read a projection and
  every invariant (membership, version checks) an asynchronous concern. The spec explicitly
  rules out event-sourcing the whole application, and the domain doesn't need it.
- **Separate databases per service from day one.** Adds cross-service consistency problems
  before there is more than one writer. Revisit if another service needs to own writes.

## Consequences

- Invariants (authorization, optimistic concurrency, referential integrity) are enforced with
  ordinary transactions and constraints, and are tested against a real PostgreSQL.
- Anything published elsewhere must be derived from a committed transaction. Direct
  dual-writes to Kafka are not allowed (see the outbox ADR in Phase 4).
- PostgreSQL availability bounds write availability. `/ready` reports not-ready without it,
  and requests fail with 503 `DEPENDENCY_UNAVAILABLE` instead of hanging or leaking errors.
