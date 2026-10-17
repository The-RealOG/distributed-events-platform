# Load run `b-hot-2`

## k6 (load generator view)

```
time="2026-10-17T12:49:54Z" level=info msg="MEASURE_T0=2026-10-17T12:49:54.219Z" source=console

ALL (steady scenario)      n=  17408  p50=  1724  p95=  9232  p99= 12778  max= 19979 ms
  assign                   n=    528  p50=  1598  p95=  7779  p99= 11016  max= 17858 ms
  projects                 n=   1723  p50=   804  p95=  8834  p99= 12405  max= 13676 ms
  delete                   n=    197  p50=  1343  p95=  7981  p99= 10023  max= 17693 ms
  activity                 n=   1902  p50=  1341  p95= 11781  p99= 16375  max= 19979 ms
  task                     n=   3293  p50=  1139  p95=  9154  p99= 12659  max= 18225 ms
  comment                  n=    536  p50=  1241  p95=  8046  p99= 10639  max= 18896 ms
  update                   n=   1222  p50=   982  p95=  7428  p99=  9376  max= 18305 ms
  board                    n=   6552  p50=   992  p95=  9184  p99= 11901  max= 18399 ms
  workspaces               n=   2899  p50=   606  p95=  7463  p99=  8680  max= 18343 ms
  unassign                 n=    394  p50=  1248  p95=  7886  p99=  8559  max=  9927 ms
  create                   n=   1519  p50=  1058  p95=  7742  p99= 10289  max= 18042 ms
  move                     n=   1128  p50=  1052  p95=  7600  p99=  9697  max= 19075 ms
requests 23026 (36.5/s over 631 s incl. setup), failed 13.20 %
successful writes 4607 (7.3/s)
version conflicts (409) 336
board cache (client view, x-board-cache) hit 1074 / miss 4106 = 20.7 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       41.3       9.7  0.00    703   1652   2970       1730        1624      1603        19.1   126
100      27.1       6.0  8.66   3199   6467   8496       7256        5300      5117         0.0    80
200      28.4       3.5 51.29   7256  11753  15751      11029       10161      9693         8.3    86
  board (hit)              n=   1074  p50=   212  p95=  2362  p99=  8552  max=  9044 ms
  board (miss)             n=   4106  p50=  1312  p95=  9204  p99= 10714  max= 18399 ms
  board (bypass)           n=    148  p50=  3798  p95=  9636  p99= 10228  max= 10364 ms
time="2026-10-17T13:00:14Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50,op:board}, http_req_duration{level:50,op:create}, http_req_duration{level:50,op:move}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}, http_req_failed, http_req_failed{level:100}, http_req_failed{level:200}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 1075, misses 6857, errors 1006 → hit rate **13.6 %**
- project-service HTTP responses by class: 2xx 29120, 4xx 561, 5xx 2227
- Outbox: published 0; failures 0; pending after None; oldest pending age after None s
- activity-service consumer messages: processed 5971; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 6006; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 5905; retries 0; dead-lettered 0
- activity outcomes: duplicate 0, failed 0, processed 5971
- realtime hub: duplicate_suppressed 0; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- activity-service DB pool at end: total 1, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 63549 commits (61.7/s over 1030 s between snapshots), rollbacks 556; tuples returned 26238751, fetched 8030544, inserted 21713, updated 15045, deleted 89; blocks read 716855, hit 15151143
- project-service memory at end: RSS 142 MiB, heap used 34 MiB
- api-gateway memory at end: RSS 137 MiB, heap used 31 MiB
- realtime-service memory at end: RSS 116 MiB, heap used 30 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 99.56 99.92 100.0 99.94 100.0 99.99 99.79 98.53 99.95 99.7 99.82 99.98 99.92 99.42 100.0 99.85 48.96 21.23 |
| ecs/project-service/MemoryUtilization | 43.65 | 43.65 36.72 38.28 38.57 37.6 38.28 37.99 36.23 37.6 37.3 37.7 38.28 36.43 36.82 37.11 36.72 33.69 40.14 |
| ecs/api-gateway/CPUUtilization | 45.49 | 44.07 29.82 27.82 29.33 28.33 28.67 43.12 45.49 34.85 31.09 32.95 28.72 28.47 28.1 25.29 24.19 16.95 17.12 |
| ecs/api-gateway/MemoryUtilization | 26.46 | 26.46 20.7 20.51 20.8 20.41 20.12 19.92 20.21 20.7 20.41 20.41 20.51 20.61 21.09 20.9 20.8 20.8 23.73 |
| ecs/outbox-publisher/CPUUtilization | 38.36 | 21.64 38.36 24.07 25.42 22.87 24.73 19.07 32.36 25.83 25.11 28.3 23.16 25.46 26.36 22.18 24.12 19.34 17.12 |
| ecs/outbox-publisher/MemoryUtilization | 26.27 | 21.39 26.27 23.63 23.93 23.24 23.73 23.05 23.54 23.14 23.63 23.24 23.24 24.02 23.73 23.24 23.83 24.02 23.34 |
| ecs/activity-service/CPUUtilization | 28.55 | 18.46 25.46 21.12 15.91 17.49 15.89 15.12 28.55 20.33 18.32 18.55 21.28 16.25 16.18 16.18 14.87 12.07 12.26 |
| ecs/activity-service/MemoryUtilization | 24.61 | 19.73 24.61 20.12 19.73 19.53 19.53 19.53 19.53 19.63 19.73 19.73 19.73 19.82 19.92 19.92 19.92 19.92 19.92 |
| ecs/realtime-service/CPUUtilization | 27.23 | 18.66 27.23 18.34 18.03 18.51 17.34 16.82 26.31 20.08 19.53 21.86 20.31 17.45 17.54 16.84 16.89 14.98 15.36 |
| ecs/realtime-service/MemoryUtilization | 24.9 | 19.34 24.9 19.53 19.73 19.34 19.34 19.34 19.53 19.53 19.53 19.53 18.95 18.95 19.14 19.14 19.14 19.14 19.14 |
| ecs/cache-invalidator/CPUUtilization | 28.2 | 16.75 28.2 15.8 16.22 15.69 15.68 14.86 20.14 18.97 17.46 16.69 19.02 15.67 15.8 15.26 15.45 13.12 13.36 |
| ecs/cache-invalidator/MemoryUtilization | 21.97 | 18.36 21.97 18.46 18.46 18.16 18.16 18.16 18.36 18.36 18.36 18.36 18.07 18.16 18.26 18.36 17.97 17.97 17.97 |
| rds/CPUUtilization | 29.32 | 12.3 17.88 16.38 17.23 22.12 16.26 16.55 29.32 24.86 25.35 24.37 24.81 22.32 26.36 28.97 24.92 4.74 8.88 |
| rds/DatabaseConnections | 14.0 | 14.0 12.0 14.0 12.0 14.0 12.0 14.0 12.0 12.0 14.0 12.0 14.0 13.0 14.0 14.0 0.0 |
| rds/ReadIOPS | 216.99 | 157.52 87.63 156.03 106.18 216.99 110.55 172.65 189.83 166.95 186.96 128.1 105.24 154.58 102.24 95.68 38.03 |
| rds/WriteIOPS | 111.34 | 47.87 49.24 44.56 28.67 28.05 25.47 41.61 111.34 52.37 57.58 43.5 30.14 45.1 35.77 35.62 26.05 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.58 | 1.58 1.35 1.53 1.48 1.42 1.4 1.48 1.27 1.52 1.53 1.55 1.4 1.38 1.37 1.35 1.4 1.15 0.75 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
