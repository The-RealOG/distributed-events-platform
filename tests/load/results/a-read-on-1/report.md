# Load run `a-read-on-1`

## k6 (load generator view)

```
time="2026-10-17T06:41:10Z" level=info msg="MEASURE_T0=2026-10-17T06:41:10.188Z" source=console

ALL (steady scenario)      n=  76468  p50=   147  p95=  1105  p99=  1614  max=  2859 ms
  workspaces               n=   7841  p50=    99  p95=   895  p99=  1164  max=  1725 ms
  projects                 n=   3947  p50=   110  p95=  1388  p99=  1706  max=  2283 ms
  activity                 n=   3966  p50=   160  p95=  1897  p99=  2282  max=  2859 ms
  board                    n=  62293  p50=   118  p95=   990  p99=  1296  max=  2298 ms
  task                     n=   3898  p50=   127  p95=  1408  p99=  1723  max=  2256 ms
requests 83496 (130.1/s over 642 s incl. setup), failed 0.00 %
successful writes 0 (0.0/s)
version conflicts (409) 0
board cache (client view, x-board-cache) hit 61952 / miss 128 = 99.8 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       95.6       0.0  0.00     24    174    340        169         0.0       0.0       100.0     0
100     166.6       0.0  0.00     84    401    565        401         0.0       0.0        99.9     0
200     162.7       0.0  0.00    677   1393   1842       1177         0.0       0.0        99.7     0
  board (hit)              n=  61952  p50=   116  p95=   976  p99=  1233  max=  1873 ms
  board (miss)             n=    128  p50=  1387  p95=  1717  p99=  1772  max=  1803 ms
  board (bypass)           n=    213  p50=  1384  p95=  1834  p99=  2221  max=  2298 ms
time="2026-10-17T06:51:27Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:200,op:board}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:projects}, http_req_duration{op:task}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 61953, misses 148, errors 219 → hit rate **99.8 %**
- project-service HTTP responses by class: 2xx 83498, 4xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 102294 commits (134.7/s over 759 s between snapshots), rollbacks 0; tuples returned 2916854, fetched 320135, inserted 2915, updated 850, deleted 16; blocks read 36, hit 725134
- project-service memory at end: RSS 141 MiB, heap used 42 MiB
- api-gateway memory at end: RSS 134 MiB, heap used 27 MiB
- realtime-service memory at end: RSS 105 MiB, heap used 31 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 12.9 7.19 94.96 86.95 86.5 84.6 99.28 99.73 99.69 99.62 99.66 99.97 100.0 |
| ecs/project-service/MemoryUtilization | 29.2 | 18.85 13.28 26.27 26.86 26.27 26.95 27.15 26.76 27.64 28.32 29.1 29.2 28.91 |
| ecs/api-gateway/CPUUtilization | 72.0 | 10.26 24.54 57.77 54.9 47.8 48.54 65.79 67.0 72.0 66.24 67.1 65.8 66.55 |
| ecs/api-gateway/MemoryUtilization | 20.61 | 16.41 11.72 17.97 18.16 18.36 18.26 18.46 18.55 18.65 19.82 20.51 20.61 20.61 |
| ecs/outbox-publisher/CPUUtilization | 39.97 | 23.39 16.74 39.97 21.15 18.99 23.68 21.85 17.46 23.29 22.52 23.67 19.85 23.58 |
| ecs/outbox-publisher/MemoryUtilization | 18.55 | 18.55 15.04 16.02 16.7 17.09 16.89 17.09 17.09 16.99 17.19 17.29 17.09 16.99 |
| ecs/activity-service/CPUUtilization | 47.62 | 16.09 23.49 47.62 17.57 15.13 15.18 18.01 15.37 15.06 14.86 15.44 18.12 16.05 |
| ecs/activity-service/MemoryUtilization | 20.31 | 14.75 20.31 15.82 15.82 18.36 18.16 17.97 17.97 17.97 17.97 17.97 17.97 17.97 |
| ecs/realtime-service/CPUUtilization | 29.21 | 14.93 29.21 14.33 14.49 14.47 14.4 14.59 14.65 14.32 14.74 15.08 16.19 14.75 |
| ecs/realtime-service/MemoryUtilization | 21.29 | 14.06 21.29 15.23 15.23 14.65 14.65 14.65 14.65 14.65 14.84 14.84 14.84 14.84 |
| ecs/cache-invalidator/CPUUtilization | 32.97 | 15.84 32.97 16.01 15.57 15.44 15.96 15.95 15.72 15.82 15.54 15.83 15.54 15.61 |
| ecs/cache-invalidator/MemoryUtilization | 17.58 | 12.3 17.58 13.28 13.28 13.09 13.09 13.38 14.06 14.06 14.06 14.06 14.06 14.06 |
| rds/CPUUtilization | 11.29 | 4.83 5.94 9.38 7.29 7.25 7.98 10.66 9.78 8.96 8.33 11.29 9.82 7.59 |
| rds/DatabaseConnections | 13.0 | 1.0 7.0 12.0 11.0 12.0 11.0 11.0 11.0 12.0 11.0 11.0 13.0 1.0 |
| rds/ReadIOPS | 6.73 | 0.13 1.75 0.5 0.1 0.02 0.0 6.73 0.02 0.47 0.12 0.15 3.9 0.48 |
| rds/WriteIOPS | 30.59 | 0.28 30.59 27.91 2.33 0.37 0.18 9.49 0.22 9.39 0.57 0.28 9.45 9.49 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.58 | 0.7 0.7 0.78 1.48 1.42 1.58 1.57 1.47 1.53 1.53 1.33 1.35 1.35 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
