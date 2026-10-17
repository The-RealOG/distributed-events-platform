# Load run `e-ws-storm-1000-2rep`

## k6 (load generator view)

```
connections 1000 on 20 project(s); subscribed 100.00 %
events published 299 (2/s); notifications received 14950 of ~14950 expected (100.00 %)
notification after HTTP 201 (ms): p50 272  p95 500  p99 513  max 561  (n=299)
notification after request sent (ms): p50 309  p95 545  p99 595
server-initiated closes 0
```

## Service metrics (deltas over the run)

- Board cache (server): hits 0, misses 20, errors 0 → hit rate **0.0 %**
- project-service HTTP responses by class: 2xx 1550
- Outbox: published 399; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 399; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 399; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 399; retries 0; dead-lettered 0
- activity outcomes: processed 399
- realtime hub: broadcast 6279; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 1; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 4536 commits (14.8/s over 307 s between snapshots), rollbacks 0; tuples returned 2756424, fetched 47668, inserted 2820, updated 819, deleted 3; blocks read 0, hit 412010
- project-service memory at end: RSS 125 MiB, heap used 35 MiB
- api-gateway memory at end: RSS 124 MiB, heap used 36 MiB
- realtime-service memory at end: RSS 127 MiB, heap used 37 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 64.28 | 16.4 8.64 64.28 14.0 13.79 24.82 |
| ecs/project-service/MemoryUtilization | 37.01 | 36.23 29.2 31.54 31.45 31.64 37.01 |
| ecs/api-gateway/CPUUtilization | 61.22 | 4.49 23.94 61.22 10.21 9.55 7.74 |
| ecs/api-gateway/MemoryUtilization | 21.19 | 14.75 19.63 21.0 21.19 21.09 20.9 |
| ecs/outbox-publisher/CPUUtilization | 25.04 | 13.84 25.04 23.52 20.24 16.08 16.6 |
| ecs/outbox-publisher/MemoryUtilization | 26.46 | 22.66 26.46 24.61 24.9 24.12 25.1 |
| ecs/activity-service/CPUUtilization | 29.4 | 13.7 29.4 22.37 15.53 15.23 14.19 |
| ecs/activity-service/MemoryUtilization | 24.22 | 19.53 24.22 20.02 19.73 19.53 19.53 |
| ecs/realtime-service/CPUUtilization | 39.82 | 14.58 18.5 39.82 16.56 16.41 19.9 |
| ecs/realtime-service/MemoryUtilization | 29.1 | 22.66 23.34 29.1 23.24 23.14 22.85 |
| ecs/cache-invalidator/CPUUtilization | 31.22 | 15.25 31.22 15.54 16.56 16.35 15.17 |
| ecs/cache-invalidator/MemoryUtilization | 24.51 | 19.92 24.51 21.0 20.31 19.53 19.53 |
| rds/CPUUtilization | 7.74 | 5.34 4.7 7.74 5.91 5.67 5.8 |
| rds/DatabaseConnections | 5.0 | 1.0 2.0 3.0 3.0 5.0 |
| rds/ReadIOPS | 11.26 | 10.78 0.78 2.62 4.33 11.26 |
| rds/WriteIOPS | 23.12 | 9.31 0.6 23.12 10.12 10.29 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.78 | 0.68 0.72 0.68 0.78 0.75 0.73 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 |
