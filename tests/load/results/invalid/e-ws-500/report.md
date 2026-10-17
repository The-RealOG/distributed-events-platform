# Load run `e-ws-500`

## k6 (load generator view)

```
connections 500 on 20 project(s); subscribed 99.80 %
events published 299 (2/s); notifications received 7475 of ~7475 expected (100.00 %)
notification after HTTP 201 (ms): p50 256  p95 499  p99 509  max 520  (n=299)
notification after request sent (ms): p50 294  p95 542  p99 555
server-initiated closes 1
```

## Service metrics (deltas over the run)

- Board cache (server): hits 0, misses 20, errors 0 → hit rate **0.0 %**
- project-service HTTP responses by class: 2xx 1550
- Outbox: published 399; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 399; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 399; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 399; retries 0; dead-lettered 0
- activity outcomes: processed 399
- realtime hub: broadcast 7774; connections now 0.0
- project-service DB pool at end: total 2, idle 2; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 4287 commits (10.6/s over 404 s between snapshots), rollbacks 0; tuples returned 3169860, fetched 52049, inserted 2822, updated 813, deleted 4; blocks read 0, hit 470884
- project-service memory at end: RSS 134 MiB, heap used 31 MiB
- api-gateway memory at end: RSS 128 MiB, heap used 28 MiB
- realtime-service memory at end: RSS 120 MiB, heap used 39 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 64.45 | 20.75 4.89 64.45 11.29 10.3 14.28 11.02 27.8 |
| ecs/project-service/MemoryUtilization | 31.84 | 31.84 24.71 27.34 28.32 28.81 28.91 28.32 31.25 |
| ecs/api-gateway/CPUUtilization | 42.23 | 20.52 36.79 42.23 17.99 10.27 10.53 14.74 9.98 |
| ecs/api-gateway/MemoryUtilization | 24.71 | 21.88 24.71 22.07 22.36 20.9 20.9 20.7 22.17 |
| ecs/outbox-publisher/CPUUtilization | 20.51 | 13.47 19.24 18.83 15.14 17.0 20.51 20.05 15.57 |
| ecs/outbox-publisher/MemoryUtilization | 27.83 | 22.27 27.83 24.32 23.14 24.02 23.24 24.22 23.54 |
| ecs/activity-service/CPUUtilization | 25.92 | 13.72 25.92 14.26 14.08 17.52 15.89 14.98 16.94 |
| ecs/activity-service/MemoryUtilization | 17.68 | 13.87 17.68 14.75 15.04 14.65 16.02 16.02 15.92 |
| ecs/realtime-service/CPUUtilization | 27.96 | 14.83 14.65 27.96 27.94 16.27 16.49 15.49 18.77 |
| ecs/realtime-service/MemoryUtilization | 27.73 | 20.12 20.12 27.73 21.48 21.48 21.09 21.09 21.0 |
| ecs/cache-invalidator/CPUUtilization | 29.0 | 15.08 29.0 19.75 14.48 15.46 15.6 15.32 14.79 |
| ecs/cache-invalidator/MemoryUtilization | 21.68 | 19.14 21.58 21.68 18.95 18.75 18.75 18.75 18.75 |
| rds/CPUUtilization | 8.06 | 4.08 4.81 7.65 8.06 6.38 5.73 4.79 |
| rds/DatabaseConnections | 4.0 | 1.0 1.0 3.0 4.0 4.0 3.0 1.0 3.0 |
| rds/ReadIOPS | 11.63 | 0.42 1.2 4.68 11.63 2.47 1.85 3.27 |
| rds/WriteIOPS | 19.83 | 0.63 3.42 19.83 19.0 10.06 6.76 5.45 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.75 | 0.72 0.7 0.7 0.75 0.7 0.75 0.72 0.72 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
