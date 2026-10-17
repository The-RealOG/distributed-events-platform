# Load run `a-read-off-3`

## k6 (load generator view)

```
time="2026-10-17T09:01:54Z" level=info msg="MEASURE_T0=2026-10-17T09:01:54.261Z" source=console

ALL (steady scenario)      n=  70195  p50=   192  p95=  1253  p99=  1651  max=  2558 ms
  workspaces               n=   7222  p50=   121  p95=   797  p99=  1085  max=  1656 ms
  projects                 n=   3602  p50=   185  p95=  1204  p99=  1486  max=  2095 ms
  board                    n=  57611  p50=   167  p95=  1229  p99=  1573  max=  2125 ms
  task                     n=   3656  p50=   147  p95=  1219  p99=  1548  max=  2066 ms
  activity                 n=   3583  p50=   202  p95=  1660  p99=  2116  max=  2558 ms
requests 77225 (120.9/s over 639 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       95.3       0.0  0.00     26    182    310        184         0.0       0.0         0.0     0
100     152.8       0.0  0.00    125    508    769        517         0.0       0.0         0.0     0
200     141.9       0.0  0.00    894   1468   1879       1416         0.0       0.0         0.0     0
  board (bypass)           n=  57611  p50=   167  p95=  1229  p99=  1573  max=  2125 ms
time="2026-10-17T09:12:10Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:board}, http_req_duration{op:projects}, http_req_duration{op:task}' have been crossed"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 77225, 4xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 152011 commits (200.5/s over 758 s between snapshots), rollbacks 0; tuples returned 29459759, fetched 1748599, inserted 2825, updated 832, deleted 4; blocks read 0, hit 5081609
- project-service memory at end: RSS 141 MiB, heap used 31 MiB
- api-gateway memory at end: RSS 134 MiB, heap used 35 MiB
- realtime-service memory at end: RSS 114 MiB, heap used 41 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 35.05 44.56 94.52 91.7 87.87 88.71 98.51 97.82 98.1 99.91 100.0 99.93 99.81 |
| ecs/project-service/MemoryUtilization | 31.25 | 27.15 23.14 30.96 31.25 29.98 30.18 30.27 29.0 28.91 29.49 30.86 30.76 30.27 |
| ecs/api-gateway/CPUUtilization | 70.91 | 20.51 46.93 54.57 55.09 52.96 52.92 70.91 67.94 69.57 66.01 64.87 67.07 60.79 |
| ecs/api-gateway/MemoryUtilization | 21.58 | 16.11 16.7 18.75 18.46 18.55 18.46 19.34 19.53 19.63 21.19 21.39 21.58 21.48 |
| ecs/outbox-publisher/CPUUtilization | 23.9 | 12.47 11.64 18.81 21.19 23.07 23.34 21.45 22.44 18.44 19.2 23.9 21.57 5.94 |
| ecs/outbox-publisher/MemoryUtilization | 27.73 | 27.73 23.34 22.75 23.83 23.24 24.32 23.83 23.54 22.75 23.73 23.73 23.63 23.63 |
| ecs/activity-service/CPUUtilization | 43.93 | 19.16 23.62 43.93 16.11 15.42 18.92 15.44 14.82 14.92 15.26 17.89 15.38 15.36 |
| ecs/activity-service/MemoryUtilization | 24.41 | 18.46 24.41 19.34 19.14 18.95 18.95 18.95 18.95 18.95 18.95 19.04 19.14 18.95 |
| ecs/realtime-service/CPUUtilization | 21.9 | 14.5 21.9 17.67 14.16 14.25 14.36 14.47 14.24 14.12 14.22 14.2 14.23 14.17 |
| ecs/realtime-service/MemoryUtilization | 27.34 | 19.92 27.34 20.12 20.12 19.73 19.73 19.53 19.53 19.53 19.53 19.53 19.53 19.53 |
| ecs/cache-invalidator/CPUUtilization | 32.44 | 15.98 32.44 21.74 15.93 16.3 16.27 15.73 15.9 16.62 15.68 16.19 15.92 16.12 |
| ecs/cache-invalidator/MemoryUtilization | 24.71 | 19.04 24.71 19.34 19.34 19.14 19.14 19.14 19.14 19.14 19.34 19.34 19.34 19.34 |
| rds/CPUUtilization | 15.25 | 5.85 6.72 12.09 10.79 12.27 12.63 13.8 15.04 15.04 13.64 15.25 14.57 7.46 |
| rds/DatabaseConnections | 13.0 | 1.0 12.0 12.0 13.0 11.0 12.0 11.0 11.0 12.0 11.0 11.0 12.0 1.0 |
| rds/ReadIOPS | 12.63 | 6.63 1.3 0.38 0.5 0.07 12.37 1.48 0.77 0.62 0.13 12.63 1.08 0.13 |
| rds/WriteIOPS | 39.1 | 9.73 39.1 5.04 0.28 0.28 9.78 2.13 5.18 0.5 0.48 9.86 0.62 0.45 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.8 | 0.68 0.72 0.8 0.7 0.72 0.7 0.72 0.68 0.72 0.7 0.68 0.72 0.72 |
| redis/dpp-dev-001/CurrConnections | 6.0 | 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 |
