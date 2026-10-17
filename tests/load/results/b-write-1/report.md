# Load run `b-write-1`

## k6 (load generator view)

```
time="2026-10-17T11:49:32Z" level=info msg="MEASURE_T0=2026-10-17T11:49:32.880Z" source=console

ALL (steady scenario)      n=  27810  p50=   933  p95=  5989  p99=  9053  max= 19396 ms
  unassign                 n=   1445  p50=   658  p95=  5527  p99=  8566  max= 18441 ms
  delete                   n=   1244  p50=  1432  p95=  5883  p99=  8985  max= 15320 ms
  create                   n=   4153  p50=   664  p95=  5313  p99=  8814  max= 16300 ms
  comment                  n=   2874  p50=   693  p95=  5405  p99=  8832  max= 15420 ms
  board                    n=   3054  p50=   948  p95=  6483  p99=  9072  max= 15737 ms
  assign                   n=   2424  p50=   768  p95=  5557  p99=  9009  max= 15424 ms
  update                   n=   6065  p50=   721  p95=  5487  p99=  8833  max= 19396 ms
  move                     n=   6064  p50=   727  p95=  5487  p99=  9072  max= 18904 ms
  activity                 n=   1549  p50=  1326  p95=  7973  p99= 10801  max= 15494 ms
  task                     n=   1784  p50=  1005  p95=  6564  p99=  9077  max= 14535 ms
requests 32207 (49.3/s over 653 s incl. setup), failed 8.45 %
successful writes 22027 (33.7/s)
version conflicts (409) 308
board cache (client view, x-board-cache) hit 454 / miss 2188 = 17.2 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       43.7      32.1  5.97    106   5056   5387       5058        5056      5056        13.7    89
100      54.9      39.1  9.64    685   5097   6433       5114        5057      5094         4.8    83
200      55.9      39.0 12.11   2080   8104   9240       8551        7726      7983        28.7   109
  board (hit)              n=    454  p50=  1338  p95=  4884  p99=  8677  max= 10030 ms
  board (miss)             n=   2188  p50=   853  p95=  5846  p99=  8826  max= 11912 ms
  board (bypass)           n=      2  p50=  4479  p95=  5604  p99=  5704  max=  5729 ms
time="2026-10-17T11:59:50Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50,op:board}, http_req_duration{level:50,op:create}, http_req_duration{level:50,op:move}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_failed, http_req_failed{level:100}, http_req_failed{level:200}, http_req_failed{level:50}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 454, misses 2261, errors 3 → hit rate **16.7 %**
- project-service HTTP responses by class: 2xx 29178, 4xx 310, 5xx 2498
- Outbox: published 20883; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 20885; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 20885; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 20885; retries 0; dead-lettered 0
- activity outcomes: duplicate 2, processed 20883
- realtime hub: duplicate_suppressed 1; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 81173 commits (104.8/s over 775 s between snapshots), rollbacks 321; tuples returned 12668995, fetched 4297672, inserted 72577, updated 56085, deleted 541; blocks read 186957, hit 7577587
- project-service memory at end: RSS 149 MiB, heap used 50 MiB
- api-gateway memory at end: RSS 140 MiB, heap used 29 MiB
- realtime-service memory at end: RSS 119 MiB, heap used 32 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 99.47 | 17.05 8.33 95.7 97.62 93.84 87.72 99.22 89.55 91.09 37.07 79.61 99.47 58.78 |
| ecs/project-service/MemoryUtilization | 29.0 | 16.6 14.84 24.51 26.17 26.66 27.25 27.34 28.22 28.42 28.61 28.52 28.81 29.0 |
| ecs/api-gateway/CPUUtilization | 44.89 | 19.75 3.96 43.38 44.89 44.79 43.93 42.82 43.88 29.72 23.67 41.77 38.56 35.73 13.58 |
| ecs/api-gateway/MemoryUtilization | 28.61 | 15.14 11.72 17.97 17.97 18.85 19.24 19.53 19.82 19.92 19.92 20.61 20.7 21.0 28.61 |
| ecs/outbox-publisher/CPUUtilization | 59.6 | 15.32 32.32 20.13 34.65 53.8 51.67 39.23 59.6 45.61 36.12 48.13 37.62 50.23 21.22 |
| ecs/outbox-publisher/MemoryUtilization | 23.73 | 11.91 17.48 16.41 16.6 19.14 20.9 21.29 21.58 21.97 21.97 23.14 23.73 22.36 22.46 |
| ecs/activity-service/CPUUtilization | 59.77 | 12.95 21.21 27.91 27.0 56.59 48.09 44.11 59.77 47.62 40.81 54.89 33.49 43.93 30.56 |
| ecs/activity-service/MemoryUtilization | 19.14 | 12.7 18.26 15.62 19.04 18.85 18.95 18.95 18.95 18.95 19.04 19.14 19.14 19.14 19.14 |
| ecs/realtime-service/CPUUtilization | 59.81 | 15.56 27.45 35.42 31.08 59.81 47.68 37.44 49.85 42.31 36.91 44.45 34.53 29.74 46.42 |
| ecs/realtime-service/MemoryUtilization | 18.65 | 12.3 18.65 14.16 15.33 17.77 17.97 18.26 18.26 18.36 18.36 18.46 18.55 18.46 18.55 |
| ecs/cache-invalidator/CPUUtilization | 50.88 | 13.5 28.23 21.89 31.06 50.88 39.95 35.52 44.81 36.58 18.43 32.71 31.91 37.96 31.9 |
| ecs/cache-invalidator/MemoryUtilization | 17.87 | 11.52 16.21 13.09 14.65 17.58 17.58 17.58 17.58 17.77 17.68 17.77 17.77 17.77 17.87 |
| rds/CPUUtilization | 36.94 | 4.26 7.13 20.28 33.6 30.77 29.96 28.93 34.61 36.94 33.29 35.5 36.7 29.44 |
| rds/DatabaseConnections | 14.0 | 3.0 2.0 13.0 11.0 12.0 14.0 12.0 14.0 14.0 14.0 13.0 12.0 1.0 3.0 |
| rds/ReadIOPS | 115.66 | 5.01 5.7 115.66 61.26 42.95 47.5 39.92 81.68 43.68 32.46 45.35 29.19 34.23 56.25 |
| rds/WriteIOPS | 157.47 | 0.83 0.74 71.22 82.61 154.17 104.97 114.57 157.47 88.99 75.39 105.29 100.97 56.6 79.61 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.43 | 0.7 0.7 0.68 1.05 1.18 1.32 1.27 1.3 1.43 1.22 1.07 1.15 1.18 0.92 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
