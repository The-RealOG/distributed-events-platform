# Load run `b-multi-1r`

## k6 (load generator view)

```
time="2026-10-17T15:59:37Z" level=info msg="MEASURE_T0=2026-10-17T15:59:37.161Z" source=console

ALL (steady scenario)      n=  52889  p50=   428  p95=  2258  p99=  2900  max=  3978 ms
  unassign                 n=   1076  p50=   334  p95=  1555  p99=  1927  max=  2171 ms
  update                   n=   3665  p50=   392  p95=  1610  p99=  1993  max=  2558 ms
  board                    n=  18462  p50=   359  p95=  2214  p99=  2631  max=  3519 ms
  task                     n=   5510  p50=   387  p95=  2228  p99=  2625  max=  3301 ms
  assign                   n=   1541  p50=   431  p95=  1653  p99=  1974  max=  2335 ms
  activity                 n=   5049  p50=   538  p95=  3064  p99=  3486  max=  3978 ms
  comment                  n=   1553  p50=   386  p95=  1601  p99=  1939  max=  2611 ms
  projects                 n=   5364  p50=   398  p95=  2194  p99=  2507  max=  3216 ms
  move                     n=   3529  p50=   444  p95=  1675  p99=  2016  max=  2666 ms
  create                   n=   3541  p50=   378  p95=  1561  p99=  1889  max=  2536 ms
  workspaces               n=   8006  p50=   248  p95=  1429  p99=  1799  max=  2402 ms
  delete                   n=    966  p50=   610  p95=  1661  p99=  1921  max=  2446 ms
requests 60693 (92.9/s over 654 s incl. setup), failed 0.00 %
successful writes 15686 (24.0/s)
version conflicts (409) 185
board cache (client view, x-board-cache) hit 9868 / miss 8562 = 53.5 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       91.2      24.3  0.00     45    377    573        366         450       508        59.3    56
100     108.9      29.6  0.00    408    958   1259        971         806       844        55.0    59
200      93.7      25.3  0.00   1593   2750   3245       2531        1871      1950        44.6    53
  board (hit)              n=   9868  p50=   250  p95=  1446  p99=  1778  max=  2499 ms
  board (miss)             n=   8562  p50=   565  p95=  2407  p99=  2801  max=  3519 ms
  board (bypass)           n=     32  p50=  1818  p95=  2152  p99=  2253  max=  2298 ms
time="2026-10-17T16:09:54Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 9868, misses 8622, errors 49 → hit rate **53.4 %**
- project-service HTTP responses by class: 2xx 60508, 4xx 185, 5xx 0
- Outbox: published 15694; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 15694; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 15694; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 15694; retries 0; dead-lettered 0
- activity outcomes: processed 15694
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 126247 commits (151.3/s over 834 s between snapshots), rollbacks 185; tuples returned 17038253, fetched 6323479, inserted 56759, updated 42105, deleted 989; blocks read 0, hit 4957195
- project-service memory at end: RSS 150 MiB, heap used 54 MiB
- api-gateway memory at end: RSS 139 MiB, heap used 39 MiB
- realtime-service memory at end: RSS 119 MiB, heap used 35 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 26.95 6.44 96.38 97.93 98.09 97.07 96.55 99.51 99.97 99.44 100.0 100.0 100.0 21.26 |
| ecs/project-service/MemoryUtilization | 36.52 | 26.07 19.04 30.47 31.15 31.54 31.35 30.57 30.57 31.25 31.05 31.54 31.64 32.03 36.52 |
| ecs/api-gateway/CPUUtilization | 58.24 | 9.21 12.26 47.82 57.08 55.44 55.56 53.57 55.16 58.24 52.88 49.63 48.82 49.72 6.05 |
| ecs/api-gateway/MemoryUtilization | 21.48 | 13.09 18.07 18.55 19.04 18.75 18.75 18.75 19.14 19.63 19.82 20.9 21.39 21.48 21.48 |
| ecs/outbox-publisher/CPUUtilization | 42.82 | 13.53 26.95 42.82 30.32 26.16 26.64 28.89 27.25 31.03 26.29 29.68 25.13 27.74 14.66 |
| ecs/outbox-publisher/MemoryUtilization | 25.88 | 19.92 25.88 22.36 22.46 22.17 22.27 22.85 22.36 22.07 22.46 22.46 22.07 22.27 21.39 |
| ecs/activity-service/CPUUtilization | 40.23 | 14.07 20.58 40.23 36.07 32.08 30.42 30.02 33.33 34.36 30.71 31.63 29.22 31.7 14.51 |
| ecs/activity-service/MemoryUtilization | 26.27 | 19.43 26.27 20.8 21.29 20.51 20.51 20.51 20.51 20.51 20.51 20.51 20.51 20.51 20.51 |
| ecs/realtime-service/CPUUtilization | 42.49 | 14.58 32.17 42.49 28.0 25.39 23.44 24.25 26.47 25.11 25.5 24.37 25.02 24.9 19.44 |
| ecs/realtime-service/MemoryUtilization | 22.56 | 18.95 22.56 22.56 18.95 18.65 18.55 18.55 18.55 18.75 18.95 18.95 18.95 18.95 18.95 |
| ecs/cache-invalidator/CPUUtilization | 48.89 | 15.03 21.5 48.89 27.34 28.53 25.49 25.83 28.38 27.66 29.06 26.24 25.76 27.27 21.78 |
| ecs/cache-invalidator/MemoryUtilization | 24.02 | 18.55 24.02 18.36 18.16 17.97 17.97 17.87 17.97 17.87 17.87 17.97 17.87 17.77 17.97 |
| rds/CPUUtilization | 16.71 | 4.87 4.29 12.17 13.75 13.62 14.64 12.88 16.34 16.71 15.87 14.6 15.17 14.7 6.21 |
| rds/DatabaseConnections | 13.0 | 3.0 2.0 12.0 12.0 13.0 12.0 13.0 12.0 12.0 13.0 12.0 13.0 12.0 1.0 |
| rds/ReadIOPS | 10.86 | 0.15 0.0 0.53 1.35 0.22 10.86 0.43 1.9 1.37 0.13 9.97 3.13 0.22 1.3 |
| rds/WriteIOPS | 121.32 | 9.58 0.5 121.32 64.85 75.71 89.93 69.54 92.34 89.32 78.97 93.44 75.5 71.76 1.58 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.72 | 0.7 0.7 0.7 1.38 1.45 1.53 1.55 1.52 1.68 1.72 1.52 1.57 1.62 1.4 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
