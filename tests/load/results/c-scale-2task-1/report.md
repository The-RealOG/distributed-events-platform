# Load run `c-scale-2task-1`

## k6 (load generator view)

```
time="2026-10-17T17:34:39Z" level=info msg="MEASURE_T0=2026-10-17T17:34:39.174Z" source=console

ALL (steady scenario)      n= 161423  p50=   171  p95=   704  p99=   947  max=  2917 ms
  board                    n= 127357  p50=   156  p95=   681  p99=   907  max=  2798 ms
  projects                 n=   7969  p50=   177  p95=   716  p99=  1000  max=  2884 ms
  task                     n=   7928  p50=   166  p95=   785  p99=  1021  max=  2055 ms
  activity                 n=   8040  p50=   219  p95=   960  p99=  1283  max=  2917 ms
  workspaces               n=  15929  p50=   136  p95=   627  p99=   828  max=  2601 ms
requests 168774 (206.1/s over 819 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0
board cache (client view, x-board-cache) hit 127211 / miss 88 = 99.9 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       97.8       0.0  0.00     24     92    181         90         0.0       0.0       100.0     0
100     187.6       0.0  0.00     25    202    307        202         0.0       0.0        99.9     0
200     297.2       0.0  0.00    146    487    695        482         0.0       0.0        99.9     0
300     314.2       0.0  0.00    467    860   1074        826         0.0       0.0       100.0     0
  board (hit)              n= 127211  p50=   156  p95=   680  p99=   901  max=  2798 ms
  board (miss)             n=     88  p50=   137  p95=  1100  p99=  1520  max=  2168 ms
  board (bypass)           n=     58  p50=   999  p95=  1173  p99=  1221  max=  1259 ms
time="2026-10-17T17:48:00Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:300}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 68224, misses 68, errors 38 → hit rate **99.9 %**
- project-service HTTP responses by class: 2xx 90524, 4xx 0, 5xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 204464 commits (218.7/s over 935 s between snapshots), rollbacks 0; tuples returned 599534260, fetched 590683176, inserted 2823, updated 813, deleted 2; blocks read 0, hit 33888584
- project-service memory at end: RSS 128 MiB, heap used 45 MiB
- api-gateway memory at end: RSS 135 MiB, heap used 32 MiB
- realtime-service memory at end: RSS 113 MiB, heap used 32 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 94.16 | 19.54 82.51 70.7 70.63 73.74 65.37 90.72 91.47 91.16 92.47 91.23 94.16 91.66 92.95 90.53 28.08 |
| ecs/project-service/MemoryUtilization | 35.16 | 26.37 29.0 29.2 29.3 29.3 29.2 29.69 29.98 30.66 30.66 31.35 31.45 31.54 31.64 31.45 35.16 |
| ecs/api-gateway/CPUUtilization | 99.77 | 19.33 49.47 61.04 65.93 57.84 54.22 85.33 87.35 86.15 99.62 99.03 99.49 99.33 99.23 99.77 67.63 |
| ecs/api-gateway/MemoryUtilization | 24.02 | 18.85 18.46 19.24 19.14 19.14 19.14 19.24 19.24 19.24 21.09 21.39 21.48 21.88 22.07 21.97 24.02 |
| ecs/outbox-publisher/CPUUtilization | 32.66 | 32.66 18.98 18.44 19.36 18.34 15.13 18.88 19.05 15.17 18.54 19.65 15.63 8.69 10.93 5.74 6.57 |
| ecs/outbox-publisher/MemoryUtilization | 25.1 | 25.1 23.73 23.63 23.83 23.93 23.93 23.83 23.63 23.54 23.73 23.63 23.54 23.73 23.83 23.05 24.02 |
| ecs/activity-service/CPUUtilization | 42.18 | 23.3 42.18 14.09 13.94 13.76 13.95 13.88 14.61 13.99 13.78 14.07 14.36 14.48 14.14 13.58 13.89 |
| ecs/activity-service/MemoryUtilization | 27.73 | 27.73 21.29 21.09 20.7 20.7 20.7 20.7 20.7 20.7 20.7 20.7 20.7 20.7 20.7 20.7 20.7 |
| ecs/realtime-service/CPUUtilization | 25.55 | 14.62 25.55 14.83 14.68 14.5 14.82 14.61 15.17 14.72 14.5 14.79 14.76 14.3 14.29 14.15 14.41 |
| ecs/realtime-service/MemoryUtilization | 25.29 | 19.53 25.29 19.73 19.73 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 |
| ecs/cache-invalidator/CPUUtilization | 22.81 | 15.23 22.81 15.27 15.71 15.12 15.36 15.33 15.14 15.46 15.64 15.49 14.82 15.17 14.78 14.91 15.18 |
| ecs/cache-invalidator/MemoryUtilization | 25.39 | 18.55 25.39 19.14 19.14 18.55 18.75 18.75 18.75 18.55 18.75 18.75 18.75 18.75 18.75 18.75 18.75 |
| rds/CPUUtilization | 28.06 | 4.99 11.54 13.37 12.35 13.22 13.06 20.58 18.79 18.47 22.82 24.04 26.12 24.82 28.06 27.48 |
| rds/DatabaseConnections | 23.0 | 1.0 21.0 12.0 15.0 23.0 21.0 23.0 21.0 22.0 21.0 21.0 23.0 |
| rds/ReadIOPS | 16.92 | 0.97 7.87 4.78 13.7 8.31 8.73 9.31 6.79 15.04 7.36 8.15 7.95 6.98 16.92 |
| rds/WriteIOPS | 43.03 | 0.32 43.03 0.55 9.27 0.5 8.24 2.86 1.86 12.65 14.08 0.55 0.17 0.43 9.49 |
| redis/dpp-dev-001/EngineCPUUtilization | 2.08 | 0.7 0.7 1.23 1.5 1.62 1.62 1.58 2.08 2.05 1.95 2.0 1.98 1.87 1.88 1.87 1.72 |
| redis/dpp-dev-001/CurrConnections | 8.0 | 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 |
