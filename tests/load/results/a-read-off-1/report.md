# Load run `a-read-off-1`

## k6 (load generator view)

```
time="2026-10-17T08:30:21Z" level=info msg="MEASURE_T0=2026-10-17T08:30:21.713Z" source=console

ALL (steady scenario)      n=  68197  p50=   240  p95=  1258  p99=  1562  max=  2350 ms
  activity                 n=   3470  p50=   246  p95=  1668  p99=  1976  max=  2331 ms
  projects                 n=   3451  p50=   198  p95=  1199  p99=  1490  max=  1828 ms
  task                     n=   3483  p50=   209  p95=  1232  p99=  1491  max=  2158 ms
  workspaces               n=   6886  p50=   163  p95=   819  p99=  1014  max=  2158 ms
  board                    n=  55951  p50=   214  p95=  1238  p99=  1507  max=  2350 ms
requests 74792 (114.2/s over 655 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       88.3       0.0  0.00     60    223    451        225         0.0       0.0         0.0     0
100     147.4       0.0  0.00    151    531    709        542         0.0       0.0         0.0     0
200     143.2       0.0  0.00    887   1449   1722       1411         0.0       0.0         0.0     0
  board (bypass)           n=  55951  p50=   214  p95=  1238  p99=  1507  max=  2350 ms
time="2026-10-17T08:40:38Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:board}, http_req_duration{op:projects}, http_req_duration{op:task}' have been crossed"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 74792, 4xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 147532 commits (190.4/s over 775 s between snapshots), rollbacks 0; tuples returned 23511132, fetched 1703541, inserted 2826, updated 828, deleted 5; blocks read 0, hit 4789926
- project-service memory at end: RSS 144 MiB, heap used 47 MiB
- api-gateway memory at end: RSS 135 MiB, heap used 30 MiB
- realtime-service memory at end: RSS 115 MiB, heap used 30 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 13.99 9.54 94.13 93.43 90.51 88.75 81.91 98.81 97.99 97.13 99.72 100.0 99.68 |
| ecs/project-service/MemoryUtilization | 28.42 | 18.46 14.75 25.1 25.98 26.86 26.37 26.76 26.86 27.25 27.34 28.22 28.32 28.42 |
| ecs/api-gateway/CPUUtilization | 70.98 | 12.84 14.19 48.39 52.72 51.41 48.9 64.54 70.98 70.98 67.17 69.48 67.5 64.07 |
| ecs/api-gateway/MemoryUtilization | 21.48 | 16.7 12.4 18.65 18.65 18.75 18.85 19.63 19.82 19.82 20.12 21.39 21.48 21.39 |
| ecs/outbox-publisher/CPUUtilization | 37.05 | 37.05 18.84 27.48 23.47 18.73 21.52 22.44 20.78 18.79 23.11 21.76 18.28 23.66 |
| ecs/outbox-publisher/MemoryUtilization | 24.8 | 24.8 23.34 23.05 23.05 23.05 23.05 23.34 23.14 23.44 22.85 22.95 23.05 23.14 |
| ecs/activity-service/CPUUtilization | 44.25 | 14.88 32.04 44.25 15.47 15.24 15.24 15.44 18.19 16.01 15.3 15.23 15.53 18.07 |
| ecs/activity-service/MemoryUtilization | 17.09 | 13.09 17.09 15.92 16.21 15.82 15.82 15.62 15.43 15.43 15.43 15.43 15.43 15.43 |
| ecs/realtime-service/CPUUtilization | 30.67 | 14.07 30.67 30.06 13.99 14.18 13.9 14.1 14.16 14.11 13.94 13.93 13.93 14.21 |
| ecs/realtime-service/MemoryUtilization | 26.07 | 19.34 26.07 19.73 19.53 19.34 19.34 19.14 19.14 19.14 19.14 19.14 19.34 19.34 |
| ecs/cache-invalidator/CPUUtilization | 33.53 | 15.34 25.42 33.53 15.53 15.69 15.19 15.7 15.66 15.22 15.35 15.5 15.47 15.5 |
| ecs/cache-invalidator/MemoryUtilization | 23.34 | 18.16 23.34 18.95 18.36 18.36 18.36 18.36 18.36 18.36 18.36 18.36 18.36 18.36 |
| rds/CPUUtilization | 15.41 | 4.22 4.79 12.68 10.57 11.07 11.13 12.25 15.41 14.67 13.51 14.16 14.93 13.2 |
| rds/DatabaseConnections | 13.0 | 1.0 8.0 11.0 11.0 12.0 11.0 11.0 12.0 13.0 11.0 12.0 12.0 1.0 1.0 |
| rds/ReadIOPS | 13.26 | 0.02 0.17 13.26 0.27 0.75 0.1 0.63 9.66 1.08 0.03 0.0 0.87 11.57 0.13 |
| rds/WriteIOPS | 52.86 | 0.15 7.91 52.86 1.38 4.3 2.78 0.28 10.04 0.88 0.55 0.15 0.32 10.22 0.5 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.8 | 0.72 0.68 0.72 0.8 0.7 0.7 0.7 0.72 0.7 0.7 0.72 0.68 0.7 0.72 |
| redis/dpp-dev-001/CurrConnections | 6.0 | 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 |
