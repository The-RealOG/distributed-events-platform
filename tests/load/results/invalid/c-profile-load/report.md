# Load run `c-profile-load`

## k6 (load generator view)

```
time="2026-10-17T13:48:47Z" level=info msg="MEASURE_T0=2026-10-17T13:48:47.739Z" source=console

ALL (steady scenario)      n=  44001  p50=   179  p95=  5027  p99=  5060  max= 15205 ms
  board                    n=  34468  p50=    96  p95=  5024  p99=  5040  max= 15205 ms
  workspaces               n=   4326  p50=   272  p95=  5038  p99=  5090  max= 15189 ms
  projects                 n=    983  p50=   399  p95=  2858  p99=  5596  max= 15151 ms
  task                     n=   2081  p50=   663  p95=  5042  p99=  5466  max=  8916 ms
  activity                 n=   2143  p50=   917  p95=  5054  p99=  6363  max=  8118 ms
requests 45552 (104.5/s over 436 s incl. setup), failed 50.71 %
board cache (client view, x-board-cache) hit 15815 / miss 20 = 99.9 % hits
  board (hit)              n=  15815  p50=   316  p95=  1673  p99=  4526  max=  5342 ms
  board (miss)             n=     20  p50=    36  p95=    51  p99=    56  max=    57 ms
  board (bypass)           n=     84  p50=  1411  p95=  3281  p99=  3311  max=  3323 ms
time="2026-10-17T13:55:32Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{op:activity}, http_req_duration{op:board}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:workspaces}, http_req_failed' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 15819, misses 40, errors 84 → hit rate **99.7 %**
- project-service HTTP responses by class: 2xx 22458, 4xx 0, 5xx 4781
- Outbox: published 0; failures 0; pending after None; oldest pending age after None s
- activity-service consumer messages: processed 400; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 400; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 400; retries 0; dead-lettered 0
- activity outcomes: duplicate 0, failed 0, processed 400
- realtime hub: duplicate_suppressed 0; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 28085 commits (49.1/s over 572 s between snapshots), rollbacks 14; tuples returned 223689166, fetched 220026651, inserted 2827, updated 821, deleted 6; blocks read 199286, hit 11953329
- project-service memory at end: RSS 143 MiB, heap used 38 MiB
- api-gateway memory at end: RSS 140 MiB, heap used 26 MiB
- realtime-service memory at end: RSS 114 MiB, heap used 31 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 98.87 | 4.58 66.14 97.13 98.68 98.87 23.47 24.52 36.84 35.07 |
| ecs/project-service/MemoryUtilization | 36.43 | 25.88 28.81 30.18 30.57 36.43 29.88 31.84 33.98 33.69 |
| ecs/api-gateway/CPUUtilization | 75.87 | 15.92 48.13 73.78 75.87 70.08 30.58 14.53 14.15 13.97 |
| ecs/api-gateway/MemoryUtilization | 27.25 | 26.37 19.73 20.7 20.8 20.7 27.25 21.58 21.29 21.29 |
| ecs/outbox-publisher/CPUUtilization | 21.67 | 18.22 19.99 21.01 20.69 21.67 16.64 20.43 19.77 16.93 |
| ecs/outbox-publisher/MemoryUtilization | 27.34 | 27.34 23.73 23.44 23.24 23.34 23.24 23.34 23.24 23.24 |
| ecs/activity-service/CPUUtilization | 24.08 | 20.95 24.08 12.49 12.85 12.45 12.42 12.65 12.31 12.34 |
| ecs/activity-service/MemoryUtilization | 24.12 | 24.12 20.41 20.31 20.31 20.31 20.31 20.31 20.31 20.31 |
| ecs/realtime-service/CPUUtilization | 31.6 | 27.57 31.6 14.72 14.85 14.94 14.65 14.47 14.46 14.73 |
| ecs/realtime-service/MemoryUtilization | 25.1 | 21.88 25.1 19.73 19.73 19.14 19.14 19.14 19.14 19.14 |
| ecs/cache-invalidator/CPUUtilization | 28.52 | 28.52 15.52 13.19 13.13 13.15 13.11 12.84 12.86 13.03 |
| ecs/cache-invalidator/MemoryUtilization | 22.17 | 22.17 21.68 19.04 18.55 18.55 18.55 18.55 18.55 18.55 |
| rds/CPUUtilization | 43.21 | 8.05 17.59 43.21 40.85 23.35 6.01 5.97 16.1 11.68 |
| rds/DatabaseConnections | 13.0 | 1.0 11.0 13.0 13.0 |
| rds/ReadIOPS | 245.33 | 123.63 245.33 188.54 174.53 |
| rds/WriteIOPS | 40.76 | 9.48 40.76 9.77 10.06 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.37 | 0.72 0.68 0.88 1.3 1.37 0.87 0.7 0.72 0.7 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
