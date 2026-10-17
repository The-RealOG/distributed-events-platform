# Load run `e-ws-1000`

## k6 (load generator view)

```
connections 1000 on 20 project(s); subscribed 69.00 %
events published 299 (2/s); notifications received 10465 of ~14950 expected (70.00 %)
notification after HTTP 201 (ms): p50 257  p95 514  p99 550  max 693  (n=299)
notification after request sent (ms): p50 357  p95 615  p99 622
server-initiated closes 310
time="2026-10-17T19:00:08Z" level=error msg="thresholds on metrics 'ws_subscribed' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 0, misses 20, errors 0 → hit rate **0.0 %**
- project-service HTTP responses by class: 2xx 1550
- Outbox: published 399; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 399; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 399; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 399; retries 0; dead-lettered 0
- activity outcomes: processed 399
- realtime hub: broadcast 10764; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 4575 commits (10.5/s over 436 s between snapshots), rollbacks 0; tuples returned 3359933, fetched 53939, inserted 2837, updated 831, deleted 20; blocks read 0, hit 504822
- project-service memory at end: RSS 132 MiB, heap used 31 MiB
- api-gateway memory at end: RSS 91 MiB, heap used 24 MiB
- realtime-service memory at end: RSS 93 MiB, heap used 31 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 47.38 | 14.41 8.92 47.38 18.83 13.64 14.44 8.62 27.51 |
| ecs/project-service/MemoryUtilization | 35.55 | 35.55 29.1 32.52 32.13 30.27 30.47 30.27 34.67 |
| ecs/api-gateway/CPUUtilization | 39.97 | 4.16 22.66 39.97 31.83 12.27 13.96 10.59 17.18 |
| ecs/api-gateway/MemoryUtilization | 20.31 | 14.65 19.53 19.73 20.12 20.31 20.31 20.12 19.73 |
| ecs/outbox-publisher/CPUUtilization | 27.76 | 13.77 27.76 18.38 20.33 16.59 17.11 18.78 19.89 |
| ecs/outbox-publisher/MemoryUtilization | 26.86 | 23.05 26.86 24.32 24.02 23.44 24.61 24.41 24.61 |
| ecs/activity-service/CPUUtilization | 29.04 | 13.91 29.04 17.3 13.8 15.52 16.38 14.81 14.74 |
| ecs/activity-service/MemoryUtilization | 20.9 | 16.21 20.9 16.21 16.21 16.02 18.55 18.55 18.55 |
| ecs/realtime-service/CPUUtilization | 44.36 | 14.68 18.52 20.0 44.36 16.84 17.3 16.16 16.36 |
| ecs/realtime-service/MemoryUtilization | 28.03 | 21.68 22.17 28.03 22.17 22.27 22.07 16.6 16.6 |
| ecs/cache-invalidator/CPUUtilization | 28.73 | 14.84 28.73 19.4 14.69 15.38 15.93 15.36 15.57 |
| ecs/cache-invalidator/MemoryUtilization | 24.71 | 19.14 24.71 20.31 19.53 18.95 18.95 18.95 19.14 |
| rds/CPUUtilization | 7.95 | 4.45 4.84 7.95 5.48 5.92 5.74 5.02 5.88 |
| rds/DatabaseConnections | 4.0 | 1.0 2.0 1.0 3.0 4.0 4.0 1.0 1.0 |
| rds/ReadIOPS | 11.02 | 0.72 1.2 4.43 2.68 11.02 2.35 1.72 2.98 |
| rds/WriteIOPS | 20.12 | 0.43 1.38 20.12 2.93 18.92 10.25 6.4 5.87 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.73 | 0.72 0.7 0.72 0.73 0.72 0.73 0.73 0.72 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
