# Load run `c-profile-2task`

## k6 (load generator view)

```
time="2026-10-17T18:20:54Z" level=info msg="MEASURE_T0=2026-10-17T18:20:54.199Z" source=console

ALL (steady scenario)      n= 112909  p50=   320  p95=   738  p99=  1033  max=  2532 ms
  activity                 n=   5297  p50=   463  p95=  1014  p99=  1319  max=  2507 ms
  board                    n=  86051  p50=   319  p95=   716  p99=   991  max=  2532 ms
  task                     n=   5457  p50=   367  p95=   834  p99=  1147  max=  2490 ms
  workspaces               n=  10729  p50=   276  p95=   663  p99=   921  max=  2358 ms
  projects                 n=   5375  p50=   301  p95=   792  p99=  1085  max=  1901 ms
requests 114460 (270.2/s over 424 s incl. setup), failed 0.00 %
board cache (client view, x-board-cache) hit 85828 / miss 81 = 99.9 % hits
  board (hit)              n=  85828  p50=   318  p95=   713  p99=   980  max=  2479 ms
  board (miss)             n=     81  p50=   525  p95=   751  p99=   883  max=   926 ms
  board (bypass)           n=    142  p50=   853  p95=  1204  p99=  2524  max=  2532 ms
time="2026-10-17T18:27:37Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{op:activity}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 269918, misses 30988, errors 2325 → hit rate **89.7 %**
- project-service HTTP responses by class: 2xx 55716, 4xx 0, 5xx 0
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 138653 commits (242.4/s over 572 s between snapshots), rollbacks 0; tuples returned 399094032, fetched 393408484, inserted 2822, updated 821, deleted 1; blocks read 0, hit 22509907
- project-service memory at end: RSS 139 MiB, heap used 41 MiB
- api-gateway memory at end: RSS 140 MiB, heap used 25 MiB
- realtime-service memory at end: RSS 112 MiB, heap used 28 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 95.55 | 6.49 66.71 90.44 90.77 89.52 85.9 92.24 91.48 95.55 |
| ecs/project-service/MemoryUtilization | 38.57 | 18.16 25.78 31.64 31.64 31.74 31.93 38.57 34.28 34.08 |
| ecs/api-gateway/CPUUtilization | 99.85 | 11.09 51.37 98.29 99.8 98.92 99.85 99.53 99.68 99.36 |
| ecs/api-gateway/MemoryUtilization | 28.71 | 16.02 14.26 21.48 21.78 21.88 28.71 25.2 24.8 24.51 |
| ecs/outbox-publisher/CPUUtilization | 21.02 | 13.76 10.35 14.44 19.68 14.61 18.97 18.82 15.34 21.02 |
| ecs/outbox-publisher/MemoryUtilization | 26.86 | 26.86 24.22 23.83 23.93 24.22 23.83 24.02 24.22 23.34 |
| ecs/activity-service/CPUUtilization | 26.37 | 26.37 14.32 14.63 13.96 13.95 13.76 14.01 13.64 13.5 |
| ecs/activity-service/MemoryUtilization | 28.71 | 28.71 21.68 21.88 21.29 21.29 21.29 21.29 21.29 21.29 |
| ecs/realtime-service/CPUUtilization | 29.61 | 14.36 24.33 29.61 14.55 14.5 14.58 14.41 14.76 14.61 |
| ecs/realtime-service/MemoryUtilization | 26.95 | 19.73 26.95 20.51 20.51 19.92 19.92 19.92 19.92 19.92 |
| ecs/cache-invalidator/CPUUtilization | 32.83 | 14.85 20.62 32.83 14.52 14.68 14.99 14.7 14.52 14.5 |
| ecs/cache-invalidator/MemoryUtilization | 25.39 | 18.55 25.39 19.14 18.95 18.75 18.75 18.75 18.75 18.75 |
| rds/CPUUtilization | 28.89 | 4.73 7.61 25.2 28.89 24.87 24.93 24.04 24.68 20.88 |
| rds/DatabaseConnections | 23.0 | 1.0 9.0 23.0 21.0 22.0 21.0 22.0 23.0 |
| rds/ReadIOPS | 20.19 | 0.23 4.74 10.64 20.19 7.48 8.46 8.32 14.95 |
| rds/WriteIOPS | 41.56 | 0.73 41.56 0.55 9.73 0.43 4.07 4.21 10.11 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.95 | 0.7 0.7 1.02 1.77 1.93 1.95 1.83 1.87 1.87 |
| redis/dpp-dev-001/CurrConnections | 8.0 | 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 8.0 |
