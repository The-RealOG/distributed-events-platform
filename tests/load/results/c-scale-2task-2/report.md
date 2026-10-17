# Load run `c-scale-2task-2`

## k6 (load generator view)

```
time="2026-10-17T17:54:33Z" level=info msg="MEASURE_T0=2026-10-17T17:54:33.716Z" source=console

ALL (steady scenario)      n= 161115  p50=   167  p95=   718  p99=   947  max=  1903 ms
  activity                 n=   7932  p50=   212  p95=   949  p99=  1253  max=  1903 ms
  projects                 n=   8034  p50=   179  p95=   721  p99=   992  max=  2323 ms
  workspaces               n=  15984  p50=   132  p95=   638  p99=   832  max=  1506 ms
  task                     n=   8047  p50=   156  p95=   779  p99=  1002  max=  1574 ms
  board                    n= 126880  p50=   153  p95=   694  p99=   906  max=  2159 ms
requests 168428 (205.9/s over 818 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0
board cache (client view, x-board-cache) hit 126696 / miss 79 = 99.9 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       97.8       0.0  0.00     24    103    213        101         0.0       0.0       100.0     0
100     189.3       0.0  0.00     24    191    308        189         0.0       0.0        99.9     0
200     298.4       0.0  0.00    145    482    706        474         0.0       0.0        99.9     0
300     309.7       0.0  0.00    482    865   1089        839         0.0       0.0       100.0     0
  board (hit)              n= 126696  p50=   153  p95=   692  p99=   901  max=  2159 ms
  board (miss)             n=     79  p50=   153  p95=   642  p99=  1095  max=  1125 ms
  board (bypass)           n=    105  p50=   944  p95=  1445  p99=  1647  max=  1648 ms
time="2026-10-17T18:07:55Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:300}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 56946, misses 37, errors 65 → hit rate **99.9 %**
- project-service HTTP responses by class: 2xx 75715, 4xx 0, 5xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 204116 commits (208.5/s over 979 s between snapshots), rollbacks 0; tuples returned 594719741, fetched 585987722, inserted 2843, updated 844, deleted 22; blocks read 0, hit 33663678
- project-service memory at end: RSS 130 MiB, heap used 42 MiB
- api-gateway memory at end: RSS 132 MiB, heap used 26 MiB
- realtime-service memory at end: RSS 113 MiB, heap used 33 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 95.29 | 6.44 86.47 68.54 71.12 70.1 88.42 89.87 87.8 89.24 91.71 91.79 92.61 95.29 91.91 91.0 28.18 |
| ecs/project-service/MemoryUtilization | 38.38 | 21.39 28.32 29.3 29.69 29.88 29.79 30.18 30.27 30.47 31.15 31.93 31.84 31.84 32.13 31.35 38.38 |
| ecs/api-gateway/CPUUtilization | 99.94 | 19.42 56.41 62.81 63.81 55.42 56.29 85.58 85.63 87.08 99.33 99.33 99.94 98.77 99.03 99.33 20.91 |
| ecs/api-gateway/MemoryUtilization | 25.59 | 16.02 19.14 19.53 19.43 19.34 19.24 19.73 19.73 19.73 21.39 21.58 21.68 21.88 21.97 21.88 25.59 |
| ecs/outbox-publisher/CPUUtilization | 19.22 | 12.42 12.83 18.34 18.35 14.88 18.36 18.68 15.8 18.87 19.22 15.38 19.2 9.99 6.28 10.08 6.04 |
| ecs/outbox-publisher/MemoryUtilization | 28.42 | 28.42 23.73 23.83 23.83 24.02 23.24 24.12 23.54 23.63 23.73 23.83 22.95 23.83 23.83 22.95 24.02 |
| ecs/activity-service/CPUUtilization | 21.78 | 21.78 15.91 13.92 13.81 13.67 13.71 13.79 14.64 13.81 13.76 13.85 14.08 13.85 13.88 14.1 13.43 |
| ecs/activity-service/MemoryUtilization | 25.98 | 25.98 21.58 21.48 21.09 21.09 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 20.9 |
| ecs/realtime-service/CPUUtilization | 31.83 | 14.24 31.83 14.92 14.69 14.24 14.43 14.81 14.63 14.59 14.59 15.24 14.88 15.05 15.05 14.48 14.65 |
| ecs/realtime-service/MemoryUtilization | 25.49 | 19.53 25.49 20.31 20.31 19.73 19.73 19.53 19.53 19.53 19.53 19.53 19.53 19.53 19.53 19.53 19.53 |
| ecs/cache-invalidator/CPUUtilization | 35.49 | 22.63 35.49 14.82 14.74 14.99 15.44 14.72 15.68 15.07 14.97 15.25 15.08 15.07 14.91 14.72 15.02 |
| ecs/cache-invalidator/MemoryUtilization | 23.34 | 20.31 23.34 18.75 18.65 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 |
| rds/CPUUtilization | 25.52 | 4.57 11.83 15.28 12.57 14.74 12.54 19.14 20.4 17.82 25.52 25.36 24.55 25.05 24.57 25.25 7.4 |
| rds/DatabaseConnections | 23.0 | 1.0 22.0 12.0 15.0 21.0 22.0 21.0 21.0 22.0 21.0 23.0 21.0 23.0 |
| rds/ReadIOPS | 17.72 | 0.02 6.46 3.72 16.2 6.19 10.6 5.63 17.72 7.76 7.52 8.9 5.58 17.11 |
| rds/WriteIOPS | 40.54 | 0.33 40.54 0.43 9.53 0.48 6.26 4.74 14.22 0.4 0.43 0.17 0.22 9.82 |
| redis/dpp-dev-001/EngineCPUUtilization | 2.13 | 0.72 0.7 1.32 1.52 1.6 1.63 1.7 2.07 2.13 1.95 1.98 2.0 1.9 1.9 1.88 1.57 |
| redis/dpp-dev-001/CurrConnections | 8.0 | 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 |
