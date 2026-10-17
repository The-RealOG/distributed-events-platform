# Load run `b-multi-1`

## k6 (load generator view)

```
ALL (steady scenario)      n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  assign                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  comment                  n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  move                     n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  board                    n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  activity                 n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  update                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  workspaces               n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  delete                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  create                   n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  task                     n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  projects                 n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
  unassign                 n=      0  p50=   0.0  p95=   0.0  p99=   0.0  max=   0.0 ms
requests 1112 (20.3/s over 55 s incl. setup), failed 0.09 %
successful writes 0 (0.0/s)
version conflicts (409) 0

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50        0.0       0.0  0.00    0.0    0.0    0.0        0.0         0.0       0.0         0.0     0
100       0.0       0.0  0.00    0.0    0.0    0.0        0.0         0.0       0.0         0.0     0
200       0.0       0.0  0.00    0.0    0.0    0.0        0.0         0.0       0.0         0.0     0
time="2026-10-17T13:06:14Z" level=error msg="Error: project: HTTP 503\n\tat seed (file:///home/runner/work/distributed-events-platform/distributed-events-platform/tests/load/lib/seed.js:52:34(200))\n\tat setup (file:///home/runner/work/distributed-events-platform/distributed-events-platform/tests/load/http.js:124:20(3))\n" hint="script exception"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 1111, 4xx 0, 5xx 0
- Outbox: published 0; failures 0; pending after None; oldest pending age after None s
- activity-service consumer messages: processed 0; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 0; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 0; retries 0; dead-lettered 0
- activity outcomes: duplicate 0, failed 0, processed 0
- realtime hub: duplicate_suppressed 0; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 1423 commits (8.3/s over 172 s between snapshots), rollbacks 6; tuples returned 933060, fetched 10152, inserted 1122, updated 0, deleted 0; blocks read 11855, hit 82711
- project-service memory at end: RSS 117 MiB, heap used 46 MiB
- api-gateway memory at end: RSS 123 MiB, heap used 26 MiB
- realtime-service memory at end: RSS 116 MiB, heap used 34 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 89.28 | 8.97 89.28 22.56 |
| ecs/project-service/MemoryUtilization | 35.94 | 25.1 27.83 35.94 |
| ecs/api-gateway/CPUUtilization | 50.64 | 23.08 50.64 7.12 |
| ecs/api-gateway/MemoryUtilization | 19.04 | 17.38 18.36 19.04 |
| ecs/outbox-publisher/CPUUtilization | 30.32 | 30.32 19.89 20.67 |
| ecs/outbox-publisher/MemoryUtilization | 24.22 | 24.22 23.24 23.24 |
| ecs/activity-service/CPUUtilization | 18.88 | 18.88 12.58 12.72 |
| ecs/activity-service/MemoryUtilization | 25.98 | 25.98 19.53 19.53 |
| ecs/realtime-service/CPUUtilization | 26.39 | 14.94 26.39 14.66 |
| ecs/realtime-service/MemoryUtilization | 26.46 | 19.14 26.46 19.53 |
| ecs/cache-invalidator/CPUUtilization | 19.71 | 15.5 19.71 13.24 |
| ecs/cache-invalidator/MemoryUtilization | 23.14 | 19.24 23.14 18.36 |
| rds/CPUUtilization | 8.67 | 8.67 8.15 4.57 |
| rds/DatabaseConnections | 1.0 | 1.0 1.0 |
| rds/ReadIOPS | 134.18 | 134.18 |
| rds/WriteIOPS | 8.72 | 8.72 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.72 | 0.7 0.72 0.7 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 |
