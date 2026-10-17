# Load run `e-ws-100`

## k6 (load generator view)

```
connections 100 on 20 project(s); subscribed 100.00 %
events published 300 (2/s); notifications received 1500 of ~1500 expected (100.00 %)
notification after HTTP 201 (ms): p50 270  p95 504  p99 548  max 617  (n=300)
notification after request sent (ms): p50 362  p95 611  p99 616
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
- realtime hub: broadcast 1800; connections now 0.0
- project-service DB pool at end: total 2, idle 2; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 3861 commits (9.9/s over 389 s between snapshots), rollbacks 0; tuples returned 2977331, fetched 46799, inserted 2823, updated 820, deleted 2; blocks read 0, hit 441672
- project-service memory at end: RSS 127 MiB, heap used 32 MiB
- api-gateway memory at end: RSS 122 MiB, heap used 32 MiB
- realtime-service memory at end: RSS 114 MiB, heap used 31 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 73.85 | 8.61 73.85 9.62 12.8 10.37 9.49 26.44 |
| ecs/project-service/MemoryUtilization | 27.44 | 18.75 22.27 23.14 23.83 24.02 23.54 27.44 |
| ecs/api-gateway/CPUUtilization | 41.82 | 32.36 41.82 37.21 23.87 20.88 21.23 24.36 |
| ecs/api-gateway/MemoryUtilization | 22.75 | 21.0 15.33 20.9 20.7 20.7 20.7 22.75 |
| ecs/outbox-publisher/CPUUtilization | 23.27 | 23.27 9.57 22.94 15.77 16.67 20.22 18.48 |
| ecs/outbox-publisher/MemoryUtilization | 25.49 | 25.49 22.95 24.12 24.12 24.41 23.83 23.83 |
| ecs/activity-service/CPUUtilization | 26.28 | 26.28 14.14 20.8 16.1 15.37 22.64 15.09 |
| ecs/activity-service/MemoryUtilization | 27.25 | 27.25 22.56 21.78 21.48 21.09 21.09 13.67 |
| ecs/realtime-service/CPUUtilization | 22.55 | 14.39 22.55 18.0 15.91 18.45 16.3 14.81 |
| ecs/realtime-service/MemoryUtilization | 26.56 | 19.53 26.56 20.02 20.12 19.82 19.73 19.73 |
| ecs/cache-invalidator/CPUUtilization | 25.74 | 14.71 25.74 14.81 15.82 16.08 15.94 15.08 |
| ecs/cache-invalidator/MemoryUtilization | 24.8 | 18.75 24.8 18.95 18.95 18.95 18.95 18.55 |
| rds/CPUUtilization | 6.02 | 4.62 6.0 6.02 5.99 5.72 5.35 |
| rds/DatabaseConnections | 8.0 | 1.0 8.0 2.0 4.0 4.0 1.0 2.0 |
| rds/ReadIOPS | 11.08 | 0.98 3.68 1.73 11.08 1.95 2.62 |
| rds/WriteIOPS | 20.83 | 1.0 20.83 1.48 17.19 10.35 11.0 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.75 | 0.7 0.7 0.75 0.68 0.73 0.73 0.72 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
