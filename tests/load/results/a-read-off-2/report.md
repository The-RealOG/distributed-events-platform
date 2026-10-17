# Load run `a-read-off-2`

## k6 (load generator view)

```
time="2026-10-17T08:46:16Z" level=info msg="MEASURE_T0=2026-10-17T08:46:16.915Z" source=console

ALL (steady scenario)      n=  68352  p50=   216  p95=  1344  p99=  1687  max=  3069 ms
  board                    n=  55855  p50=   193  p95=  1321  p99=  1616  max=  2572 ms
  workspaces               n=   7068  p50=   148  p95=   868  p99=  1131  max=  1963 ms
  projects                 n=   3531  p50=   189  p95=  1300  p99=  1601  max=  2101 ms
  activity                 n=   3555  p50=   217  p95=  1776  p99=  2124  max=  3069 ms
  task                     n=   3536  p50=   170  p95=  1339  p99=  1656  max=  2128 ms
requests 75096 (115.3/s over 651 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       89.8       0.0  0.00     59    205    316        209         0.0       0.0         0.0     0
100     149.1       0.0  0.00    141    509    825        515         0.0       0.0         0.0     0
200     140.9       0.0  0.00    879   1557   1938       1527         0.0       0.0         0.0     0
  board (bypass)           n=  55855  p50=   193  p95=  1321  p99=  1616  max=  2572 ms
time="2026-10-17T08:56:33Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:board}, http_req_duration{op:projects}, http_req_duration{op:task}' have been crossed"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 75097, 4xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 147987 commits (192.4/s over 769 s between snapshots), rollbacks 0; tuples returned 26170796, fetched 1710229, inserted 2847, updated 846, deleted 31; blocks read 0, hit 4945488
- project-service memory at end: RSS 144 MiB, heap used 50 MiB
- api-gateway memory at end: RSS 135 MiB, heap used 36 MiB
- realtime-service memory at end: RSS 115 MiB, heap used 36 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 31.02 10.33 89.03 83.04 82.82 87.29 97.84 97.93 99.18 97.32 99.97 100.0 99.79 |
| ecs/project-service/MemoryUtilization | 30.76 | 22.17 19.34 27.93 29.2 29.1 29.49 28.42 28.52 28.71 28.71 30.18 30.66 30.76 |
| ecs/api-gateway/CPUUtilization | 71.47 | 17.72 17.2 52.72 53.76 59.79 51.86 62.94 68.91 71.47 71.22 67.56 66.76 63.61 |
| ecs/api-gateway/MemoryUtilization | 21.68 | 15.33 12.01 18.75 18.75 18.95 18.95 19.04 19.53 19.63 20.51 21.19 21.48 21.68 |
| ecs/outbox-publisher/CPUUtilization | 26.14 | 23.11 6.7 17.31 23.92 23.44 18.66 20.85 23.16 18.66 21.05 23.05 19.47 26.14 |
| ecs/outbox-publisher/MemoryUtilization | 25.98 | 25.98 23.05 23.63 23.44 23.14 23.44 23.05 23.24 23.44 23.24 23.44 23.44 22.56 |
| ecs/activity-service/CPUUtilization | 51.59 | 15.49 30.1 51.59 15.04 14.86 15.03 17.37 15.49 15.19 15.17 16.31 17.87 15.38 |
| ecs/activity-service/MemoryUtilization | 20.41 | 15.82 20.41 18.75 18.75 18.36 18.36 18.36 18.36 18.36 18.36 18.36 18.36 18.36 |
| ecs/realtime-service/CPUUtilization | 29.42 | 14.1 29.42 22.94 14.35 15.31 14.22 14.15 14.38 14.32 14.06 14.35 14.42 14.34 |
| ecs/realtime-service/MemoryUtilization | 26.95 | 20.12 26.95 19.82 19.73 19.53 19.53 19.53 19.53 19.53 19.34 19.34 19.34 19.43 |
| ecs/cache-invalidator/CPUUtilization | 31.8 | 16.18 31.8 25.3 16.08 15.0 16.21 15.52 15.99 16.39 16.21 15.87 15.89 15.72 |
| ecs/cache-invalidator/MemoryUtilization | 23.05 | 18.95 23.05 19.53 19.53 18.75 18.75 18.75 18.75 18.75 18.75 18.75 18.75 18.75 |
| rds/CPUUtilization | 15.55 | 4.67 5.8 12.01 10.51 11.02 13.12 13.67 15.55 14.91 13.22 14.97 14.5 11.64 |
| rds/DatabaseConnections | 13.0 | 1.0 8.0 12.0 11.0 12.0 12.0 11.0 11.0 12.0 11.0 12.0 13.0 1.0 |
| rds/ReadIOPS | 12.98 | 0.67 2.57 1.48 0.03 0.02 1.27 12.98 1.42 0.85 0.38 0.88 11.74 0.88 |
| rds/WriteIOPS | 31.74 | 0.27 18.86 31.74 4.18 3.08 0.55 9.53 0.85 0.35 0.47 0.27 9.89 0.58 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.77 | 0.7 0.72 0.72 0.77 0.7 0.7 0.72 0.7 0.7 0.7 0.68 0.72 0.72 |
| redis/dpp-dev-001/CurrConnections | 6.0 | 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 |
