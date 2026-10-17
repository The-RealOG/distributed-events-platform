# Load run `a-read-on-2`

## k6 (load generator view)

```
time="2026-10-17T06:58:19Z" level=info msg="MEASURE_T0=2026-10-17T06:58:19.200Z" source=console

ALL (steady scenario)      n=  72444  p50=   213  p95=  1092  p99=  1569  max=  3898 ms
  board                    n=  59207  p50=   170  p95=   986  p99=  1283  max=  3606 ms
  activity                 n=   3625  p50=   208  p95=  1850  p99=  2316  max=  3898 ms
  projects                 n=   3685  p50=   187  p95=  1383  p99=  1691  max=  2588 ms
  task                     n=   3640  p50=   183  p95=  1364  p99=  1696  max=  3889 ms
  workspaces               n=   7422  p50=   161  p95=   891  p99=  1120  max=  1611 ms
requests 79130 (120.4/s over 657 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0
board cache (client view, x-board-cache) hit 58837 / miss 118 = 99.8 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       87.3       0.0  0.00     78    197    371        198         0.0       0.0       100.0     0
100     152.9       0.0  0.00    121    476    704        474         0.0       0.0        99.8     0
200     162.3       0.0  0.00    689   1363   1807       1134         0.0       0.0        99.7     0
  board (hit)              n=  58837  p50=   167  p95=   974  p99=  1231  max=  3606 ms
  board (miss)             n=    118  p50=   781  p95=  1073  p99=  1137  max=  1179 ms
  board (bypass)           n=    252  p50=  1260  p95=  1998  p99=  2084  max=  2972 ms
time="2026-10-17T07:08:35Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:projects}, http_req_duration{op:task}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 58843, misses 138, errors 255 → hit rate **99.8 %**
- project-service HTTP responses by class: 2xx 79177, 4xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 97060 commits (125.0/s over 776 s between snapshots), rollbacks 0; tuples returned 1898623, fetched 367005, inserted 2850, updated 866, deleted 18; blocks read 0, hit 669965
- project-service memory at end: RSS 137 MiB, heap used 47 MiB
- api-gateway memory at end: RSS 135 MiB, heap used 30 MiB
- realtime-service memory at end: RSS 118 MiB, heap used 33 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 24.87 9.59 81.95 82.19 86.79 76.97 77.51 99.97 100.0 99.8 99.8 99.83 99.94 |
| ecs/project-service/MemoryUtilization | 30.27 | 24.22 19.63 29.2 29.49 29.69 29.59 28.22 28.81 29.2 29.88 30.27 29.98 30.08 |
| ecs/api-gateway/CPUUtilization | 70.57 | 21.09 19.17 50.92 55.0 56.58 44.29 63.76 63.76 60.67 65.94 70.57 65.12 65.39 |
| ecs/api-gateway/MemoryUtilization | 20.51 | 15.92 12.11 18.16 18.46 18.75 18.75 18.85 18.95 19.14 19.24 19.92 20.31 20.51 |
| ecs/outbox-publisher/CPUUtilization | 25.63 | 14.36 6.38 24.34 21.4 21.23 22.84 19.53 21.91 23.57 19.12 21.23 25.63 19.21 |
| ecs/outbox-publisher/MemoryUtilization | 20.9 | 20.9 16.11 17.48 17.29 17.68 17.19 16.41 17.38 17.38 17.58 17.58 17.48 17.38 |
| ecs/activity-service/CPUUtilization | 45.03 | 15.75 26.58 45.03 15.24 18.2 15.93 15.08 15.57 15.26 18.09 17.6 14.99 15.38 |
| ecs/activity-service/MemoryUtilization | 24.02 | 18.16 24.02 18.95 18.95 18.75 18.75 18.75 18.75 18.75 18.95 18.95 18.55 18.55 |
| ecs/realtime-service/CPUUtilization | 30.64 | 14.51 25.68 30.64 14.36 14.49 14.37 14.43 14.39 14.36 14.88 14.55 15.53 14.3 |
| ecs/realtime-service/MemoryUtilization | 23.14 | 15.23 23.14 18.75 18.75 18.36 18.36 18.26 17.97 17.97 17.97 18.07 18.16 18.16 |
| ecs/cache-invalidator/CPUUtilization | 36.68 | 15.36 36.68 34.29 15.6 15.92 15.6 16.34 16.07 16.24 17.09 16.41 16.13 16.81 |
| ecs/cache-invalidator/MemoryUtilization | 18.26 | 14.26 18.26 15.23 15.23 15.04 15.04 15.04 15.04 15.04 15.04 14.84 14.84 14.65 |
| rds/CPUUtilization | 9.21 | 4.44 4.73 8.7 7.67 9.18 7.89 7.92 8.53 9.0 9.21 8.89 8.67 7.55 |
| rds/DatabaseConnections | 13.0 | 1.0 8.0 11.0 12.0 11.0 11.0 12.0 11.0 11.0 13.0 11.0 12.0 2.0 |
| rds/ReadIOPS | 7.07 | 0.03 0.08 0.48 0.02 7.01 0.27 0.72 0.17 0.07 7.07 0.67 0.0 0.13 |
| rds/WriteIOPS | 32.0 | 9.49 10.45 32.0 0.42 9.43 10.85 2.08 0.45 0.65 18.45 1.02 0.55 0.42 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.57 | 0.7 0.7 0.7 1.42 1.47 1.53 1.55 1.52 1.57 1.55 1.35 1.37 1.33 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
