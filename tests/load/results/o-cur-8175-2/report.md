# Load run `o-cur-8175-2`

## k6 (load generator view)

```
time="2026-10-17T10:26:28Z" level=info msg="MEASURE_T0=2026-10-17T10:26:28.648Z" source=console

ALL (steady scenario)      n=  43603  p50=   605  p95=  3007  p99=  3785  max=  5550 ms
  move                     n=   3068  p50=   584  p95=  2239  p99=  2714  max=  3635 ms
  delete                   n=    650  p50=   528  p95=  2219  p99=  2582  max=  3299 ms
  update                   n=   3078  p50=   496  p95=  2092  p99=  2444  max=  3439 ms
  board                    n=  15347  p50=   514  p95=  2968  p99=  3486  max=  4562 ms
  activity                 n=   4408  p50=   835  p95=  3979  p99=  4425  max=  5550 ms
  task                     n=   4578  p50=   605  p95=  2932  p99=  3398  max=  4437 ms
  projects                 n=   4300  p50=   594  p95=  2911  p99=  3414  max=  4440 ms
  comment                  n=   1289  p50=   491  p95=  2144  p99=  2735  max=  3664 ms
  create                   n=   3082  p50=   489  p95=  2082  p99=  2560  max=  3534 ms
  unassign                 n=    886  p50=   477  p95=  2056  p99=  2330  max=  2658 ms
  assign                   n=   1298  p50=   570  p95=  2175  p99=  2701  max=  3556 ms
  workspaces               n=   6497  p50=   345  p95=  1898  p99=  2383  max=  3192 ms
requests 50032 (77.9/s over 642 s incl. setup), failed 0.00 %
successful writes 13209 (20.6/s)
version conflicts (409) 142
board cache (client view, x-board-cache) hit 6602 / miss 8714 = 43.1 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       84.9      23.2  0.00     67    419   1052        397         488       584        56.2    42
100      85.8      22.9  0.00    648   1357   1662       1379        1038      1091        41.7    48
200      71.6      19.4  0.00   2368   3631   4222       3393        2522      2628        24.7    45
  board (hit)              n=   6602  p50=   250  p95=  1793  p99=  2192  max=  3248 ms
  board (miss)             n=   8714  p50=   894  p95=  3149  p99=  3668  max=  4562 ms
  board (bypass)           n=     31  p50=  2456  p95=  3066  p99=  3326  max=  3381 ms
time="2026-10-17T10:36:46Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 6602, misses 8734, errors 45 → hit rate **43.0 %**
- project-service HTTP responses by class: 2xx 49890, 4xx 142, 5xx 0
- Outbox: published 12629; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 12629; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 12629; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 12629; retries 0; dead-lettered 0
- activity outcomes: processed 12629
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 106138 commits (139.7/s over 760 s between snapshots), rollbacks 146; tuples returned 12791148, fetched 3306957, inserted 45041, updated 33367, deleted 346; blocks read 175, hit 6912834
- project-service memory at end: RSS 145 MiB, heap used 33 MiB
- api-gateway memory at end: RSS 132 MiB, heap used 31 MiB
- realtime-service memory at end: RSS 116 MiB, heap used 32 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 99.94 | 29.77 12.55 99.36 97.91 97.45 97.62 99.4 99.89 99.83 99.35 99.72 99.94 99.8 |
| ecs/project-service/MemoryUtilization | 31.64 | 25.59 22.95 28.52 29.79 29.98 30.47 29.88 29.39 30.47 30.08 31.25 31.64 31.15 |
| ecs/api-gateway/CPUUtilization | 53.08 | 10.42 12.22 44.43 49.63 53.08 50.3 50.45 50.19 44.46 46.09 44.17 40.89 43.36 |
| ecs/api-gateway/MemoryUtilization | 21.97 | 13.77 18.55 19.34 19.34 19.34 19.43 19.53 19.43 19.82 20.12 21.09 21.58 21.97 |
| ecs/outbox-publisher/CPUUtilization | 35.83 | 16.83 34.88 33.93 30.74 31.46 35.83 27.75 34.63 35.23 30.14 28.4 33.61 30.54 |
| ecs/outbox-publisher/MemoryUtilization | 25.78 | 22.56 25.78 25.0 24.61 25.0 23.83 25.1 24.41 24.51 24.51 24.8 24.61 24.32 |
| ecs/activity-service/CPUUtilization | 36.4 | 14.96 30.39 36.4 31.53 31.61 30.27 35.1 32.61 30.67 30.14 28.28 32.93 26.45 |
| ecs/activity-service/MemoryUtilization | 24.9 | 21.29 24.9 21.29 21.19 20.9 20.9 20.8 20.9 20.9 20.8 20.9 20.9 20.9 |
| ecs/realtime-service/CPUUtilization | 36.17 | 14.41 36.17 22.0 24.13 23.27 23.27 23.87 24.44 26.12 24.03 21.95 22.4 22.51 14.33 |
| ecs/realtime-service/MemoryUtilization | 25.78 | 20.31 25.78 22.56 20.31 20.51 20.7 20.51 20.7 20.8 20.21 20.41 20.7 20.9 20.31 |
| ecs/cache-invalidator/CPUUtilization | 28.27 | 15.05 20.58 21.45 26.17 28.27 26.98 26.33 25.46 26.45 25.68 23.03 23.57 24.5 15.32 |
| ecs/cache-invalidator/MemoryUtilization | 25.39 | 19.92 25.39 19.73 19.92 19.92 19.92 19.92 19.92 19.92 19.92 19.92 20.12 20.12 20.12 |
| rds/CPUUtilization | 35.92 | 4.66 5.9 13.61 24.99 25.79 24.43 28.17 26.17 25.05 35.92 25.79 25.53 22.42 |
| rds/DatabaseConnections | 14.0 | 1.0 2.0 12.0 14.0 12.0 12.0 13.0 12.0 14.0 12.0 2.0 1.0 |
| rds/ReadIOPS | 31.1 | 2.33 13.98 11.03 15.74 15.04 16.78 31.1 18.47 15.57 25.27 18.59 5.11 |
| rds/WriteIOPS | 84.01 | 0.4 9.36 78.77 83.05 77.02 79.03 84.01 83.31 66.59 77.98 51.32 4.11 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.65 | 0.72 0.73 0.7 1.27 1.42 1.52 1.52 1.55 1.65 1.63 1.55 1.6 1.6 1.23 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
