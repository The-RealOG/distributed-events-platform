# Load run `d-publisher-2`

## k6 (load generator view)

```
time="2026-10-17T16:52:06Z" level=info msg="MEASURE_T0=2026-10-17T16:52:06.343Z" source=console

ALL (steady scenario)      n=  21298  p50=    66  p95=   201  p99=   600  max=  1578 ms
  move                     n=   4289  p50=    67  p95=   223  p99=   671  max=  1578 ms
  delete                   n=   1662  p50=    64  p95=   198  p99=   669  max=  1318 ms
  create                   n=   1941  p50=    66  p95=   198  p99=   669  max=  1300 ms
  comment                  n=   2031  p50=    65  p95=   191  p99=   469  max=  1208 ms
  task                     n=   1280  p50=    66  p95=   153  p99=   349  max=  1407 ms
  update                   n=   4209  p50=    65  p95=   211  p99=   563  max=  1543 ms
  unassign                 n=   1055  p50=    63  p95=   178  p99=   732  max=  1308 ms
  assign                   n=   1682  p50=    66  p95=   199  p99=   592  max=  1050 ms
  board                    n=   2097  p50=    70  p95=   191  p99=   524  max=  1127 ms
  activity                 n=   1052  p50=    67  p95=   156  p99=   642  max=  1360 ms
requests 22849 (41.3/s over 553 s incl. setup), failed 0.00 %
successful writes 16569 (29.9/s)
version conflicts (409) 300
board cache (client view, x-board-cache) hit 309 / miss 1788 = 14.7 % hits
  board (hit)              n=    309  p50=    68  p95=   136  p99=   381  max=   948 ms
  board (miss)             n=   1788  p50=    71  p95=   194  p99=   627  max=  1127 ms
```

## Service metrics (deltas over the run)

- Board cache (server): hits 309, misses 1808, errors 0 → hit rate **14.6 %**
- project-service HTTP responses by class: 2xx 22549, 4xx 300, 5xx 0
- Outbox: published 15679; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 15679; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 15679; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 15679; retries 0; dead-lettered 0
- activity outcomes: processed 15679
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 63649 commits (95.2/s over 668 s between snapshots), rollbacks 300; tuples returned 6188190, fetched 1752731, inserted 54117, updated 43155, deleted 590; blocks read 0, hit 3325189
- project-service memory at end: RSS 133 MiB, heap used 43 MiB
- api-gateway memory at end: RSS 128 MiB, heap used 40 MiB
- realtime-service memory at end: RSS 115 MiB, heap used 31 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 83.52 | 31.49 83.52 71.36 73.86 73.07 74.01 71.77 68.13 64.46 66.76 72.6 |
| ecs/project-service/MemoryUtilization | 32.52 | 32.32 27.73 32.13 32.42 32.52 31.54 32.52 32.03 31.25 31.35 31.35 |
| ecs/api-gateway/CPUUtilization | 30.01 | 22.91 14.18 29.56 29.1 29.2 29.48 30.01 28.18 29.84 29.26 28.93 |
| ecs/api-gateway/MemoryUtilization | 22.85 | 22.85 19.34 20.02 19.73 19.73 19.53 19.53 19.53 19.53 19.53 19.53 |
| ecs/outbox-publisher/CPUUtilization | 38.02 | 18.07 17.86 38.02 27.16 29.46 33.16 31.7 27.51 30.54 32.76 28.01 |
| ecs/outbox-publisher/MemoryUtilization | 26.07 | 26.07 22.46 23.83 24.9 25.39 23.14 23.34 23.63 23.34 23.24 22.36 |
| ecs/activity-service/CPUUtilization | 37.12 | 28.74 15.5 33.08 33.81 33.05 33.4 32.9 33.06 37.12 35.49 33.7 |
| ecs/activity-service/MemoryUtilization | 24.41 | 24.41 23.73 21.29 21.09 20.9 20.8 20.7 20.7 20.7 20.61 20.7 |
| ecs/realtime-service/CPUUtilization | 29.9 | 14.44 26.51 22.9 26.07 26.58 26.94 26.78 27.38 26.56 29.9 28.57 |
| ecs/realtime-service/MemoryUtilization | 27.05 | 19.34 27.05 19.73 19.73 19.14 19.14 19.14 19.14 19.14 19.14 19.14 |
| ecs/cache-invalidator/CPUUtilization | 32.27 | 15.23 31.84 25.33 29.14 29.59 29.93 29.74 30.25 30.06 30.55 32.27 |
| ecs/cache-invalidator/MemoryUtilization | 22.17 | 18.75 22.17 19.04 18.95 18.26 18.36 18.26 18.36 18.36 18.36 18.36 |
| rds/CPUUtilization | 16.77 | 5.05 5.35 11.91 13.74 14.18 15.22 14.27 16.49 16.77 14.28 16.11 |
| rds/DatabaseConnections | 14.0 | 1.0 8.0 12.0 13.0 8.0 14.0 12.0 12.0 2.0 |
| rds/ReadIOPS | 12.85 | 1.9 1.03 11.44 4.28 5.55 12.85 7.79 5.99 |
| rds/WriteIOPS | 118.4 | 0.23 24.64 97.54 105.14 104.49 118.4 107.02 73.09 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.2 | 0.7 0.72 0.8 1.1 1.18 1.18 1.18 1.17 1.2 1.15 1.17 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
