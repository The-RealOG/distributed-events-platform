# ADR-008: Optimistic concurrency control for tasks

**Status:** Accepted (Phase 1)

## Context

Several people edit the same board at once. Without a guard, two clients that read the same
task and save different edits produce a lost update: the last writer silently overwrites the
first. Boards are mostly read and conflicts are rare, so blocking locks held across user
think-time are not acceptable.

## Decision

`tasks.version` is an integer starting at 1. Every mutating task operation that depends on the
client's view (`PATCH /tasks/:id`, `POST /tasks/:id/move`, `DELETE /tasks/:id`) carries the
`expectedVersion` the client last saw, and the write is a single conditional statement:

```sql
UPDATE tasks SET ..., version = version + 1, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL AND version = $expected
RETURNING *;
```

Zero rows means someone else changed or deleted the task first. The service re-reads the row
and responds **409 `VERSION_CONFLICT`** with `details.currentVersion`, or 404 if it's gone.
The client must refetch and decide; the server never merges or overwrites.

Why this is safe under PostgreSQL's default READ COMMITTED isolation: a concurrent `UPDATE`
on the same row blocks on the first writer's row lock, then re-evaluates its `WHERE` clause
against the newly committed row. The second writer's `version = $expected` no longer holds,
so it updates nothing. `test/concurrency.int.test.ts` forces exactly this interleaving with
two real transactions, and fails if the version predicate is removed (checked by mutation).

Assigning and unassigning commute with other edits, so they don't take `expectedVersion`.
They still increment the version when they change something, so the version increases
monotonically with every change to the task (future events rely on this as
`aggregateVersion`). Assigning the same user twice is a no-op and doesn't bump the version.

## Alternatives considered

- **Pessimistic locking (`SELECT … FOR UPDATE`) across the edit.** Holds locks for user
  think-time; doesn't work for a stateless HTTP API.
- **Last-write-wins with timestamps.** Loses data by design.
- **`If-Match`/ETag with 412.** Equivalent semantics; a body field was chosen for explicitness
  and because the spec calls for 409.
- **Field-level merge / CRDTs.** Much more complex; not justified for task titles.

## Consequences

- Clients must send versions and handle 409 by refetching. The frontend (Phase 2) shows the
  conflict and reloads authoritative state instead of retrying blindly.
- An assignment made between a user's read and their title edit will make the edit conflict.
  This is intentional: the user saved against a stale view.
