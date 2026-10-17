# Load run `o-pre-8175-2`

## k6 (load generator view)

```
time="2026-10-17T11:07:37Z" level=info msg="MEASURE_T0=2026-10-17T11:07:37.017Z" source=console

ALL (steady scenario)      n=  35539  p50=   801  p95=  4093  p99=  5087  max=  6456 ms
  activity                 n=   3520  p50=  1197  p95=  5357  p99=  6062  max=  6456 ms
  workspaces               n=   5664  p50=   437  p95=  2544  p99=  3197  max=  5079 ms
  unassign                 n=    692  p50=   518  p95=  2751  p99=  3413  max=  4114 ms
  update                   n=   2409  p50=   612  p95=  2692  p99=  3392  max=  4947 ms
  projects                 n=   3737  p50=   728  p95=  3801  p99=  4577  max=  5796 ms
  board                    n=  12625  p50=   736  p95=  4085  p99=  4845  max=  5895 ms
  delete                   n=    506  p50=   587  p95=  2741  p99=  3158  max=  5292 ms
  task                     n=   3679  p50=   783  p95=  3890  p99=  4644  max=  5740 ms
  move                     n=   2404  p50=   669  p95=  2908  p99=  3529  max=  5329 ms
  assign                   n=   1054  p50=   646  p95=  2831  p99=  3476  max=  5210 ms
  create                   n=   2639  p50=   608  p95=  2776  p99=  3473  max=  5390 ms
  comment                  n=   1098  p50=   646  p95=  2905  p99=  3663  max=  5348 ms
requests 41578 (63.8/s over 652 s incl. setup), failed 0.00 %
successful writes 10671 (16.4/s)
version conflicts (409) 131
board cache (client view, x-board-cache) hit 5162 / miss 7444 = 40.9 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       76.1      20.3  0.00    134    632    921        712         651       662        53.8    48
100      64.7      17.2  0.00    963   2167   3528       2303        1458      1617        35.8    23
200      56.6      14.9  0.00   3117   4816   5614       4697        3238      3292        24.5    49
  board (hit)              n=   5162  p50=   255  p95=  2416  p99=  3057  max=  5030 ms
  board (miss)             n=   7444  p50=  1336  p95=  4340  p99=  5027  max=  5895 ms
  board (bypass)           n=     19  p50=  1830  p95=  3874  p99=  4771  max=  4995 ms
time="2026-10-17T11:17:55Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 5162, misses 7464, errors 27 → hit rate **40.9 %**
- project-service HTTP responses by class: 2xx 41447, 4xx 131
- Outbox: published 10311; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 10311; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 10311; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 10311; retries 0; dead-lettered 0
- activity outcomes: processed 10311
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 88324 commits (114.7/s over 770 s between snapshots), rollbacks 133; tuples returned 14020394, fetched 2442197, inserted 37224, updated 26986, deleted 273; blocks read 8483, hit 6151699
- project-service memory at end: RSS 146 MiB, heap used 31 MiB
- api-gateway memory at end: RSS 140 MiB, heap used 30 MiB
- realtime-service memory at end: RSS 119 MiB, heap used 33 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 25.6 8.75 99.13 96.27 98.74 99.9 99.13 94.91 100.0 98.8 99.52 99.56 99.7 |
| ecs/project-service/MemoryUtilization | 31.05 | 24.8 18.07 29.88 29.98 30.08 30.47 30.96 30.27 30.57 30.37 30.86 31.05 30.96 |
| ecs/api-gateway/CPUUtilization | 48.35 | 7.98 12.23 38.51 41.39 48.35 43.09 40.86 37.04 34.16 35.24 30.71 33.06 32.25 |
| ecs/api-gateway/MemoryUtilization | 24.8 | 12.21 17.97 18.26 18.55 18.75 18.85 18.75 19.82 19.92 20.12 20.8 21.29 21.19 24.8 |
| ecs/outbox-publisher/CPUUtilization | 31.29 | 13.75 30.33 30.32 27.08 31.29 22.86 26.67 29.3 22.91 28.13 26.02 25.98 25.02 20.12 |
| ecs/outbox-publisher/MemoryUtilization | 24.51 | 19.82 24.51 21.58 21.78 21.58 22.46 22.07 21.78 21.68 21.97 22.07 22.17 22.46 22.46 |
| ecs/activity-service/CPUUtilization | 36.28 | 15.37 20.78 36.28 33.04 32.25 31.89 30.73 29.34 28.78 28.47 24.47 29.03 27.48 16.03 |
| ecs/activity-service/MemoryUtilization | 25.88 | 19.53 25.88 19.53 19.53 19.24 19.34 19.34 19.14 19.14 19.14 19.14 19.14 19.14 19.14 |
| ecs/realtime-service/CPUUtilization | 36.02 | 13.75 36.02 34.82 21.72 23.61 21.42 23.08 22.2 21.6 20.36 20.6 21.12 19.05 15.55 |
| ecs/realtime-service/MemoryUtilization | 23.14 | 18.95 23.14 21.78 19.24 18.85 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.55 18.75 |
| ecs/cache-invalidator/CPUUtilization | 30.71 | 15.52 30.71 24.5 24.53 27.23 23.87 22.5 24.2 22.8 22.93 20.86 22.15 20.91 15.13 |
| ecs/cache-invalidator/MemoryUtilization | 21.48 | 18.16 21.48 18.26 18.36 17.97 17.97 17.87 17.97 17.97 17.97 17.97 17.97 17.97 17.97 |
| rds/CPUUtilization | 34.67 | 5.34 6.02 14.33 26.75 22.42 34.67 32.87 24.93 25.39 23.84 28.41 32.45 25.67 |
| rds/DatabaseConnections | 14.0 | 3.0 2.0 14.0 12.0 14.0 12.0 12.0 12.0 14.0 14.0 3.0 |
| rds/ReadIOPS | 32.03 | 14.84 6.42 16.98 13.42 32.03 15.92 14.17 24.53 20.21 11.61 |
| rds/WriteIOPS | 70.81 | 14.11 2.85 62.27 64.01 68.46 70.81 60.78 63.08 55.74 2.32 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.47 | 0.72 0.7 0.7 1.13 1.38 1.43 1.43 1.37 1.47 1.4 1.42 1.42 1.38 1.27 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
