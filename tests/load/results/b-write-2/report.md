# Load run `b-write-2`

## k6 (load generator view)

```
time="2026-10-17T12:05:31Z" level=info msg="MEASURE_T0=2026-10-17T12:05:31.115Z" source=console

ALL (steady scenario)      n=  29494  p50=   655  p95=  6862  p99=  9096  max= 19424 ms
  delete                   n=   1322  p50=   826  p95=  7780  p99=  9147  max= 19042 ms
  board                    n=   3054  p50=   755  p95=  6678  p99=  9212  max= 16382 ms
  activity                 n=   1488  p50=  1101  p95=  7877  p99= 10880  max= 18509 ms
  unassign                 n=   1549  p50=   558  p95=  7074  p99=  9046  max= 17376 ms
  assign                   n=   2453  p50=   582  p95=  6505  p99=  9022  max= 15283 ms
  comment                  n=   3068  p50=   606  p95=  6692  p99=  9035  max= 19325 ms
  move                     n=   6118  p50=   606  p95=  6697  p99=  9116  max= 19413 ms
  task                     n=   1819  p50=   825  p95=  6351  p99=  9167  max= 19089 ms
  update                   n=   5983  p50=   577  p95=  6863  p99=  9065  max= 19424 ms
  create                   n=   4080  p50=   563  p95=  5995  p99=  9033  max= 19392 ms
requests 32485 (49.8/s over 652 s incl. setup), failed 10.49 %
successful writes 21763 (33.4/s)
version conflicts (409) 305
board cache (client view, x-board-cache) hit 306 / miss 2254 = 12.0 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       51.8      38.9  4.69     61   4658   5108       5026        5034      3862        13.7    92
100      61.5      45.8  5.13    590   5027   5482       5030        5025      5026        15.0    96
200      50.6      30.5 24.41   2010   8960  10088       9036        8904      8966         1.2   110
  board (hit)              n=    306  p50=   284  p95=  1426  p99=  5023  max=  6427 ms
  board (miss)             n=   2254  p50=   753  p95=  3960  p99=  7666  max= 11501 ms
time="2026-10-17T12:15:51Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50,op:board}, http_req_duration{level:50,op:create}, http_req_duration{level:50,op:move}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_failed, http_req_failed{level:100}, http_req_failed{level:200}, http_req_failed{level:50}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 306, misses 2353, errors 5 → hit rate **11.5 %**
- project-service HTTP responses by class: 2xx 28803, 4xx 308, 5xx 3205
- Outbox: published 20623; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 20626; retries 1; dead-lettered 0
- cache-invalidator consumer messages: processed 20626; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 20626; retries 0; dead-lettered 0
- activity outcomes: duplicate 3, failed 1, processed 20623
- realtime hub: duplicate_suppressed 3; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 80278 commits (103.2/s over 778 s between snapshots), rollbacks 329; tuples returned 14056978, fetched 5610210, inserted 71733, updated 55298, deleted 537; blocks read 294793, hit 7790511
- project-service memory at end: RSS 145 MiB, heap used 34 MiB
- api-gateway memory at end: RSS 139 MiB, heap used 35 MiB
- realtime-service memory at end: RSS 118 MiB, heap used 28 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 99.69 | 23.4 9.22 63.51 90.96 93.93 95.22 96.54 99.69 71.94 84.9 95.89 93.6 46.89 24.08 |
| ecs/project-service/MemoryUtilization | 35.84 | 23.63 19.82 29.1 28.61 29.0 31.35 30.08 29.88 29.98 29.98 30.18 30.66 30.76 35.84 |
| ecs/api-gateway/CPUUtilization | 50.34 | 24.65 5.48 43.24 50.1 41.25 45.51 46.05 50.34 39.42 29.73 41.44 35.73 25.11 22.27 |
| ecs/api-gateway/MemoryUtilization | 27.73 | 16.89 13.38 18.36 18.95 19.53 19.63 19.73 19.92 20.12 20.31 20.7 21.0 20.9 27.73 |
| ecs/outbox-publisher/CPUUtilization | 66.89 | 15.8 36.42 19.1 44.5 32.73 56.41 55.79 66.89 64.56 54.49 48.99 48.2 48.54 21.74 |
| ecs/outbox-publisher/MemoryUtilization | 24.41 | 20.7 24.41 22.95 22.36 22.07 22.36 22.95 22.85 23.05 23.83 23.54 23.14 23.54 23.14 |
| ecs/activity-service/CPUUtilization | 71.79 | 12.4 18.61 16.26 29.94 20.72 50.39 41.91 71.79 53.31 44.36 31.66 46.69 47.56 13.42 |
| ecs/activity-service/MemoryUtilization | 24.8 | 19.34 24.8 19.53 19.53 19.53 19.24 19.14 19.24 19.14 19.34 19.34 19.14 19.24 19.14 |
| ecs/realtime-service/CPUUtilization | 51.64 | 15.88 23.48 24.37 35.83 32.94 44.1 38.71 51.64 43.41 42.97 32.16 39.25 44.92 15.3 |
| ecs/realtime-service/MemoryUtilization | 25.78 | 18.75 25.78 19.43 19.24 18.85 18.85 18.75 18.75 18.75 18.65 18.65 18.75 18.75 18.75 |
| ecs/cache-invalidator/CPUUtilization | 62.34 | 13.06 21.37 18.89 33.7 32.62 40.24 40.84 31.53 62.34 41.86 39.33 37.54 36.74 13.91 |
| ecs/cache-invalidator/MemoryUtilization | 23.05 | 18.75 23.05 18.65 18.65 18.16 17.97 17.87 17.97 17.87 17.87 17.97 17.97 17.97 17.97 |
| rds/CPUUtilization | 41.5 | 4.51 7.78 26.78 38.71 35.11 30.44 27.5 41.5 37.1 31.58 30.32 37.19 34.02 |
| rds/DatabaseConnections | 14.0 | 3.0 4.0 12.0 14.0 14.0 12.0 14.0 12.0 12.0 12.0 14.0 14.0 13.0 3.0 |
| rds/ReadIOPS | 146.41 | 19.4 22.89 146.41 65.78 87.98 101.98 106.79 78.69 78.69 83.68 66.93 88.1 58.93 115.79 |
| rds/WriteIOPS | 159.07 | 7.0 15.88 80.0 64.95 118.93 159.07 106.84 144.85 130.39 149.62 53.27 128.22 69.6 9.74 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.53 | 0.7 0.7 0.73 0.97 1.02 1.28 1.42 1.07 1.53 1.35 1.35 1.03 1.18 1.0 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
