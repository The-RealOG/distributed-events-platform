# Invalid runs (kept as raw evidence, never used as results)

- `b-hot-1`, `b-hot-2` (2026-10-17 12:35–13:02Z): **overlapping load**. `run.sh` picked the
  previous, finished workflow run as "its" run (API lag after dispatch), so `b-hot-1` returned
  early and its k6 run (dispatched 12:38) overlapped `b-hot-2` (dispatched 12:44). Bug ledger #26.
- `b-multi-1`, `b-multi-2` (13:03–13:14Z): **no load generated**. k6 setup aborted on an HTTP 503
  while seeding. Three statements (an outbox INSERT, a COMMIT and a ROLLBACK) exceeded the 15 s
  client query timeout. The cause was RDS storage-throughput burst exhaustion
  (`EBSByteBalance%` 0.0 from about 13:00Z) after about 3.5 h of benchmark writes. See
  docs/performance.md.
