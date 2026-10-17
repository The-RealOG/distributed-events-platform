# Load run `e-ws-500-2rep`

## k6 (load generator view)

```
connections 500 on 20 project(s); subscribed 100.00 %
events published 299 (2/s); notifications received 7475 of ~7475 expected (100.00 %)
notification after HTTP 201 (ms): p50 275  p95 503  p99 547  max 548  (n=299)
notification after request sent (ms): p50 364  p95 610  p99 616
server-initiated closes 0
```

## Service metrics (deltas over the run)

- Board cache (server): hits 0, misses 20, errors 0 → hit rate **0.0 %**
- project-service HTTP responses by class: 2xx 1550
- Outbox: published 399; failures 0; pending after 0.0; oldest pending age after 0.0 s
- cache-invalidator consumer messages: processed 399; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 399; retries 0; dead-lettered 0
- realtime hub: broadcast 3887; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 4248 commits (11.2/s over 381 s between snapshots), rollbacks 0; tuples returned 3169944, fetched 49055, inserted 2823, updated 824, deleted 7; blocks read 0, hit 454503
- project-service memory at end: RSS 127 MiB, heap used 31 MiB
- api-gateway memory at end: RSS 123 MiB, heap used 28 MiB
- realtime-service memory at end: RSS 125 MiB, heap used 33 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 64.46 | 15.42 64.46 9.96 15.51 11.89 13.64 |
| ecs/project-service/MemoryUtilization | 35.16 | 35.16 31.35 31.05 31.05 31.25 30.76 |
| ecs/api-gateway/CPUUtilization | 29.09 | 24.56 29.09 24.27 12.47 10.61 11.11 16.62 |
| ecs/api-gateway/MemoryUtilization | 21.39 | 18.65 14.65 20.21 20.12 20.12 19.92 21.39 |
| ecs/outbox-publisher/CPUUtilization | 19.76 | 17.26 17.89 19.56 16.32 19.76 19.51 15.06 |
| ecs/outbox-publisher/MemoryUtilization | 27.44 | 27.44 24.61 24.71 24.61 24.61 24.9 25.0 |
| ecs/activity-service/CPUUtilization | 30.64 | 30.64 15.85 22.79 15.81 15.74 15.59 14.05 |
| ecs/activity-service/MemoryUtilization | 23.14 | 23.14 22.46 19.82 19.53 19.53 19.53 19.53 |
| ecs/realtime-service/CPUUtilization | 26.03 | 14.95 26.03 22.02 20.18 15.56 15.61 14.0 |
| ecs/realtime-service/MemoryUtilization | 29.79 | 22.07 29.79 22.75 22.85 22.27 22.36 22.36 |
| ecs/cache-invalidator/CPUUtilization | 32.13 | 15.5 32.13 15.17 15.96 16.14 16.47 15.37 |
| ecs/cache-invalidator/MemoryUtilization | 23.05 | 19.14 23.05 19.73 19.73 19.14 19.34 19.34 |
| rds/CPUUtilization | 7.1 | 5.11 5.89 6.92 7.1 6.39 5.47 |
| rds/DatabaseConnections | 10.0 | 1.0 10.0 4.0 4.0 3.0 2.0 3.0 |
| rds/ReadIOPS | 12.03 | 0.82 4.62 2.85 12.03 2.32 1.0 |
| rds/WriteIOPS | 22.27 | 0.55 22.27 8.35 19.01 7.14 4.5 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.75 | 0.7 0.72 0.73 0.72 0.72 0.75 0.72 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
