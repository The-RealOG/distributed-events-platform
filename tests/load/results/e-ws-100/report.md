# Load run `e-ws-100`

## k6 (load generator view)

```
connections 100 on 20 project(s); subscribed 100.00 %
events published 300 (2/s); notifications received 1500 of ~1500 expected (100.00 %)
notification after HTTP 201 (ms): p50 240  p95 504  p99 550  max 584  (n=300)
notification after request sent (ms): p50 324  p95 611  p99 630
server-initiated closes 0
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 1551
- Outbox: published 400; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: processed 400
- realtime hub: broadcast 1800; connections now 0.0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 3930 commits (9.4/s over 418 s between snapshots), rollbacks 0; tuples returned 3086125, fetched 48679, inserted 2727, updated 928, deleted 5; blocks read 0, hit 447553
- project-service memory at end: RSS 132 MiB, heap used 35 MiB
- api-gateway memory at end: RSS 122 MiB, heap used 28 MiB
- realtime-service memory at end: RSS 100 MiB, heap used 37 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 36.58 | 19.77 36.58 35.4 14.64 13.29 12.47 25.18 |
| ecs/project-service/MemoryUtilization | 35.06 | 32.52 29.79 30.86 30.57 30.86 31.05 35.06 |
| ecs/api-gateway/CPUUtilization | 45.53 | 10.88 4.0 45.53 6.16 7.42 7.03 6.13 |
| ecs/api-gateway/MemoryUtilization | 20.12 | 20.12 12.89 19.34 19.34 19.34 19.14 19.14 |
| ecs/outbox-publisher/CPUUtilization | 25.27 | 25.27 13.34 19.77 20.19 16.5 20.08 18.02 |
| ecs/outbox-publisher/MemoryUtilization | 27.83 | 27.83 24.41 24.41 24.41 24.12 23.54 24.51 |
| ecs/activity-service/CPUUtilization | 19.96 | 13.89 19.96 13.92 15.45 16.43 16.54 13.67 |
| ecs/activity-service/MemoryUtilization | 25.49 | 18.55 25.49 19.24 19.14 18.95 19.14 19.24 |
| ecs/realtime-service/CPUUtilization | 31.41 | 15.09 31.41 24.33 16.41 16.14 16.23 15.64 |
| ecs/realtime-service/MemoryUtilization | 20.02 | 15.82 20.02 17.58 17.58 17.19 17.19 17.19 |
| ecs/cache-invalidator/CPUUtilization | 21.42 | 15.38 21.42 19.99 15.63 15.83 15.67 14.63 |
| ecs/cache-invalidator/MemoryUtilization | 25.98 | 18.95 25.98 19.73 19.73 19.63 19.73 19.34 |
| rds/CPUUtilization | 7.01 | 5.09 5.1 7.01 5.16 6.18 5.6 5.27 |
| rds/DatabaseConnections | 9.0 | 1.0 9.0 2.0 4.0 4.0 3.0 1.0 |
| rds/ReadIOPS | 12.18 | 1.32 10.83 2.3 2.38 3.65 1.62 12.18 |
| rds/WriteIOPS | 17.46 | 0.22 17.46 15.29 12.91 11.29 9.18 9.33 |
| redis/dpp-dev-001/EngineCPUUtilization | 0.75 | 0.72 0.68 0.7 0.75 0.72 0.73 0.75 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
