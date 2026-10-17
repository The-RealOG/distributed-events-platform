# Load run `c-scale-1task`

## k6 (load generator view)

```
time="2026-10-17T17:13:12Z" level=info msg="MEASURE_T0=2026-10-17T17:13:12.092Z" source=console

ALL (steady scenario)      n= 100777  p50=   536  p95=  1823  p99=  2361  max=  4055 ms
  projects                 n=   5120  p50=   710  p95=  2101  p99=  2408  max=  2806 ms
  board                    n=  81185  p50=   484  p95=  1669  p99=  1962  max=  3470 ms
  task                     n=   5082  p50=   639  p95=  2131  p99=  2425  max=  2869 ms
  activity                 n=   4889  p50=  1046  p95=  2747  p99=  3077  max=  4055 ms
  workspaces               n=  10120  p50=   438  p95=  1584  p99=  1849  max=  2278 ms
requests 107947 (130.8/s over 825 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0
board cache (client view, x-board-cache) hit 80489 / miss 141 = 99.8 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       95.5       0.0  0.00     25    166    296        166         0.0       0.0       100.0     0
100     157.7       0.0  0.00    104    462    737        461         0.0       0.0        99.9     0
200     155.6       0.0  0.00    728   1437   1961       1231         0.0       0.0        99.6     0
300     151.1       0.0  0.00   1481   2250   2713       1923         0.0       0.0       100.0     0
  board (hit)              n=  80489  p50=   476  p95=  1652  p99=  1923  max=  3071 ms
  board (miss)             n=    141  p50=  1046  p95=  1405  p99=  1435  max=  1451 ms
  board (bypass)           n=    555  p50=  1850  p95=  2520  p99=  2690  max=  3470 ms
time="2026-10-17T17:26:34Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{level:300,op:board}, http_req_duration{level:300}, http_req_duration{op:activity}, http_req_duration{op:board}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 80491, misses 161, errors 558 → hit rate **99.8 %**
- project-service HTTP responses by class: 2xx 107949, 4xx 0, 5xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 132143 commits (140.1/s over 943 s between snapshots), rollbacks 0; tuples returned 365255029, fetched 357262732, inserted 2824, updated 831, deleted 3; blocks read 0, hit 21559035
- project-service memory at end: RSS 135 MiB, heap used 47 MiB
- api-gateway memory at end: RSS 139 MiB, heap used 35 MiB
- realtime-service memory at end: RSS 114 MiB, heap used 34 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 32.89 23.41 97.87 89.17 86.41 86.34 98.76 98.08 99.07 99.49 100.0 100.0 99.47 99.73 100.0 100.0 |
| ecs/project-service/MemoryUtilization | 36.82 | 33.01 25.39 34.28 35.06 34.77 34.57 35.06 36.04 35.74 36.04 36.82 36.82 36.04 33.98 34.28 34.18 |
| ecs/api-gateway/CPUUtilization | 73.68 | 21.89 7.21 48.1 50.32 50.33 52.64 73.68 69.71 69.01 68.81 69.73 70.06 68.58 67.25 65.53 67.95 |
| ecs/api-gateway/MemoryUtilization | 23.54 | 23.54 22.85 20.31 20.12 20.02 20.02 20.12 20.41 20.7 20.7 21.48 21.68 21.88 22.36 22.46 22.46 |
| ecs/outbox-publisher/CPUUtilization | 19.48 | 7.14 11.21 18.83 14.75 15.12 19.06 19.48 15.2 18.39 18.58 15.08 18.49 18.15 6.95 10.56 10.13 |
| ecs/outbox-publisher/MemoryUtilization | 27.05 | 22.36 27.05 23.34 22.75 23.83 22.85 23.93 23.24 23.44 23.34 23.44 23.44 23.44 23.63 23.63 23.63 |
| ecs/activity-service/CPUUtilization | 30.79 | 13.68 30.79 13.59 13.62 14.17 13.58 13.32 13.3 13.74 13.79 13.87 13.41 13.45 13.56 14.17 13.61 |
| ecs/activity-service/MemoryUtilization | 24.71 | 20.9 24.71 21.29 21.29 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 |
| ecs/realtime-service/CPUUtilization | 30.65 | 14.88 26.51 30.65 15.57 14.48 14.74 14.41 14.58 14.62 14.11 14.03 13.92 13.92 14.25 14.36 14.21 |
| ecs/realtime-service/MemoryUtilization | 27.25 | 19.34 27.25 20.12 20.12 19.73 19.73 19.53 19.53 19.53 19.53 19.53 19.53 19.53 19.53 19.53 19.53 |
| ecs/cache-invalidator/CPUUtilization | 36.2 | 14.87 34.37 36.2 15.16 14.96 15.07 15.0 15.03 14.72 15.24 15.18 15.03 15.25 14.98 15.13 15.17 |
| ecs/cache-invalidator/MemoryUtilization | 22.36 | 18.55 22.36 18.75 18.75 18.36 18.36 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 |
| rds/CPUUtilization | 16.32 | 4.67 5.46 11.77 10.95 12.49 13.01 12.88 15.46 16.17 15.27 16.32 15.77 13.44 15.1 14.71 12.96 |
| rds/DatabaseConnections | 12.0 | 3.0 7.0 11.0 12.0 11.0 11.0 12.0 11.0 12.0 11.0 12.0 11.0 |
| rds/ReadIOPS | 13.36 | 1.42 10.75 5.17 5.92 5.93 13.36 6.49 3.56 5.66 12.84 3.7 5.26 5.33 |
| rds/WriteIOPS | 30.24 | 1.25 19.62 30.24 5.2 5.52 9.42 0.86 0.92 0.17 9.43 0.5 0.95 0.35 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.53 | 0.72 0.7 0.75 1.5 1.47 1.5 1.53 1.43 1.43 1.43 1.33 1.32 1.35 1.27 1.32 1.32 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
