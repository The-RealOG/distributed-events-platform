# Load run `d-publisher-1`

## k6 (load generator view)

```
time="2026-10-17T16:37:33Z" level=info msg="MEASURE_T0=2026-10-17T16:37:33.073Z" source=console

ALL (steady scenario)      n=  22718  p50=    34  p95=   166  p99=   423  max=  1351 ms
  comment                  n=   2187  p50=    33  p95=   152  p99=   401  max=   878 ms
  board                    n=   2232  p50=    36  p95=   152  p99=   402  max=  1351 ms
  task                     n=   1376  p50=    33  p95=   111  p99=   262  max=  1077 ms
  delete                   n=   1808  p50=    32  p95=   131  p99=   382  max=  1271 ms
  create                   n=   2113  p50=    34  p95=   152  p99=   375  max=   779 ms
  unassign                 n=   1051  p50=    31  p95=   165  p99=   426  max=  1179 ms
  update                   n=   4495  p50=    34  p95=   178  p99=   471  max=  1254 ms
  move                     n=   4514  p50=    35  p95=   189  p99=   456  max=  1304 ms
  activity                 n=   1130  p50=    33  p95=   128  p99=   336  max=   971 ms
  assign                   n=   1812  p50=    34  p95=   186  p99=   529  max=  1179 ms
requests 24269 (44.6/s over 544 s incl. setup), failed 0.00 %
successful writes 17688 (32.5/s)
version conflicts (409) 292
board cache (client view, x-board-cache) hit 315 / miss 1917 = 14.1 % hits
  board (hit)              n=    315  p50=    33  p95=   110  p99=   397  max=   647 ms
  board (miss)             n=   1917  p50=    36  p95=   159  p99=   392  max=  1351 ms
```

## Service metrics (deltas over the run)

- Board cache (server): hits 315, misses 1937, errors 0 → hit rate **14.0 %**
- project-service HTTP responses by class: 2xx 23977, 4xx 292, 5xx 0
- Outbox: published 16783; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 16783; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 16783; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 16783; retries 0; dead-lettered 0
- activity outcomes: processed 16783
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 67604 commits (102.2/s over 662 s between snapshots), rollbacks 292; tuples returned 4930584, fetched 1688168, inserted 57948, updated 46329, deleted 702; blocks read 0, hit 3334014
- project-service memory at end: RSS 135 MiB, heap used 35 MiB
- api-gateway memory at end: RSS 124 MiB, heap used 42 MiB
- realtime-service memory at end: RSS 117 MiB, heap used 41 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 92.72 | 17.05 5.62 92.72 78.69 67.58 75.11 80.23 73.69 67.4 66.84 68.6 47.1 |
| ecs/project-service/MemoryUtilization | 36.43 | 28.42 19.82 29.0 30.66 29.49 29.2 29.2 29.1 29.79 29.79 29.79 36.43 |
| ecs/api-gateway/CPUUtilization | 51.66 | 4.19 21.17 51.66 32.86 34.4 33.35 33.75 30.41 31.62 30.79 31.03 30.19 |
| ecs/api-gateway/MemoryUtilization | 19.04 | 12.5 19.04 18.36 18.46 18.46 18.55 18.55 18.55 18.55 18.55 18.55 18.55 |
| ecs/outbox-publisher/CPUUtilization | 33.82 | 13.21 29.15 22.53 32.61 30.05 30.01 33.37 32.93 29.09 33.82 31.98 31.58 |
| ecs/outbox-publisher/MemoryUtilization | 23.63 | 20.51 23.63 22.85 23.54 23.24 22.56 22.56 22.46 22.95 22.66 22.66 21.78 |
| ecs/activity-service/CPUUtilization | 39.21 | 13.82 27.57 17.63 34.82 39.21 36.68 36.74 35.79 37.45 34.89 35.43 34.45 |
| ecs/activity-service/MemoryUtilization | 26.37 | 20.7 26.37 20.9 20.9 20.61 20.7 20.61 20.51 20.61 20.7 20.7 20.51 |
| ecs/realtime-service/CPUUtilization | 30.59 | 14.43 22.46 30.59 28.12 27.9 27.62 27.2 26.38 27.15 27.28 27.61 25.77 |
| ecs/realtime-service/MemoryUtilization | 25.98 | 19.14 20.9 25.98 19.63 19.34 19.24 19.24 19.14 19.14 19.14 19.14 19.14 |
| ecs/cache-invalidator/CPUUtilization | 33.79 | 14.66 28.06 33.79 31.35 30.65 31.0 30.45 29.95 30.81 30.7 31.37 28.31 |
| ecs/cache-invalidator/MemoryUtilization | 24.12 | 17.97 24.12 19.14 18.36 18.26 18.16 18.16 18.16 18.16 18.16 18.07 18.07 |
| rds/CPUUtilization | 17.44 | 4.44 4.44 9.24 13.32 14.08 15.53 16.03 15.69 13.83 17.44 16.23 10.72 |
| rds/DatabaseConnections | 13.0 | 1.0 2.0 10.0 12.0 12.0 12.0 13.0 13.0 11.0 10.0 |
| rds/ReadIOPS | 12.05 | 1.63 0.03 11.16 2.39 3.73 2.84 12.05 3.75 7.77 5.25 |
| rds/WriteIOPS | 123.4 | 0.2 0.27 80.48 114.54 106.29 108.63 123.4 107.73 110.42 106.63 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.28 | 0.73 0.68 0.72 0.95 1.22 1.23 1.28 1.2 1.23 1.25 1.2 1.2 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
