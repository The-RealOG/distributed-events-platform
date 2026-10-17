# Load run `a-bal-off-2`

## k6 (load generator view)

```
time="2026-10-17T09:33:25Z" level=info msg="MEASURE_T0=2026-10-17T09:33:25.565Z" source=console

ALL (steady scenario)      n=  47611  p50=   480  p95=  2654  p99=  3329  max=  4688 ms
  comment                  n=   1356  p50=   430  p95=  1891  p99=  2360  max=  2501 ms
  update                   n=   3322  p50=   422  p95=  1885  p99=  2295  max=  2613 ms
  projects                 n=   4797  p50=   408  p95=  2512  p99=  2996  max=  3697 ms
  delete                   n=    706  p50=   416  p95=  1897  p99=  2275  max=  2504 ms
  assign                   n=   1459  p50=   468  p95=  1918  p99=  2373  max=  2617 ms
  unassign                 n=    957  p50=   372  p95=  1838  p99=  2243  max=  2471 ms
  task                     n=   4952  p50=   440  p95=  2613  p99=  3073  max=  3670 ms
  activity                 n=   4872  p50=   586  p95=  3553  p99=  4000  max=  4688 ms
  move                     n=   3315  p50=   476  p95=  1955  p99=  2382  max=  2620 ms
  create                   n=   3201  p50=   397  p95=  1831  p99=  2256  max=  2601 ms
  workspaces               n=   7214  p50=   272  p95=  1664  p99=  2111  max=  2490 ms
  board                    n=  16450  p50=   448  p95=  2623  p99=  3062  max=  3695 ms
requests 54152 (82.9/s over 653 s incl. setup), failed 0.00 %
successful writes 14143 (21.7/s)
version conflicts (409) 173

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       87.9      23.6  0.00     78    324    500        307         385       466         0.0    59
100      98.3      26.8  0.00    497   1140   1487       1162         909       999         0.0    53
200      78.3      21.1  0.00   2121   3179   3749       3011        2247      2330         0.0    48
  board (bypass)           n=  16450  p50=   448  p95=  2623  p99=  3062  max=  3695 ms
time="2026-10-17T09:43:43Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 53983, 4xx 173
- Outbox: published 13520; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 13520; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 13520; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 13520; retries 0; dead-lettered 0
- activity outcomes: processed 13520
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 121647 commits (158.4/s over 768 s between snapshots), rollbacks 173; tuples returned 22393164, fetched 4507529, inserted 48164, updated 36043, deleted 536; blocks read 0, hit 7642218
- project-service memory at end: RSS 141 MiB, heap used 49 MiB
- api-gateway memory at end: RSS 135 MiB, heap used 40 MiB
- realtime-service memory at end: RSS 113 MiB, heap used 40 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 19.55 8.8 97.88 97.33 96.33 97.44 96.28 99.77 99.77 99.8 99.53 100.0 99.91 |
| ecs/project-service/MemoryUtilization | 32.03 | 28.12 20.21 30.47 32.03 30.47 30.47 30.57 30.27 30.57 30.66 31.74 31.45 31.35 |
| ecs/api-gateway/CPUUtilization | 55.06 | 8.46 4.07 49.44 53.15 53.9 48.12 51.55 55.06 50.37 51.13 47.19 45.22 46.18 |
| ecs/api-gateway/MemoryUtilization | 21.58 | 17.48 12.11 19.04 19.34 19.53 19.24 19.43 19.73 19.82 20.12 21.09 21.19 21.58 |
| ecs/outbox-publisher/CPUUtilization | 43.44 | 29.86 21.74 43.44 29.67 33.77 35.82 31.26 34.26 33.38 31.91 32.16 34.77 28.48 |
| ecs/outbox-publisher/MemoryUtilization | 25.49 | 24.51 25.49 24.02 24.51 24.12 24.32 24.12 24.61 24.32 23.93 23.83 23.83 24.02 |
| ecs/activity-service/CPUUtilization | 37.17 | 15.38 22.15 28.11 30.51 35.77 34.04 31.67 32.87 37.17 35.51 28.5 28.77 28.61 |
| ecs/activity-service/MemoryUtilization | 23.24 | 19.73 23.24 19.92 20.31 20.9 20.41 20.31 20.61 20.7 20.12 20.02 20.12 20.12 |
| ecs/realtime-service/CPUUtilization | 33.52 | 14.38 33.52 25.64 22.84 23.71 22.87 22.54 28.41 24.1 23.54 22.16 22.5 21.85 |
| ecs/realtime-service/MemoryUtilization | 23.44 | 19.92 23.44 19.92 19.92 19.63 19.63 19.53 19.73 19.63 19.53 19.53 19.53 19.53 |
| ecs/cache-invalidator/CPUUtilization | 29.66 | 15.61 22.48 29.66 25.61 27.98 29.08 26.05 28.81 26.44 27.42 26.15 25.76 24.6 |
| ecs/cache-invalidator/MemoryUtilization | 23.54 | 18.16 23.54 18.26 18.55 18.75 18.16 19.34 19.34 19.34 19.34 19.34 19.43 19.34 |
| rds/CPUUtilization | 21.74 | 4.61 4.65 12.16 14.65 16.89 16.74 16.57 18.02 18.77 21.74 17.81 17.81 16.51 |
| rds/DatabaseConnections | 14.0 | 1.0 7.0 12.0 13.0 12.0 12.0 14.0 12.0 12.0 13.0 12.0 12.0 2.0 1.0 |
| rds/ReadIOPS | 22.24 | 0.92 1.1 4.0 5.1 15.66 6.96 5.3 5.54 6.34 22.24 7.84 8.21 7.52 3.65 |
| rds/WriteIOPS | 87.37 | 2.54 7.52 72.77 66.1 85.77 73.4 79.04 87.37 79.37 79.03 67.53 75.36 49.77 2.6 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.03 | 0.7 0.72 0.7 0.98 0.97 0.98 0.98 0.97 1.02 1.03 0.95 0.97 0.97 0.85 |
| redis/dpp-dev-001/CurrConnections | 6.0 | 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 |
