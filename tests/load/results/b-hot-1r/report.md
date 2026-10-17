# Load run `b-hot-1r`

## k6 (load generator view)

```
time="2026-10-17T15:25:25Z" level=info msg="MEASURE_T0=2026-10-17T15:25:25.863Z" source=console

ALL (steady scenario)      n=  16807  p50=  2099  p95=  9560  p99= 11485  max= 13530 ms
  delete                   n=    180  p50=  1063  p95=  7092  p99=  7535  max=  7583 ms
  task                     n=   3085  p50=  1168  p95=  9257  p99=  9850  max= 10454 ms
  projects                 n=   1746  p50=  1003  p95=  9204  p99=  9780  max= 10217 ms
  board                    n=   6119  p50=  1410  p95=  9705  p99= 10305  max= 10856 ms
  move                     n=   1202  p50=  1325  p95=  7081  p99=  7693  max=  8303 ms
  update                   n=   1198  p50=  1084  p95=  6839  p99=  7626  max=  8002 ms
  activity                 n=   1780  p50=  1458  p95= 11985  p99= 12873  max= 13530 ms
  workspaces               n=   2619  p50=   757  p95=  6291  p99=  6950  max=  7422 ms
  comment                  n=    530  p50=  1094  p95=  6996  p99=  7657  max=  7985 ms
  create                   n=   1350  p50=  1015  p95=  6864  p99=  7425  max=  7959 ms
  assign                   n=    517  p50=  1310  p95=  7040  p99=  7707  max=  8268 ms
  unassign                 n=    365  p50=   856  p95=  6576  p99=  7124  max=  7666 ms
requests 21824 (34.2/s over 639 s incl. setup), failed 0.00 %
successful writes 4948 (7.7/s)
version conflicts (409) 394
board cache (client view, x-board-cache) hit 880 / miss 4955 = 15.1 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       41.3      10.2  0.00    773   1489   1821       1655        1224      1491        16.4   118
100      27.7       6.6  0.00   3208   5220   6013       5125        3539      3405         0.2    88
200      24.3       5.3  0.00   8098  10984  12465      10302        7497      7629         0.0   148
  board (hit)              n=    880  p50=   262  p95=   750  p99=  1064  max=  1296 ms
  board (miss)             n=   4955  p50=  2835  p95=  9778  p99= 10338  max= 10856 ms
  board (bypass)           n=    284  p50=  4130  p95=  9790  p99= 10061  max= 10740 ms
time="2026-10-17T15:35:45Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50,op:board}, http_req_duration{level:50,op:create}, http_req_duration{level:50,op:move}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 880, misses 4981, errors 724 → hit rate **15.0 %**
- project-service HTTP responses by class: 2xx 21514, 4xx 395
- Outbox: published 4588; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 4588; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 4588; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 4588; retries 0; dead-lettered 0
- activity outcomes: processed 4588
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 50935 commits (67.2/s over 758 s between snapshots), rollbacks 395; tuples returned 13826529, fetched 5815971, inserted 17806, updated 13159, deleted 501; blocks read 17, hit 8836996
- project-service memory at end: RSS 163 MiB, heap used 59 MiB
- api-gateway memory at end: RSS 128 MiB, heap used 32 MiB
- realtime-service memory at end: RSS 121 MiB, heap used 29 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 18.11 4.85 99.78 99.87 100.0 99.97 99.96 99.96 100.0 99.79 100.0 100.0 100.0 |
| ecs/project-service/MemoryUtilization | 35.06 | 21.0 13.77 26.37 29.1 30.37 30.86 31.45 30.76 32.52 31.64 31.35 32.32 33.01 35.06 |
| ecs/api-gateway/CPUUtilization | 51.01 | 6.65 17.73 51.01 48.08 36.6 36.88 33.99 28.6 28.27 30.59 29.82 26.64 26.57 9.27 |
| ecs/api-gateway/MemoryUtilization | 24.9 | 13.67 17.58 18.07 18.16 18.75 18.26 18.55 18.85 19.04 18.75 19.34 19.24 19.14 24.9 |
| ecs/outbox-publisher/CPUUtilization | 29.57 | 4.22 24.93 29.57 28.09 22.14 21.21 25.29 19.15 23.67 19.97 17.56 24.53 20.28 23.37 |
| ecs/outbox-publisher/MemoryUtilization | 25.1 | 12.89 16.99 15.62 20.02 20.8 20.8 21.19 21.29 21.09 20.31 21.29 20.51 21.48 25.1 |
| ecs/activity-service/CPUUtilization | 31.94 | 13.61 25.98 31.94 30.98 23.44 26.56 20.44 20.5 18.35 18.67 18.69 18.13 18.21 13.79 |
| ecs/activity-service/MemoryUtilization | 22.07 | 16.02 22.07 17.09 18.75 18.95 19.04 18.95 19.14 19.14 19.14 19.14 19.14 19.14 19.14 |
| ecs/realtime-service/CPUUtilization | 26.22 | 14.49 24.01 26.22 23.33 19.26 19.82 18.5 17.78 17.9 18.98 16.94 16.72 17.07 14.7 |
| ecs/realtime-service/MemoryUtilization | 23.44 | 17.19 19.34 23.44 18.16 18.16 18.16 18.16 18.16 18.16 18.16 18.16 18.36 18.36 18.36 |
| ecs/cache-invalidator/CPUUtilization | 28.01 | 14.76 27.81 28.01 24.8 20.74 20.78 19.03 18.97 18.54 22.72 18.06 17.78 18.01 16.1 |
| ecs/cache-invalidator/MemoryUtilization | 22.56 | 16.41 22.56 17.29 17.58 17.38 17.38 17.38 17.38 17.48 17.58 17.58 17.58 17.77 17.77 |
| rds/CPUUtilization | 13.34 | 4.2 4.58 9.09 12.48 12.78 12.39 11.53 13.34 12.51 12.89 12.12 12.23 12.91 4.83 |
| rds/DatabaseConnections | 14.0 | 2.0 2.0 12.0 12.0 13.0 12.0 12.0 14.0 12.0 13.0 12.0 13.0 1.0 1.0 |
| rds/ReadIOPS | 7.8 | 0.32 0.13 1.77 0.18 3.7 0.62 1.35 0.1 7.8 0.75 1.3 0.02 |
| rds/WriteIOPS | 61.23 | 9.97 0.6 56.45 51.03 61.23 34.48 33.55 25.38 40.68 24.19 17.89 0.6 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.53 | 0.68 0.7 0.73 1.22 1.45 1.53 1.43 1.42 1.43 1.42 1.42 1.43 1.42 1.22 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
