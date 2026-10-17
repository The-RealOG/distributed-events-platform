# Load run `o-cur-8175-1`

## k6 (load generator view)

```
time="2026-10-17T10:10:38Z" level=info msg="MEASURE_T0=2026-10-17T10:10:38.363Z" source=console

ALL (steady scenario)      n=  42665  p50=   567  p95=  3181  p99=  4944  max= 11918 ms
  board                    n=  14913  p50=   492  p95=  3065  p99=  5057  max= 10327 ms
  comment                  n=   1242  p50=   502  p95=  2289  p99=  4917  max=  6906 ms
  activity                 n=   4202  p50=   780  p95=  4260  p99=  6293  max= 11918 ms
  delete                   n=    548  p50=   529  p95=  2282  p99=  4496  max= 11119 ms
  projects                 n=   4263  p50=   513  p95=  2914  p99=  3647  max=  7007 ms
  task                     n=   4356  p50=   550  p95=  3059  p99=  5128  max=  9847 ms
  assign                   n=   1256  p50=   566  p95=  2305  p99=  4282  max=  6487 ms
  unassign                 n=    808  p50=   464  p95=  2090  p99=  2622  max=  5370 ms
  workspaces               n=   6406  p50=   338  p95=  1945  p99=  3622  max=  6001 ms
  create                   n=   2918  p50=   498  p95=  2162  p99=  4200  max= 10050 ms
  move                     n=   2907  p50=   587  p95=  2341  p99=  5056  max= 11381 ms
  update                   n=   2964  p50=   494  p95=  2165  p99=  4191  max=  6830 ms
requests 48334 (73.8/s over 655 s incl. setup), failed 0.65 %
successful writes 12472 (19.0/s)
version conflicts (409) 141
board cache (client view, x-board-cache) hit 6558 / miss 8140 = 44.6 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       84.0      22.0  0.00     90    425    698        426         487       497        58.0    56
100      83.2      22.1  1.54    608   1495   5037       1514        1176      1381        43.4    35
200      69.9      19.1  0.00   2368   3931   5932       3626        2613      2808        25.9    43
  board (hit)              n=   6558  p50=   273  p95=  1875  p99=  2521  max= 10327 ms
  board (miss)             n=   8140  p50=   838  p95=  3265  p99=  5166  max=  7283 ms
  board (bypass)           n=     29  p50=  2614  p95=  4733  p99=  5759  max=  5794 ms
time="2026-10-17T10:20:56Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}, http_req_failed{level:100}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 6558, misses 8164, errors 48 → hit rate **44.5 %**
- project-service HTTP responses by class: 2xx 47881, 4xx 141, 5xx 130
- Outbox: published 11962; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 11962; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 11962; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 11962; retries 0; dead-lettered 0
- activity outcomes: processed 11962
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 101442 commits (130.6/s over 777 s between snapshots), rollbacks 142; tuples returned 11428742, fetched 2965800, inserted 42794, updated 31633, deleted 374; blocks read 0, hit 6019691
- project-service memory at end: RSS 149 MiB, heap used 48 MiB
- api-gateway memory at end: RSS 131 MiB, heap used 38 MiB
- realtime-service memory at end: RSS 115 MiB, heap used 31 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 20.15 4.0 95.02 100.0 98.3 97.27 97.39 99.7 100.0 100.0 99.62 99.98 99.83 59.12 |
| ecs/project-service/MemoryUtilization | 35.84 | 16.7 12.3 24.12 26.66 26.95 26.95 27.15 28.42 28.81 29.0 29.1 29.49 29.59 35.84 |
| ecs/api-gateway/CPUUtilization | 51.09 | 9.44 3.98 49.98 48.86 51.09 50.64 48.7 46.25 51.08 47.31 43.74 43.37 42.03 21.6 |
| ecs/api-gateway/MemoryUtilization | 28.12 | 17.58 12.11 18.65 18.85 19.14 19.24 19.34 19.34 19.63 19.73 20.8 21.39 21.48 28.12 |
| ecs/outbox-publisher/CPUUtilization | 39.01 | 21.12 23.03 28.61 30.71 34.82 31.47 32.2 39.01 31.24 33.24 29.27 30.78 33.63 18.87 |
| ecs/outbox-publisher/MemoryUtilization | 28.22 | 23.24 28.22 24.8 24.9 24.61 24.32 24.41 24.61 24.71 25.2 24.8 24.32 24.12 24.41 |
| ecs/activity-service/CPUUtilization | 38.15 | 15.45 21.57 38.15 30.47 34.04 29.2 30.64 34.4 30.7 30.77 27.38 28.68 29.09 26.79 |
| ecs/activity-service/MemoryUtilization | 27.64 | 20.7 27.64 21.39 21.39 20.9 20.9 20.9 20.9 20.7 20.7 20.8 20.8 20.9 20.9 |
| ecs/realtime-service/CPUUtilization | 26.92 | 16.31 25.99 26.92 21.04 23.26 22.83 22.85 25.42 23.49 23.32 24.2 21.8 21.19 15.48 |
| ecs/realtime-service/MemoryUtilization | 26.37 | 19.53 26.37 20.41 20.51 20.41 20.8 19.92 19.73 19.92 20.21 20.41 19.73 20.02 20.12 |
| ecs/cache-invalidator/CPUUtilization | 30.83 | 16.02 30.83 28.11 23.99 26.12 25.62 26.69 27.23 27.56 23.7 23.21 24.6 24.08 18.09 |
| ecs/cache-invalidator/MemoryUtilization | 24.41 | 19.34 24.41 20.12 20.41 20.51 21.09 20.31 19.53 19.53 19.53 19.63 19.82 20.12 19.34 |
| rds/CPUUtilization | 29.35 | 4.59 5.55 12.76 21.16 21.49 15.08 18.15 24.23 21.6 25.46 22.1 29.35 26.7 |
| rds/DatabaseConnections | 14.0 | 3.0 1.0 13.0 12.0 12.0 13.0 12.0 14.0 14.0 12.0 14.0 12.0 12.0 2.0 |
| rds/ReadIOPS | 29.25 | 3.08 3.77 21.48 12.08 13.28 9.07 10.88 24.5 18.0 12.96 17.4 29.25 5.71 |
| rds/WriteIOPS | 76.4 | 1.95 2.97 73.72 60.77 76.4 72.01 70.9 74.99 75.02 62.81 65.84 68.25 2.2 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.6 | 0.72 0.7 0.7 1.15 1.3 1.5 1.53 1.5 1.48 1.6 1.58 1.52 1.55 1.38 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
