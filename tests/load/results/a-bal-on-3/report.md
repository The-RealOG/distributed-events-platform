# Load run `a-bal-on-3`

## k6 (load generator view)

```
time="2026-10-17T08:02:11Z" level=info msg="MEASURE_T0=2026-10-17T08:02:11.265Z" source=console

ALL (steady scenario)      n=  46180  p50=   527  p95=  2798  p99=  3489  max=  4497 ms
  assign                   n=   1410  p50=   506  p95=  2015  p99=  2424  max=  2643 ms
  projects                 n=   4596  p50=   502  p95=  2691  p99=  3007  max=  3663 ms
  comment                  n=   1394  p50=   416  p95=  1947  p99=  2300  max=  2624 ms
  workspaces               n=   6922  p50=   299  p95=  1757  p99=  2063  max=  2427 ms
  move                     n=   3243  p50=   515  p95=  2028  p99=  2392  max=  2970 ms
  delete                   n=    742  p50=   499  p95=  1995  p99=  2246  max=  2383 ms
  board                    n=  16403  p50=   438  p95=  2785  p99=  3119  max=  3901 ms
  task                     n=   4858  p50=   517  p95=  2728  p99=  2997  max=  3578 ms
  update                   n=   3197  p50=   446  p95=  1949  p99=  2273  max=  2528 ms
  unassign                 n=    978  p50=   374  p95=  1859  p99=  2155  max=  2485 ms
  create                   n=   3186  p50=   437  p95=  1906  p99=  2287  max=  2688 ms
  activity                 n=   4595  p50=   694  p95=  3691  p99=  4043  max=  4497 ms
requests 53075 (82.7/s over 642 s incl. setup), failed 0.00 %
successful writes 13971 (21.8/s)
version conflicts (409) 179
board cache (client view, x-board-cache) hit 7235 / miss 9129 = 44.2 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       88.2      23.8  0.00     57    407    607        391         488       520        58.2    51
100      91.9      25.2  0.00    563   1265   1639       1277         967      1079        41.7    56
200      76.4      20.6  0.00   2166   3328   3823       3080        2279      2337        25.1    55
  board (hit)              n=   7235  p50=   205  p95=  1690  p99=  1966  max=  2709 ms
  board (miss)             n=   9129  p50=   776  p95=  2956  p99=  3186  max=  3901 ms
  board (bypass)           n=     39  p50=  2414  p95=  2986  p99=  3032  max=  3040 ms
time="2026-10-17T08:12:29Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 7235, misses 9149, errors 66 → hit rate **44.2 %**
- project-service HTTP responses by class: 2xx 52896, 4xx 179
- Outbox: published 13331; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 13331; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 13331; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 13331; retries 0; dead-lettered 0
- activity outcomes: processed 13331
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 111829 commits (147.6/s over 758 s between snapshots), rollbacks 179; tuples returned 15347865, fetched 3832414, inserted 47774, updated 35771, deleted 694; blocks read 0, hit 5565761
- project-service memory at end: RSS 138 MiB, heap used 40 MiB
- api-gateway memory at end: RSS 134 MiB, heap used 27 MiB
- realtime-service memory at end: RSS 116 MiB, heap used 36 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 29.86 7.99 98.14 96.31 97.69 98.56 99.98 100.0 99.68 99.96 99.88 99.72 100.0 |
| ecs/project-service/MemoryUtilization | 32.13 | 28.61 20.61 31.64 32.13 31.93 31.84 30.86 31.05 31.15 31.54 31.93 31.93 32.13 |
| ecs/api-gateway/CPUUtilization | 57.32 | 12.58 14.58 52.36 54.6 57.32 48.54 50.51 52.93 50.86 50.57 47.61 44.14 45.67 |
| ecs/api-gateway/MemoryUtilization | 21.0 | 17.19 12.01 18.95 18.85 19.04 19.04 19.34 19.43 19.92 20.31 21.0 20.9 20.9 |
| ecs/outbox-publisher/CPUUtilization | 38.38 | 24.96 24.97 36.44 36.42 35.62 38.38 33.96 32.58 37.57 32.02 30.75 33.43 28.71 |
| ecs/outbox-publisher/MemoryUtilization | 24.71 | 21.58 24.71 22.07 22.36 22.85 22.95 23.05 23.05 22.85 22.95 23.05 22.95 22.75 |
| ecs/activity-service/CPUUtilization | 47.35 | 17.83 22.94 47.35 36.18 32.76 36.04 32.41 32.43 31.67 30.23 34.71 30.67 28.8 |
| ecs/activity-service/MemoryUtilization | 25.68 | 20.7 25.68 21.29 21.29 20.9 20.9 20.7 20.7 20.8 20.7 20.8 20.8 20.9 |
| ecs/realtime-service/CPUUtilization | 27.4 | 14.48 27.4 24.59 23.45 23.89 23.41 22.58 23.4 23.69 22.5 22.69 23.18 22.0 |
| ecs/realtime-service/MemoryUtilization | 24.22 | 19.43 24.22 19.63 19.63 19.34 19.34 19.34 19.14 19.14 19.14 19.14 19.24 19.14 |
| ecs/cache-invalidator/CPUUtilization | 28.82 | 15.59 25.8 25.97 26.31 26.26 25.85 28.28 28.82 26.73 27.09 24.6 24.84 23.93 |
| ecs/cache-invalidator/MemoryUtilization | 24.41 | 18.36 24.41 18.55 18.55 18.36 18.26 18.36 18.36 18.26 18.26 18.26 18.36 18.26 |
| rds/CPUUtilization | 18.34 | 5.74 4.73 15.29 13.71 15.65 16.11 15.72 16.09 16.09 15.04 18.34 15.92 11.79 |
| rds/DatabaseConnections | 14.0 | 2.0 7.0 12.0 13.0 12.0 12.0 14.0 12.0 12.0 13.0 12.0 12.0 1.0 |
| rds/ReadIOPS | 18.85 | 10.9 1.1 2.74 3.18 3.7 14.54 6.66 4.27 3.91 4.4 18.85 5.92 4.38 |
| rds/WriteIOPS | 90.51 | 9.54 21.42 90.51 70.7 72.38 88.61 71.43 82.26 76.13 65.65 83.21 65.74 35.69 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.68 | 0.7 0.7 0.75 1.5 1.5 1.58 1.57 1.52 1.67 1.68 1.55 1.67 1.63 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
