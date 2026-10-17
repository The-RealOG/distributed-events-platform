# Load run `a-bal-on-2`

## k6 (load generator view)

```
time="2026-10-17T07:45:58Z" level=info msg="MEASURE_T0=2026-10-17T07:45:58.281Z" source=console

ALL (steady scenario)      n=  46485  p50=   507  p95=  2811  p99=  3525  max=  4588 ms
  move                     n=   3203  p50=   498  p95=  2017  p99=  2428  max=  3016 ms
  task                     n=   4855  p50=   476  p95=  2699  p99=  3103  max=  3646 ms
  create                   n=   3192  p50=   425  p95=  1956  p99=  2277  max=  3569 ms
  unassign                 n=    912  p50=   380  p95=  1889  p99=  2147  max=  2555 ms
  board                    n=  16381  p50=   437  p95=  2756  p99=  3202  max=  3828 ms
  update                   n=   3282  p50=   432  p95=  1976  p99=  2379  max=  2953 ms
  activity                 n=   4781  p50=   715  p95=  3720  p99=  4172  max=  4588 ms
  assign                   n=   1384  p50=   478  p95=  2017  p99=  2435  max=  2965 ms
  delete                   n=    733  p50=   454  p95=  1982  p99=  2369  max=  2951 ms
  comment                  n=   1414  p50=   430  p95=  1956  p99=  2369  max=  2570 ms
  workspaces               n=   6886  p50=   277  p95=  1747  p99=  2107  max=  3492 ms
  projects                 n=   4638  p50=   488  p95=  2696  p99=  3018  max=  3582 ms
requests 53212 (83.1/s over 640 s incl. setup), failed 0.00 %
successful writes 13966 (21.8/s)
version conflicts (409) 154
board cache (client view, x-board-cache) hit 7154 / miss 9184 = 43.8 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       89.8      24.2  0.00     53    416    685        406         463       552        57.0    54
100      92.2      25.2  0.00    539   1326   1723       1347        1116      1089        41.6    45
200      76.2      20.1  0.00   2187   3390   3878       3143        2211      2318        25.8    45
  board (hit)              n=   7154  p50=   204  p95=  1698  p99=  2057  max=  2729 ms
  board (miss)             n=   9184  p50=   758  p95=  2946  p99=  3342  max=  3828 ms
  board (bypass)           n=     43  p50=  2484  p95=  3139  p99=  3293  max=  3396 ms
time="2026-10-17T07:56:16Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 7154, misses 9204, errors 71 → hit rate **43.7 %**
- project-service HTTP responses by class: 2xx 53058, 4xx 154
- Outbox: published 13337; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 13337; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 13337; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 13337; retries 0; dead-lettered 0
- activity outcomes: processed 13337
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 112583 commits (147.1/s over 766 s between snapshots), rollbacks 154; tuples returned 13765472, fetched 4055425, inserted 47863, updated 35974, deleted 751; blocks read 0, hit 5462267
- project-service memory at end: RSS 141 MiB, heap used 57 MiB
- api-gateway memory at end: RSS 138 MiB, heap used 36 MiB
- realtime-service memory at end: RSS 116 MiB, heap used 41 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 99.98 | 29.87 11.39 97.12 97.75 98.58 98.12 99.59 99.9 99.98 99.66 99.84 99.75 99.69 |
| ecs/project-service/MemoryUtilization | 32.42 | 29.98 22.46 32.42 31.64 31.74 31.64 31.74 31.15 31.35 32.13 32.13 31.84 32.23 |
| ecs/api-gateway/CPUUtilization | 56.13 | 17.67 48.7 53.84 56.13 53.0 49.32 52.93 49.2 52.08 46.64 43.97 44.85 39.43 |
| ecs/api-gateway/MemoryUtilization | 21.48 | 17.09 15.43 19.04 18.75 18.85 18.95 19.14 19.34 19.43 20.41 20.8 20.7 21.48 |
| ecs/outbox-publisher/CPUUtilization | 40.25 | 23.18 22.51 34.32 28.94 36.31 35.63 31.93 37.39 34.46 36.09 40.25 35.96 36.9 |
| ecs/outbox-publisher/MemoryUtilization | 27.05 | 27.05 22.36 22.36 24.02 23.44 22.56 16.99 17.38 18.55 18.75 18.55 21.58 21.0 |
| ecs/activity-service/CPUUtilization | 36.16 | 15.26 22.01 32.26 34.84 32.1 32.02 36.16 34.02 31.37 30.02 30.7 34.16 27.88 |
| ecs/activity-service/MemoryUtilization | 27.25 | 20.9 27.25 21.39 21.09 20.9 20.9 20.7 20.7 20.8 20.7 20.7 20.8 20.8 |
| ecs/realtime-service/CPUUtilization | 36.64 | 14.48 22.16 36.64 24.19 23.9 24.65 25.12 24.47 26.34 22.23 24.65 23.17 20.19 |
| ecs/realtime-service/MemoryUtilization | 25.68 | 19.14 25.68 19.43 19.43 18.95 18.95 18.95 18.95 18.95 19.04 19.04 19.04 19.14 |
| ecs/cache-invalidator/CPUUtilization | 40.06 | 15.67 30.49 40.06 26.68 26.26 27.6 28.59 27.17 29.56 25.71 25.78 24.97 24.37 |
| ecs/cache-invalidator/MemoryUtilization | 24.02 | 18.16 24.02 18.55 18.46 18.36 18.36 18.26 18.16 18.26 18.26 18.16 18.16 18.16 |
| rds/CPUUtilization | 17.04 | 4.81 6.8 14.8 13.62 14.63 16.41 17.04 16.27 16.69 14.42 15.45 16.06 9.48 |
| rds/DatabaseConnections | 14.0 | 1.0 12.0 13.0 14.0 12.0 13.0 13.0 12.0 13.0 12.0 12.0 14.0 1.0 |
| rds/ReadIOPS | 16.24 | 0.33 10.38 1.58 1.45 1.6 2.4 16.24 2.15 3.05 3.63 3.87 14.7 4.02 |
| rds/WriteIOPS | 89.13 | 1.5 55.83 74.39 71.51 78.33 74.47 89.13 76.05 80.12 61.61 61.17 80.67 18.09 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.77 | 0.7 0.7 0.92 1.4 1.55 1.55 1.5 1.68 1.77 1.72 1.57 1.6 1.63 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
