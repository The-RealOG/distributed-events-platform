# Load run `b-multi-2r`

## k6 (load generator view)

```
time="2026-10-17T16:19:26Z" level=info msg="MEASURE_T0=2026-10-17T16:19:26.805Z" source=console

ALL (steady scenario)      n=  52309  p50=   409  p95=  2333  p99=  2990  max=  4013 ms
  comment                  n=   1501  p50=   385  p95=  1711  p99=  2017  max=  2474 ms
  task                     n=   5378  p50=   373  p95=  2314  p99=  2626  max=  3177 ms
  move                     n=   3637  p50=   435  p95=  1749  p99=  2032  max=  2583 ms
  update                   n=   3476  p50=   376  p95=  1683  p99=  1988  max=  2473 ms
  board                    n=  18496  p50=   343  p95=  2269  p99=  2635  max=  3352 ms
  activity                 n=   5160  p50=   520  p95=  3104  p99=  3489  max=  4013 ms
  workspaces               n=   7826  p50=   238  p95=  1475  p99=  1774  max=  2305 ms
  create                   n=   3432  p50=   375  p95=  1651  p99=  1921  max=  2497 ms
  unassign                 n=   1024  p50=   330  p95=  1633  p99=  1906  max=  2350 ms
  assign                   n=   1509  p50=   444  p95=  1730  p99=  2099  max=  2522 ms
  delete                   n=    847  p50=   478  p95=  1735  p99=  2048  max=  2395 ms
  projects                 n=   5227  p50=   382  p95=  2217  p99=  2598  max=  3196 ms
requests 59944 (90.5/s over 662 s incl. setup), failed 0.00 %
successful writes 15273 (23.1/s)
version conflicts (409) 153
board cache (client view, x-board-cache) hit 10022 / miss 8437 = 54.3 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       89.9      24.2  0.00     58    315    489        306         377       428        58.9    43
100     108.8      28.3  0.00    398   1028   1379       1041         913       956        56.5    49
200      91.9      24.6  0.00   1640   2828   3211       2558        1870      1940        46.1    50
  board (hit)              n=  10022  p50=   254  p95=  1501  p99=  1848  max=  2344 ms
  board (miss)             n=   8437  p50=   532  p95=  2473  p99=  2840  max=  3352 ms
  board (bypass)           n=     37  p50=  1912  p95=  2599  p99=  2972  max=  3153 ms
time="2026-10-17T16:29:44Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 10022, misses 8497, errors 58 → hit rate **54.1 %**
- project-service HTTP responses by class: 2xx 59791, 4xx 153, 5xx 0
- Outbox: published 15345; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 15345; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 15345; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 15345; retries 0; dead-lettered 0
- activity outcomes: processed 15345
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 124517 commits (157.2/s over 792 s between snapshots), rollbacks 153; tuples returned 10726990, fetched 4744928, inserted 55265, updated 40718, deleted 723; blocks read 0, hit 4995955
- project-service memory at end: RSS 149 MiB, heap used 53 MiB
- api-gateway memory at end: RSS 138 MiB, heap used 35 MiB
- realtime-service memory at end: RSS 119 MiB, heap used 37 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 28.75 56.85 92.76 96.27 96.35 95.62 99.75 99.67 99.94 100.0 99.78 100.0 100.0 |
| ecs/project-service/MemoryUtilization | 32.32 | 27.73 22.66 29.1 29.3 29.69 30.27 29.88 31.05 31.35 31.35 31.54 32.32 32.13 |
| ecs/api-gateway/CPUUtilization | 58.83 | 18.04 4.2 51.38 54.16 53.55 50.83 50.28 58.83 55.14 54.43 49.65 49.48 51.41 |
| ecs/api-gateway/MemoryUtilization | 21.58 | 15.72 12.11 18.75 18.75 18.85 18.85 18.85 19.14 19.34 19.63 20.9 21.39 21.58 |
| ecs/outbox-publisher/CPUUtilization | 40.79 | 18.6 16.71 40.79 28.51 27.62 24.59 29.49 30.13 27.87 29.71 27.24 25.82 28.61 |
| ecs/outbox-publisher/MemoryUtilization | 27.44 | 27.44 21.68 22.75 22.46 23.05 22.85 22.36 22.56 22.85 22.66 22.75 22.85 22.56 22.46 |
| ecs/activity-service/CPUUtilization | 46.52 | 22.39 18.39 46.52 30.06 30.25 29.48 27.72 32.22 30.57 29.69 28.98 28.24 28.55 14.39 |
| ecs/activity-service/MemoryUtilization | 25.59 | 22.46 25.59 21.29 20.7 20.8 20.7 20.7 20.7 20.51 20.51 20.51 20.51 20.51 20.51 |
| ecs/realtime-service/CPUUtilization | 33.47 | 13.97 32.42 33.47 22.86 22.37 22.51 23.97 24.73 25.03 23.87 21.85 24.16 23.98 14.63 |
| ecs/realtime-service/MemoryUtilization | 25.59 | 18.95 25.59 19.43 19.34 19.14 19.14 18.95 19.04 18.95 19.04 18.95 18.95 19.14 18.95 |
| ecs/cache-invalidator/CPUUtilization | 39.16 | 15.27 23.02 39.16 25.56 24.92 25.19 26.34 27.78 30.52 25.97 23.94 25.72 25.74 15.06 |
| ecs/cache-invalidator/MemoryUtilization | 22.85 | 17.97 22.85 18.46 18.55 18.26 18.26 18.16 18.16 18.16 17.97 17.97 17.97 17.97 17.97 |
| rds/CPUUtilization | 16.71 | 4.85 4.89 14.01 14.11 14.89 14.77 13.48 16.71 16.44 15.24 15.18 16.32 15.13 |
| rds/DatabaseConnections | 14.0 | 1.0 8.0 13.0 12.0 13.0 13.0 12.0 14.0 14.0 12.0 14.0 13.0 2.0 |
| rds/ReadIOPS | 10.68 | 3.83 0.65 0.53 1.43 10.34 1.05 3.13 2.1 0.65 10.68 4.54 1.33 |
| rds/WriteIOPS | 115.28 | 9.59 24.31 115.28 66.01 88.92 74.09 92.25 85.21 71.81 90.5 74.84 3.25 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.72 | 0.68 0.7 0.78 1.48 1.47 1.55 1.53 1.58 1.72 1.7 1.53 1.58 1.55 1.23 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
