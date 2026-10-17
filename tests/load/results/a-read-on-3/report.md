# Load run `a-read-on-3`

## k6 (load generator view)

```
time="2026-10-17T07:14:23Z" level=info msg="MEASURE_T0=2026-10-17T07:14:23.621Z" source=console

ALL (steady scenario)      n=  74596  p50=   188  p95=  1098  p99=  1567  max=  4855 ms
  task                     n=   3802  p50=   180  p95=  1402  p99=  1719  max=  4159 ms
  board                    n=  61270  p50=   156  p95=   980  p99=  1251  max=  4162 ms
  activity                 n=   3725  p50=   194  p95=  1860  p99=  2237  max=  4855 ms
  projects                 n=   3709  p50=   118  p95=  1320  p99=  1644  max=  2393 ms
  workspaces               n=   7534  p50=   122  p95=   858  p99=  1099  max=  4045 ms
requests 81591 (126.4/s over 646 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0
board cache (client view, x-board-cache) hit 60853 / miss 126 = 99.8 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       92.4       0.0  0.00     44    184    363        185         0.0       0.0       100.0     0
100     158.7       0.0  0.00    105    450    706        449         0.0       0.0        99.9     0
200     163.3       0.0  0.00    671   1358   1811       1157         0.0       0.0        99.6     0
  board (hit)              n=  60853  p50=   153  p95=   964  p99=  1202  max=  4154 ms
  board (miss)             n=    126  p50=   830  p95=  1312  p99=  1377  max=  1518 ms
  board (bypass)           n=    291  p50=  1293  p95=  1864  p99=  2078  max=  4162 ms
time="2026-10-17T07:24:40Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:projects}, http_req_duration{op:task}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 60853, misses 146, errors 291 → hit rate **99.8 %**
- project-service HTTP responses by class: 2xx 81591, 4xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 2, idle 2; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 99794 commits (131.3/s over 760 s between snapshots), rollbacks 0; tuples returned 6067196, fetched 456070, inserted 2870, updated 883, deleted 35; blocks read 1, hit 1374713
- project-service memory at end: RSS 137 MiB, heap used 45 MiB
- api-gateway memory at end: RSS 136 MiB, heap used 32 MiB
- realtime-service memory at end: RSS 117 MiB, heap used 35 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 28.45 5.41 90.8 88.97 85.6 83.64 83.54 100.0 98.89 99.79 99.96 99.89 99.67 |
| ecs/project-service/MemoryUtilization | 30.86 | 26.27 20.8 29.0 29.49 30.27 30.47 30.27 29.39 29.69 29.59 30.86 30.86 30.76 |
| ecs/api-gateway/CPUUtilization | 70.24 | 16.65 4.13 54.51 55.77 54.52 48.79 66.17 63.84 64.41 70.24 65.1 68.79 67.11 |
| ecs/api-gateway/MemoryUtilization | 20.9 | 16.5 12.01 18.36 18.26 18.55 18.36 18.55 18.75 18.95 19.53 20.41 20.8 20.9 |
| ecs/outbox-publisher/CPUUtilization | 42.92 | 5.13 12.67 42.92 19.9 23.91 22.78 20.09 22.05 23.52 18.96 21.37 22.45 18.96 |
| ecs/outbox-publisher/MemoryUtilization | 22.27 | 15.43 22.27 17.68 17.77 17.87 17.97 17.68 17.58 17.77 17.87 17.77 17.87 17.68 |
| ecs/activity-service/CPUUtilization | 21.75 | 14.87 21.75 15.16 18.66 14.98 15.67 15.01 15.09 21.0 15.75 15.4 15.41 15.6 |
| ecs/activity-service/MemoryUtilization | 25.59 | 18.85 25.59 18.95 18.95 18.75 18.75 18.75 18.75 18.75 18.55 18.55 18.75 18.75 |
| ecs/realtime-service/CPUUtilization | 32.64 | 14.46 22.13 32.64 14.37 14.19 14.7 14.58 14.36 14.33 14.4 14.42 14.25 14.49 |
| ecs/realtime-service/MemoryUtilization | 25.2 | 18.75 25.2 19.04 18.95 18.55 18.55 18.36 18.36 18.36 18.36 18.36 18.36 18.36 |
| ecs/cache-invalidator/CPUUtilization | 39.53 | 16.43 29.13 39.53 16.21 16.0 16.1 16.03 15.77 16.27 16.42 16.14 15.76 16.86 |
| ecs/cache-invalidator/MemoryUtilization | 20.41 | 15.23 20.41 15.23 15.23 14.75 14.65 14.84 14.84 14.84 14.84 14.84 14.84 14.84 |
| rds/CPUUtilization | 11.13 | 4.24 4.38 9.22 8.16 8.41 8.15 8.14 11.13 10.16 8.93 8.97 8.99 8.71 |
| rds/DatabaseConnections | 12.0 | 2.0 2.0 12.0 12.0 11.0 12.0 12.0 11.0 12.0 12.0 11.0 12.0 1.0 |
| rds/ReadIOPS | 7.46 | 0.03 0.0 0.58 7.46 1.35 0.73 0.1 0.08 6.64 0.78 0.1 0.1 0.12 |
| rds/WriteIOPS | 37.32 | 0.37 1.83 37.32 9.19 10.22 2.75 0.45 0.28 9.57 9.69 0.37 0.53 0.37 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.57 | 0.7 0.7 0.72 1.38 1.43 1.48 1.57 1.47 1.5 1.57 1.4 1.32 1.35 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
