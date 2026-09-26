# Load run `balanced-ladder`

## k6 (load generator view)

```
ALL (steady scenario)      n=  72195  p50=  1316  p95= 17000  p99= 18209  max= 22675 ms
  comment                  n=   1822  p50=   843  p95= 16163  p99= 16722  max= 19476 ms
  projects                 n=   6333  p50=  1205  p95= 17093  p99= 17682  max= 18498 ms
  task                     n=   6869  p50=  1256  p95= 17197  p99= 17724  max= 21787 ms
  unassign                 n=   1196  p50=  1560  p95= 16149  p99= 16559  max= 19970 ms
  board                    n=  22924  p50=  1347  p95= 17338  p99= 17983  max= 22181 ms
  create                   n=   4592  p50=  2283  p95= 16158  p99= 16792  max= 20081 ms
  update                   n=   4374  p50=   810  p95= 16158  p99= 16775  max= 20163 ms
  activity                 n=   6591  p50=  1540  p95= 18451  p99= 19003  max= 22675 ms
  delete                   n=   1596  p50=   374  p95= 16045  p99= 16705  max= 19972 ms
  assign                   n=   1882  p50=   842  p95= 16197  p99= 16818  max= 20072 ms
  move                     n=   4306  p50=   916  p95= 16186  p99= 16806  max= 20165 ms
  workspaces               n=   9710  p50=  1000  p95= 15980  p99= 16572  max= 20150 ms
requests 73746 (65.1/s over 1132 s incl. setup), failed 0.00 %
successful writes 19547 (17.3/s)
version conflicts (409) 221
board cache (client view, x-board-cache) hit 8215 / miss 14669 = 35.9 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
10       20.6       5.1  0.00     30     58    153         55          81        72        61.5    13
50       90.1      24.3  0.00     47    381    718        424         512       426        56.8    73
100      93.2      25.0  0.00    539   1300   1691       1403         958       994        37.8    50
250      74.5      20.6  0.00   2900   4273   4950       4280        3000      3271        22.7    31
500      63.6      17.3  0.00   7539   9037   9662       8946        7693      7815        21.3     8
1000     59.2      16.3  0.00  16457  18416  19235      18097       16956     16873        23.4    46
time="2026-09-26T17:56:43Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:1000,op:board}, http_req_duration{level:1000,op:create}, http_req_duration{level:1000,op:move}, http_req_duration{level:1000}, http_req_duration{level:100}, http_req_duration{level:250,op:board}, http_req_duration{level:250,op:create}, http_req_duration{level:250,op:move}, http_req_duration{level:250}, http_req_duration{level:500,op:board}, http_req_duration{level:500,op:create}, http_req_duration{level:500,op:move}, http_req_duration{level:500}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 8381, misses 14897, errors 67 → hit rate **36.0 %**
- project-service HTTP responses by class: 2xx 74740, 4xx 224
- Outbox: published 18859; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: dead_lettered 2, malformed 2, processed 18932; retries 0; dead-lettered 2
- cache-invalidator consumer messages: malformed 1, processed 18860; retries 0; dead-lettered 0
- realtime-service consumer messages: malformed 1, processed 18860; retries 0; dead-lettered 0
- activity outcomes: processed 18932
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- project-service memory at end: RSS 151 MiB, heap used 46 MiB
- api-gateway memory at end: RSS 168 MiB, heap used 47 MiB
- realtime-service memory at end: RSS 120 MiB, heap used 38 MiB

## CloudWatch (per-minute maxima over the window)

| series                                  | max   | per-minute values                                                                                                                   |
| --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ecs/project-service/CPUUtilization      | 100.0 | 16.9 9.47 90.54 32.4 29.08 97.66 97.08 96.68 99.82 99.99 99.8 99.88 99.62 99.69 99.78 99.8 100.0 99.89 99.56 99.73 99.73 25.54      |
| ecs/project-service/MemoryUtilization   | 36.91 | 14.26 16.89 25.59 26.27 23.83 24.8 25.78 25.98 26.07 26.76 27.25 27.25 27.83 27.93 27.83 28.32 28.32 28.32 28.42 28.52 28.42 36.91  |
| ecs/api-gateway/CPUUtilization          | 57.76 | 13.52 10.23 54.98 37.33 19.51 49.68 54.57 51.05 52.91 51.55 48.31 46.48 48.41 44.76 44.95 42.75 40.16 57.76 40.4 45.4 39.28 14.39   |
| ecs/api-gateway/MemoryUtilization       | 33.4  | 11.04 13.48 17.09 21.97 17.77 17.77 17.97 18.07 18.46 18.95 19.24 20.12 21.09 21.29 22.17 23.54 23.54 24.32 26.56 26.86 27.44 33.4  |
| ecs/outbox-publisher/CPUUtilization     | 52.36 | 18.1 22.49 52.36 36.0 22.65 30.36 29.52 34.02 33.6 28.43 33.62 32.1 31.28 29.4 29.09 26.6 27.77 24.68 27.7 26.62 23.35 21.22        |
| ecs/outbox-publisher/MemoryUtilization  | 24.8  | 12.5 16.02 15.43 19.63 16.99 20.41 21.0 21.19 21.68 21.58 21.58 21.58 21.88 22.66 22.85 22.75 22.36 22.36 23.44 24.02 24.61 24.8    |
| ecs/activity-service/CPUUtilization     | 60.74 | 18.4 25.28 60.74 34.69 20.4 39.62 38.69 36.14 37.24 33.11 37.27 31.65 34.86 29.12 31.39 29.43 28.32 26.55 26.07 27.83 27.14 24.87   |
| ecs/activity-service/MemoryUtilization  | 24.22 | 13.28 14.65 15.62 24.22 18.55 18.85 19.34 18.95 18.95 19.04 19.14 19.14 19.14 19.14 19.14 19.14 19.14 19.14 19.24 19.24 19.24 21.09 |
| ecs/realtime-service/CPUUtilization     | 36.91 | 15.96 23.39 36.91 17.66 36.17 28.2 28.09 27.9 28.95 27.7 25.89 28.43 28.69 23.26 23.59 23.18 21.4 22.31 22.28 22.72 23.77 19.27     |
| ecs/realtime-service/MemoryUtilization  | 22.46 | 12.7 13.87 14.06 14.65 22.46 15.23 15.33 15.43 15.23 17.58 17.58 17.87 18.26 18.26 18.36 18.36 18.36 18.36 18.36 18.36 18.55 18.46  |
| ecs/cache-invalidator/CPUUtilization    | 35.23 | 19.58 25.03 22.68 32.67 23.17 31.15 34.29 33.17 32.79 31.55 35.23 31.33 30.92 29.94 27.25 28.97 27.76 27.21 26.8 27.17 26.79 17.97  |
| ecs/cache-invalidator/MemoryUtilization | 20.7  | 11.62 13.87 13.87 20.7 14.45 14.45 16.8 17.38 17.48 17.58 17.58 17.58 17.68 17.68 17.77 17.77 17.77 17.77 17.77 17.77 17.77 17.77   |
| rds/CPUUtilization                      | 16.34 | 4.9 4.24 7.84 6.87 8.4 10.47 13.12 13.63 13.51 16.34 15.17 13.93 14.23 14.92 14.38 13.8 12.59 12.29 13.06 13.63 12.87 6.56          |
| rds/DatabaseConnections                 | 14.0  | 3.0 3.0 4.0 4.0 5.0 12.0 13.0 14.0 12.0 13.0 13.0 12.0 13.0 12.0 12.0 13.0 12.0 12.0 13.0 12.0 12.0 2.0                             |
| rds/ReadIOPS                            | 7.53  | 0.05 0.07 0.02 1.2 1.3 0.22 0.0 0.05 4.54 3.75 0.1 0.03 0.55 7.53 2.19 0.6 0.17 0.03 4.98 3.47 0.28 0.72                            |
| rds/WriteIOPS                           | 81.45 | 2.98 2.93 44.3 40.77 18.27 29.05 71.97 76.13 81.45 79.34 77.45 68.38 69.88 70.93 58.55 57.39 54.37 49.11 66.04 50.25 51.54 20.53    |
| redis/dpp-dev-001/EngineCPUUtilization  | 1.66  | 0.72 0.72 0.88 0.9 0.95 1.05 1.49 1.57 1.53 1.66 1.65 1.57 1.58 1.54 1.52 1.57 1.55 1.51 1.52 1.57 1.53 0.98                        |
| redis/dpp-dev-001/CurrConnections       | 7.0   | 7.0 6.0 6.0 6.0 6.0 7.0 6.0 6.0 6.0 6.0 6.0 7.0 7.0 6.0 7.0 7.0 7.0 7.0 6.0 6.0 6.0 6.0                                             |
