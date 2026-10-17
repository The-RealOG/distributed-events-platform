# Load run `o-pre-8175-1`

## k6 (load generator view)

```
time="2026-10-17T10:51:58Z" level=info msg="MEASURE_T0=2026-10-17T10:51:58.246Z" source=console

ALL (steady scenario)      n=  35502  p50=   792  p95=  4205  p99=  5417  max=  8158 ms
  assign                   n=   1060  p50=   620  p95=  2978  p99=  3696  max=  4538 ms
  create                   n=   2556  p50=   606  p95=  2872  p99=  3626  max=  5353 ms
  unassign                 n=    746  p50=   527  p95=  2771  p99=  3507  max=  4544 ms
  activity                 n=   3634  p50=  1279  p95=  5435  p99=  6975  max=  7669 ms
  workspaces               n=   5368  p50=   451  p95=  2813  p99=  3462  max=  4796 ms
  delete                   n=    460  p50=   570  p95=  2909  p99=  3589  max=  7494 ms
  board                    n=  12410  p50=   754  p95=  4258  p99=  5276  max=  8158 ms
  projects                 n=   3613  p50=   823  p95=  4026  p99=  5129  max=  6364 ms
  comment                  n=    998  p50=   590  p95=  3011  p99=  3854  max=  4778 ms
  move                     n=   2391  p50=   682  p95=  3152  p99=  3709  max=  5366 ms
  update                   n=   2448  p50=   608  p95=  2982  p99=  3756  max=  4830 ms
  task                     n=   3691  p50=   846  p95=  4132  p99=  5132  max=  6365 ms
requests 40926 (63.4/s over 645 s incl. setup), failed 0.00 %
successful writes 10540 (16.3/s)
version conflicts (409) 119
board cache (client view, x-board-cache) hit 5054 / miss 7336 = 40.8 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       75.4      20.3  0.00    126    644    957        726         690       697        54.4    52
100      67.4      18.0  0.00    945   1949   2733       2015        1390      1359        35.6    31
200      54.5      14.3  0.00   3181   5200   6213       5073        3383      3578        23.8    24
  board (hit)              n=   5054  p50=   273  p95=  2603  p99=  3219  max=  4949 ms
  board (miss)             n=   7336  p50=  1322  p95=  4518  p99=  5817  max=  8158 ms
  board (bypass)           n=     20  p50=  1946  p95=  3750  p99=  3761  max=  3763 ms
time="2026-10-17T11:02:16Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 5054, misses 7356, errors 32 → hit rate **40.7 %**
- project-service HTTP responses by class: 2xx 40807, 4xx 119
- Outbox: published 10134; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 10134; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 10134; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 10134; retries 0; dead-lettered 0
- activity outcomes: processed 10134
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 87213 commits (117.3/s over 743 s between snapshots), rollbacks 121; tuples returned 12426117, fetched 2405768, inserted 36538, updated 26668, deleted 303; blocks read 3218, hit 5278178
- project-service memory at end: RSS 147 MiB, heap used 47 MiB
- api-gateway memory at end: RSS 138 MiB, heap used 29 MiB
- realtime-service memory at end: RSS 120 MiB, heap used 29 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 16.1 98.71 99.58 100.0 99.92 99.68 99.68 99.9 99.7 99.67 99.44 99.96 98.92 |
| ecs/project-service/MemoryUtilization | 34.08 | 17.58 21.68 26.46 26.86 27.64 27.54 28.03 28.22 28.91 29.0 29.2 29.1 34.08 |
| ecs/api-gateway/CPUUtilization | 50.77 | 15.9 50.77 42.58 41.04 41.66 39.72 34.9 38.18 32.93 39.28 31.45 34.71 34.56 |
| ecs/api-gateway/MemoryUtilization | 21.97 | 14.45 13.09 17.97 18.95 19.04 19.14 19.34 19.53 19.53 20.31 21.09 21.09 21.97 |
| ecs/outbox-publisher/CPUUtilization | 33.15 | 20.68 19.65 33.15 24.45 32.18 25.88 30.01 26.03 22.68 29.2 24.78 24.94 27.08 |
| ecs/outbox-publisher/MemoryUtilization | 21.48 | 18.07 15.04 16.8 20.8 20.9 21.09 21.09 21.19 21.19 21.39 21.29 21.39 21.48 |
| ecs/activity-service/CPUUtilization | 42.42 | 32.92 19.92 42.42 32.2 32.05 31.87 29.8 30.37 26.42 28.45 26.12 25.8 27.84 |
| ecs/activity-service/MemoryUtilization | 19.14 | 16.41 16.31 18.46 18.95 19.04 18.95 18.95 18.95 18.95 18.95 18.95 19.04 19.14 |
| ecs/realtime-service/CPUUtilization | 35.23 | 13.95 27.93 35.23 22.14 22.29 22.47 21.14 21.19 20.45 19.68 18.87 20.29 18.9 |
| ecs/realtime-service/MemoryUtilization | 19.73 | 11.52 19.73 14.45 15.23 15.33 17.77 17.77 17.77 17.97 17.97 18.16 18.16 18.16 |
| ecs/cache-invalidator/CPUUtilization | 35.21 | 16.37 22.69 35.21 26.74 25.83 27.29 23.1 23.94 23.35 22.28 21.7 22.32 23.59 |
| ecs/cache-invalidator/MemoryUtilization | 19.24 | 10.74 19.24 14.55 15.04 16.99 17.29 17.38 17.38 17.58 17.58 17.58 17.58 17.58 |
| rds/CPUUtilization | 35.98 | 6.5 7.26 27.25 24.65 26.67 21.89 19.96 19.74 25.98 27.06 29.04 35.98 |
| rds/DatabaseConnections | 14.0 | 1.0 12.0 14.0 12.0 14.0 12.0 12.0 12.0 12.0 3.0 |
| rds/ReadIOPS | 27.8 | 15.63 10.6 20.19 16.32 24.95 17.78 14.82 19.03 27.8 24.49 |
| rds/WriteIOPS | 71.88 | 9.78 41.63 60.31 60.18 70.45 56.31 71.88 59.79 60.1 51.22 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.45 | 0.72 0.72 0.9 1.27 1.42 1.42 1.37 1.4 1.42 1.45 1.35 1.37 1.42 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
