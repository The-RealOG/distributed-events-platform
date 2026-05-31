# ADR-014: Activity history as an asynchronous projection

**Status:** Accepted (Phase 6)

## Context

Each project needs a history ("Ada moved _Write spec_ to Done"). Every change the history
needs is already published as a domain event (ADR-010, ADR-011), and duplicate-safe consumption
exists (ADR-013). The question is where and when the history is written.

## Decision

A separate **Activity Service** consumes `domain.events` and writes an `activity_events`
projection. The request path does not write activity and never waits for it.

```
request → project-service → PostgreSQL (change + outbox) → 200
                                   outbox-publisher → Kafka → activity-service → activity_events
```

### Why asynchronous

- **Failure isolation.** If the Activity Service is down, slow or broken, task changes still
  succeed. Its events wait in Kafka, and it catches up when it returns.
- **No second write in the request.** Writing history synchronously would add work and failure
  modes to every mutation for data nobody reads in that request.
- **Kafka is the propagation mechanism.** The same committed events feed any number of
  consumers (activity now, cache invalidation in Phase 7, realtime and notifications later)
  without the Project Service knowing about them.

The cost is **eventual consistency**. After a change returns 200, `GET /tasks/:id` shows it at
once, but `GET /projects/:id/activity` lists it only after:

1. the publisher ships the event (poll interval 500 ms)
2. the Activity Service consumes and commits it

That lag is normally sub-second to a few seconds, and it grows during an outage. It is
acceptable because history is informational, not a basis for decisions. The UI says so ("updates
a few seconds after changes") and polls.

### Duplicate safety

The handler is `createIdempotentHandler` (ADR-013) with the fixed logical name
`activity-service`, which is also the Kafka consumer group. The processed marker and the
activity row commit in one transaction; the offset is committed after. A duplicate delivery
(E123, E123) produces one row.

`activity_events.event_id` is also UNIQUE. That is a _projection invariant_ (one entry per
event), not the deduplication mechanism. If code ever bypassed the Phase-5 primitive, a
duplicate would fail loudly on this constraint instead of silently doubling history.

### Structured facts, not sentences

Rows keep typed fields plus a small `data` object per event type:

| Event type                          | Retained                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| `task.created`                      | title, column                                               |
| `task.updated`                      | previous and current title, whether the description changed |
| `task.moved`                        | from and to column                                          |
| `task.deleted`                      | title, column                                               |
| `task.assigned` / `task.unassigned` | assignee                                                    |
| `comment.created`                   | the contract's bounded excerpt and length                   |

Wording lives in the UI, so it can change without rewriting history, and column names come
from the current board, so renames show up in old entries. Nothing beyond the event contract is
stored: no descriptions and no full comment bodies.

### Ordering

`id` (an identity column) is the persisted order. Rows are inserted in consumption order, and
for one project that is its Kafka partition order (key = projectId). That in turn is its outbox
order, since the publisher sends a project's events strictly in sequence (ADR-011). A
redelivered duplicate is skipped, so it cannot reorder anything.

There is no global order across projects, and none is claimed. The API pages newest-first by
`id` with an opaque cursor (`before=<id>`), so pages are stable while new activity arrives.

### Who serves the API

The projection has **one writer** (Activity Service) and is read by the Project Service at
`GET /projects/:id/activity`. The Project Service already owns project authorization and the
gateway's `/projects` route, so the endpoint reuses the same access check as the board. That
means no duplicated authorization logic, no new public ingress, and no gateway change.

The Activity Service therefore has only probes and no public routes. If the services later
split databases, the read endpoint moves to the Activity Service together with a membership
check; the contract stays the same.

### Health

- `/health`: the process is alive.
- `/ready`: the consumer is in its group and PostgreSQL answers.

Nothing else depends on the Activity Service's readiness.

## Consequences

- History lags changes briefly and can lag more during outages. It is never lost, only late,
  within Kafka retention (7 days on MSK by default).
- A new deployment of the Activity Service (new consumer group) replays the topic from the start,
  so events published before it existed are projected too.
- Poison messages that always fail in the handler still retry forever. The DLQ is Phase 9.
