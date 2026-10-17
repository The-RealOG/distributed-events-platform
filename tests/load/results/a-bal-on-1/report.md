# Load run `a-bal-on-1`

## k6 (load generator view)

```
time="2026-10-17T07:30:14Z" level=info msg="MEASURE_T0=2026-10-17T07:30:14.059Z" source=console

ALL (steady scenario)      n=  46504  p50=   525  p95=  2799  p99=  3452  max=  4600 ms
  task                     n=   4886  p50=   515  p95=  2708  p99=  3030  max=  3881 ms
  projects                 n=   4680  p50=   500  p95=  2754  p99=  3095  max=  3591 ms
  create                   n=   3166  p50=   452  p95=  1999  p99=  2318  max=  2775 ms
  update                   n=   3195  p50=   458  p95=  1958  p99=  2272  max=  2725 ms
  delete                   n=    717  p50=   428  p95=  1944  p99=  2294  max=  2487 ms
  assign                   n=   1391  p50=   499  p95=  2070  p99=  2393  max=  2692 ms
  unassign                 n=    917  p50=   399  p95=  1913  p99=  2259  max=  2524 ms
  board                    n=  16340  p50=   450  p95=  2768  p99=  3157  max=  3810 ms
  workspaces               n=   7069  p50=   294  p95=  1781  p99=  2068  max=  2592 ms
  move                     n=   3242  p50=   510  p95=  2012  p99=  2320  max=  2734 ms
  comment                  n=   1443  p50=   456  p95=  1954  p99=  2244  max=  2409 ms
  activity                 n=   4624  p50=   728  p95=  3671  p99=  4130  max=  4600 ms
requests 53221 (82.8/s over 642 s incl. setup), failed 0.00 %
successful writes 13915 (21.7/s)
version conflicts (409) 156
board cache (client view, x-board-cache) hit 7260 / miss 9046 = 44.5 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       89.6      23.9  0.00     56    381    596        368         491       487        57.5    71
100      91.8      24.8  0.00    562   1256   1597       1279        1028      1070        43.4    33
200      76.9      20.6  0.00   2135   3313   3848       3114        2277      2281        26.7    40
  board (hit)              n=   7260  p50=   230  p95=  1676  p99=  2041  max=  3024 ms
  board (miss)             n=   9046  p50=   758  p95=  2942  p99=  3246  max=  3810 ms
  board (bypass)           n=     34  p50=  2333  p95=  3094  p99=  3367  max=  3480 ms
time="2026-10-17T07:40:32Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 7260, misses 9066, errors 61 → hit rate **44.5 %**
- project-service HTTP responses by class: 2xx 53065, 4xx 156
- Outbox: published 13299; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 13299; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 13299; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 13299; retries 0; dead-lettered 0
- activity outcomes: processed 13299
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 112321 commits (145.7/s over 771 s between snapshots), rollbacks 156; tuples returned 13926484, fetched 4103442, inserted 48144, updated 36620, deleted 1151; blocks read 0, hit 5025342
- project-service memory at end: RSS 140 MiB, heap used 54 MiB
- api-gateway memory at end: RSS 135 MiB, heap used 28 MiB
- realtime-service memory at end: RSS 118 MiB, heap used 43 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 22.42 9.14 98.01 97.43 97.43 97.45 99.41 100.0 99.62 99.51 99.68 99.76 99.69 |
| ecs/project-service/MemoryUtilization | 32.13 | 26.66 20.12 32.13 30.76 31.45 31.84 31.64 30.37 30.86 31.05 31.54 31.84 31.93 |
| ecs/api-gateway/CPUUtilization | 59.65 | 15.29 5.61 51.6 54.51 59.65 50.84 53.86 53.21 48.5 46.95 46.48 43.88 40.47 |
| ecs/api-gateway/MemoryUtilization | 21.0 | 14.94 11.43 18.55 18.36 19.43 18.85 18.95 19.43 19.63 20.21 20.61 20.61 21.0 |
| ecs/outbox-publisher/CPUUtilization | 41.42 | 21.51 6.52 39.47 41.42 31.97 39.66 34.93 35.56 36.72 39.34 32.22 34.36 33.85 |
| ecs/outbox-publisher/MemoryUtilization | 22.56 | 20.51 18.07 18.36 21.68 21.97 22.17 21.88 21.97 22.07 22.07 22.17 21.58 22.56 |
| ecs/activity-service/CPUUtilization | 60.24 | 15.38 32.14 60.24 34.06 36.59 34.8 34.39 38.64 34.87 32.89 32.16 29.84 32.0 |
| ecs/activity-service/MemoryUtilization | 22.75 | 19.34 22.75 19.43 20.41 20.51 20.51 20.51 20.51 20.51 20.51 20.51 20.51 20.51 |
| ecs/realtime-service/CPUUtilization | 31.51 | 14.32 31.51 30.65 26.35 25.02 25.27 23.89 24.96 26.49 25.1 23.18 22.53 21.87 |
| ecs/realtime-service/MemoryUtilization | 25.59 | 18.95 25.59 18.95 18.95 18.75 18.85 18.75 18.75 18.75 18.75 18.95 18.85 18.85 |
| ecs/cache-invalidator/CPUUtilization | 34.87 | 15.19 26.74 34.87 27.7 28.25 28.3 29.58 27.89 29.83 29.54 32.48 26.27 25.72 |
| ecs/cache-invalidator/MemoryUtilization | 19.04 | 15.23 19.04 15.53 15.82 17.58 17.68 17.97 17.97 17.97 17.97 18.07 18.07 17.97 |
| rds/CPUUtilization | 15.7 | 4.48 4.8 14.5 12.77 13.44 13.46 13.74 15.53 15.7 13.97 14.48 15.05 13.24 |
| rds/DatabaseConnections | 14.0 | 1.0 8.0 12.0 14.0 14.0 12.0 13.0 14.0 12.0 13.0 13.0 12.0 2.0 |
| rds/ReadIOPS | 14.28 | 0.0 0.23 12.6 0.22 0.45 0.23 0.03 12.29 2.86 0.63 0.78 1.53 14.28 |
| rds/WriteIOPS | 105.37 | 0.5 8.11 105.37 68.87 76.23 75.19 68.44 90.23 77.03 67.92 66.19 63.47 48.27 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.67 | 0.7 0.7 0.72 1.52 1.48 1.55 1.58 1.55 1.65 1.67 1.55 1.6 1.58 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
