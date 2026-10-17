# Load run `b-hot-1`

## Service metrics (deltas over the run)

- Board cache (server): hits 114, misses 242, errors 0 → hit rate **32.0 %**
- project-service HTTP responses by class: 2xx 1871, 4xx 2, 5xx 52
- Outbox: published 665; failures 0; pending after 2.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 888; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 1078; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 1221; retries 0; dead-lettered 0
- activity outcomes: duplicate 0, failed 0, processed 888
- realtime hub: duplicate_suppressed 0; connections now 0.0
- project-service DB pool at end: total 10, idle 0; waiting 38
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 1, idle 1; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 14944 commits (90.3/s over 166 s between snapshots), rollbacks 61; tuples returned 6003398, fetched 2522861, inserted 6134, updated 3681, deleted 23; blocks read 159619, hit 1432134
- project-service memory at end: RSS 130 MiB, heap used 49 MiB
- api-gateway memory at end: RSS 128 MiB, heap used 37 MiB
- realtime-service memory at end: RSS 117 MiB, heap used 43 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 56.09 | 4.61 20.48 56.09 |
| ecs/project-service/MemoryUtilization | 37.01 | 19.73 20.51 37.01 |
| ecs/api-gateway/CPUUtilization | 32.44 | 8.84 3.74 32.44 |
| ecs/api-gateway/MemoryUtilization | 18.65 | 16.02 11.52 18.65 |
| ecs/outbox-publisher/CPUUtilization | 23.6 | 22.42 18.38 23.6 |
| ecs/outbox-publisher/MemoryUtilization | 27.05 | 27.05 22.27 23.44 |
| ecs/activity-service/CPUUtilization | 25.78 | 25.78 12.6 22.84 |
| ecs/activity-service/MemoryUtilization | 22.07 | 22.07 19.34 19.53 |
| ecs/realtime-service/CPUUtilization | 24.65 | 14.99 24.65 19.98 |
| ecs/realtime-service/MemoryUtilization | 23.63 | 18.95 23.63 19.14 |
| ecs/cache-invalidator/CPUUtilization | 21.32 | 17.54 21.32 18.07 |
| ecs/cache-invalidator/MemoryUtilization | 22.85 | 19.92 22.85 18.26 |
| rds/CPUUtilization | 30.81 | 7.96 5.61 30.81 |
| rds/DatabaseConnections | 12.0 | 1.0 7.0 12.0 |
| rds/ReadIOPS | 248.59 | 150.71 40.6 248.59 |
| rds/WriteIOPS | 31.35 | 0.65 7.94 31.35 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.72 | 0.68 0.72 0.7 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 |
