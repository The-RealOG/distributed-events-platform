# Load run `e-ws-1000`

## k6 (load generator view)

```
connections 1000 on 20 project(s); subscribed 100.00 %
events published 300 (2/s); notifications received 15000 of ~15000 expected (100.00 %)
notification after HTTP 201 (ms): p50 236  p95 502  p99 551  max 581  (n=300)
notification after request sent (ms): p50 332  p95 617  p99 646
server-initiated closes 0
```

## Service metrics (deltas over the run)

- Board cache (server): hits 0, misses 20, errors 0 → hit rate **0.0 %**
- project-service HTTP responses by class: 2xx 1551
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- realtime hub: broadcast 15300; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 4765 commits (12.3/s over 387 s between snapshots), rollbacks 0; tuples returned 3158824, fetched 53650, inserted 2748, updated 945, deleted 29; blocks read 0, hit 473399
- project-service memory at end: RSS 132 MiB, heap used 35 MiB
- api-gateway memory at end: RSS 124 MiB, heap used 36 MiB
- realtime-service memory at end: RSS 125 MiB, heap used 47 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 71.09 | 6.7 71.09 11.11 14.71 13.17 12.86 21.41 |
| ecs/project-service/MemoryUtilization | 34.38 | 29.88 31.45 30.66 30.76 29.59 29.59 34.38 |
| ecs/api-gateway/CPUUtilization | 43.6 | 12.56 10.14 43.6 24.13 14.56 13.62 20.89 |
| ecs/api-gateway/MemoryUtilization | 25.39 | 19.53 13.38 20.02 20.7 20.7 20.7 25.39 |
| ecs/outbox-publisher/CPUUtilization | 25.52 | 25.52 18.13 24.23 16.3 20.34 18.32 15.96 |
| ecs/outbox-publisher/MemoryUtilization | 28.22 | 28.22 23.63 24.8 24.8 24.32 24.41 24.61 |
| ecs/activity-service/CPUUtilization | 20.17 | 20.17 14.19 16.12 16.4 19.49 15.51 13.82 |
| ecs/activity-service/MemoryUtilization | 25.98 | 25.98 19.53 19.63 19.34 19.43 19.34 19.34 |
| ecs/realtime-service/CPUUtilization | 33.13 | 14.4 26.16 33.13 27.72 17.44 17.01 20.73 |
| ecs/realtime-service/MemoryUtilization | 25.49 | 20.51 25.49 21.48 21.68 21.78 21.97 22.27 |
| ecs/cache-invalidator/CPUUtilization | 19.98 | 15.04 19.98 16.88 16.44 16.47 16.64 15.54 |
| ecs/cache-invalidator/MemoryUtilization | 25.98 | 18.95 25.98 19.73 19.73 19.04 18.95 18.95 |
| rds/CPUUtilization | 8.17 | 4.94 5.58 8.17 5.61 6.47 5.37 |
| rds/DatabaseConnections | 7.0 | 1.0 7.0 4.0 4.0 3.0 2.0 2.0 |
| rds/ReadIOPS | 10.74 | 0.65 10.6 3.3 4.49 1.67 10.74 |
| rds/WriteIOPS | 24.01 | 0.15 24.01 12.94 11.88 8.11 9.21 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.75 | 0.72 0.72 0.72 0.7 0.75 0.75 0.72 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
