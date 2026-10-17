# Invalid runs (kept as raw evidence, never used as results)

- `b-hot-1`, `b-hot-2` (2026-10-17 12:35–13:02Z): **overlapping load**. `run.sh` picked the
  previous, finished workflow run as "its" run (API lag after dispatch), so `b-hot-1` returned
  early and its k6 run (dispatched 12:38) overlapped `b-hot-2` (dispatched 12:44). Bug ledger #26.
- `b-multi-1`, `b-multi-2` (13:03–13:14Z): **no load generated**. k6 setup aborted on an HTTP 503
  while seeding. Three statements (an outbox INSERT, a COMMIT and a ROLLBACK) exceeded the 15 s
  client query timeout. The cause was RDS storage-throughput burst exhaustion
  (`EBSByteBalance%` 0.0 from about 13:00Z) after about 3.5 h of benchmark writes. See
  docs/performance.md.
- `c-profile-load` (13:41–13:56Z): read-heavy at 150 VUs, intended as a profiling load. From 13:49Z
  project-service's pool timed out on the storage-throttled RDS (4,780 `timeout exceeded when
trying to connect`). CloudFront 5xx rose to 100 % from 13:52Z and k6 saw 50.7 % failures. The
  CPU profiles in `profiles/` were taken after the failure began, so they show an idle event loop
  waiting on the pool. They are not a profile of the CPU-bound state and are not used.
