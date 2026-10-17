# Load run `b-multi-2`

## k6 (load generator view)

```
ALL (steady scenario)      n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  projects                 n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  task                     n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  create                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  workspaces               n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  board                    n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  assign                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  update                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  move                     n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  comment                  n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  activity                 n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  delete                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  unassign                 n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
requests 1265 (26.5/s over 48 s incl. setup), failed 0.16 %
successful writes 0 (0.0/s)
version conflicts (409) 0

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50        0.0       0.0  0.00    0.0    0.0    0.0        0.0         0.0       0.0         0.0     0
100       0.0       0.0  0.00    0.0    0.0    0.0        0.0         0.0       0.0         0.0     0
200       0.0       0.0  0.00    0.0    0.0    0.0        0.0         0.0       0.0         0.0     0
time="2026-10-17T13:12:11Z" level=error msg="Error: seed task: HTTP 503\n\tat seed (file:///home/runner/work/distributed-events-platform/distributed-events-platform/tests/load/lib/seed.js:74:37(329))\n\tat setup (file:///home/runner/work/distributed-events-platform/distributed-events-platform/tests/load/http.js:124:20(3))\n" hint="script exception"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 0, misses 7, errors 0 → hit rate **0.0 %**
- project-service HTTP responses by class: 2xx 1263, 4xx 0, 5xx 0
- Outbox: published 0; failures 0; pending after None; oldest pending age after None s
- activity-service consumer messages: processed 139; retries 1; dead-lettered 0
- cache-invalidator consumer messages: processed 139; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 139; retries 0; dead-lettered 0
- activity outcomes: duplicate 0, failed 1, processed 139
- realtime hub: duplicate_suppressed 0; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 1934 commits (11.1/s over 175 s between snapshots), rollbacks 7; tuples returned 1714389, fetched 24195, inserted 1717, updated 289, deleted 2; blocks read 23973, hit 190646
- project-service memory at end: RSS 123 MiB, heap used 33 MiB
- api-gateway memory at end: RSS 127 MiB, heap used 29 MiB
- realtime-service memory at end: RSS 116 MiB, heap used 39 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 75.31 | 13.42 75.31 23.35 |
| ecs/project-service/MemoryUtilization | 40.92 | 36.43 32.23 40.92 |
| ecs/api-gateway/CPUUtilization | 32.52 | 17.07 32.52 8.04 |
| ecs/api-gateway/MemoryUtilization | 24.12 | 24.12 19.34 19.92 |
| ecs/outbox-publisher/CPUUtilization | 25.55 | 25.55 23.64 24.93 |
| ecs/outbox-publisher/MemoryUtilization | 25.68 | 25.68 22.56 23.34 |
| ecs/activity-service/CPUUtilization | 21.6 | 21.6 16.76 13.62 |
| ecs/activity-service/MemoryUtilization | 26.17 | 26.17 19.92 19.92 |
| ecs/realtime-service/CPUUtilization | 25.77 | 14.73 25.77 14.76 |
| ecs/realtime-service/MemoryUtilization | 28.03 | 19.34 28.03 20.12 |
| ecs/cache-invalidator/CPUUtilization | 19.71 | 13.28 19.71 15.97 |
| ecs/cache-invalidator/MemoryUtilization | 24.12 | 18.16 24.12 18.36 |
| rds/CPUUtilization | 11.09 | 8.0 11.09 7.21 |
| rds/DatabaseConnections | 4.0 | 1.0 4.0 |
| rds/ReadIOPS | 123.05 | 123.05 72.09 |
| rds/WriteIOPS | 24.37 | 0.37 24.37 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.73 | 0.72 0.72 0.73 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 |
