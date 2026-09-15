# ADR-022: Attachment metadata and object consistency: pending → ready → deleted, and a sweep

**Status:** Accepted (Phase 9)

## Context

An attachment is a PostgreSQL row plus an S3 object. There is no transaction spanning both.
Every step can fail independently: the browser may never upload, may upload and never call
`complete`, S3 may be down during a delete.

## Decision

A small state machine on `attachments.status`, with PostgreSQL deciding what users see:

| State     | Visible? | How it gets there                                          |
| --------- | -------- | ---------------------------------------------------------- |
| `pending` | no       | upload requested (row created before the URL is returned)  |
| `ready`   | yes      | `complete`: HEAD found the object and its size ≤ declared  |
| `deleted` | no       | user delete, or the sweep abandoned a stale pending upload |

- **Only `ready` rows are listed or downloadable.** An object without a ready row is never
  served, because the download URL is only issued for ready rows.
- **Delete** is two steps: mark `deleted` (authoritative, immediate), then delete the object
  and set `object_deleted_at`. If the object delete fails, the user still sees the attachment
  gone; the sweep retries. Repeating a delete is a no-op (204).
- **Sweep** (every 10 min, one replica at a time via a PostgreSQL advisory lock):
  (a) `pending` older than 1 h → delete any object, mark deleted; (b) `deleted` with
  `object_deleted_at IS NULL` → retry the object delete. Partial indexes keep both scans cheap.
- **Oversized objects** (only possible outside our signed POST) are refused at `complete` and
  removed.
- Orphan objects without any row cannot be created by this design (keys are generated after
  the row exists and include its ID); an S3 lifecycle rule also aborts incomplete multipart
  uploads after 7 days.

## Consequences

- Consistency is **coordinated, not atomic**: at worst an object outlives its row by one sweep
  interval, and it is unreachable meanwhile. Users never see a ready attachment without bytes.
- Tests: `apps/project-service/test/attachments.int.test.ts` (lifecycle, never-uploaded,
  oversize, authorization, sweep, outage), deliberate breaks `p9-07`, `p9-08`, `p9-09`.
