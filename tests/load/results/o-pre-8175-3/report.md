# Load run `o-pre-8175-3`

## k6 (load generator view)

```
time="2026-10-17T11:23:34Z" level=info msg="MEASURE_T0=2026-10-17T11:23:34.659Z" source=console

ALL (steady scenario)      n=  35195  p50=   771  p95=  4329  p99=  5709  max=  9467 ms
  task                     n=   3738  p50=   736  p95=  4171  p99=  5330  max=  7887 ms
  workspaces               n=   5225  p50=   448  p95=  2666  p99=  3640  max=  6202 ms
  delete                   n=    465  p50=   559  p95=  3001  p99=  4319  max=  6114 ms
  move                     n=   2418  p50=   686  p95=  3034  p99=  4004  max=  6487 ms
  activity                 n=   3633  p50=  1027  p95=  5645  p99=  6831  max=  9467 ms
  create                   n=   2530  p50=   599  p95=  2877  p99=  3983  max=  6678 ms
  board                    n=  12465  p50=   746  p95=  4387  p99=  5506  max=  8226 ms
  assign                   n=   1081  p50=   639  p95=  2951  p99=  3649  max=  6394 ms
  unassign                 n=    724  p50=   604  p95=  2846  p99=  4041  max=  5800 ms
  update                   n=   2420  p50=   608  p95=  2877  p99=  3956  max=  6309 ms
  comment                  n=   1008  p50=   649  p95=  2941  p99=  3856  max=  6411 ms
  projects                 n=   3418  p50=   709  p95=  4090  p99=  5080  max=  7719 ms
requests 40676 (62.1/s over 655 s incl. setup), failed 0.45 %
successful writes 10513 (16.1/s)
version conflicts (409) 119
board cache (client view, x-board-cache) hit 5000 / miss 7338 = 40.5 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       74.1      19.6  0.00    142    653    950        754         654       717        54.6    42
100      67.9      18.4  1.31    910   1942   2987       2020        1425      1435        36.7    34
200      53.5      14.4  0.26   3212   5373   7392       5183        3783      3659        21.8    35
  board (hit)              n=   5000  p50=   269  p95=  2480  p99=  3146  max=  6110 ms
  board (miss)             n=   7338  p50=  1332  p95=  4626  p99=  5721  max=  8226 ms
  board (bypass)           n=     18  p50=  3272  p95=  4598  p99=  5196  max=  5346 ms
time="2026-10-17T11:33:53Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}, http_req_failed{level:100}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 5000, misses 7371, errors 27 → hit rate **40.4 %**
- project-service HTTP responses by class: 2xx 40372, 4xx 119, 5xx 77
- Outbox: published 10087; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 10087; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 10087; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 10087; retries 0; dead-lettered 0
- activity outcomes: processed 10087
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 86556 commits (110.5/s over 784 s between snapshots), rollbacks 126; tuples returned 14354054, fetched 2674681, inserted 36344, updated 26495, deleted 252; blocks read 6849, hit 5786752
- project-service memory at end: RSS 144 MiB, heap used 47 MiB
- api-gateway memory at end: RSS 137 MiB, heap used 32 MiB
- realtime-service memory at end: RSS 118 MiB, heap used 35 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 99.95 | 21.51 11.88 99.55 98.13 99.27 99.38 99.19 99.25 99.77 98.88 99.95 99.55 99.41 24.68 |
| ecs/project-service/MemoryUtilization | 35.16 | 25.88 21.19 30.27 31.25 30.86 31.15 30.27 30.08 30.37 30.37 30.66 30.96 31.15 35.16 |
| ecs/api-gateway/CPUUtilization | 39.87 | 16.51 8.91 37.9 38.48 39.87 37.92 39.21 36.59 36.69 34.31 30.75 28.53 34.04 11.22 |
| ecs/api-gateway/MemoryUtilization | 22.66 | 14.94 14.94 18.07 18.55 18.75 18.75 18.65 18.95 19.43 19.63 20.12 20.7 20.61 22.66 |
| ecs/outbox-publisher/CPUUtilization | 28.7 | 17.68 20.32 28.7 23.25 26.96 24.91 27.59 26.55 27.88 24.61 25.01 23.71 24.98 15.71 |
| ecs/outbox-publisher/MemoryUtilization | 26.56 | 21.97 26.56 22.85 22.27 21.58 22.36 22.17 22.27 22.46 22.46 22.56 22.66 22.17 22.46 |
| ecs/activity-service/CPUUtilization | 32.75 | 15.84 31.54 29.91 30.81 32.75 28.16 28.33 27.76 29.86 26.99 26.06 26.38 26.72 15.73 |
| ecs/activity-service/MemoryUtilization | 22.56 | 19.92 22.56 19.92 19.82 19.43 19.34 19.24 19.34 19.34 19.34 19.34 19.34 19.34 19.14 |
| ecs/realtime-service/CPUUtilization | 25.15 | 13.77 25.15 24.18 24.27 21.38 21.63 21.59 21.59 20.52 20.51 21.6 19.19 19.4 14.09 |
| ecs/realtime-service/MemoryUtilization | 26.46 | 19.14 26.46 19.34 19.53 19.04 19.14 18.75 18.65 18.65 18.65 18.65 18.55 18.75 18.75 |
| ecs/cache-invalidator/CPUUtilization | 24.75 | 15.13 19.76 21.56 22.99 22.61 22.92 22.72 22.36 24.75 21.55 21.03 20.96 21.06 15.24 |
| ecs/cache-invalidator/MemoryUtilization | 24.8 | 18.46 24.8 18.36 18.55 18.26 18.16 17.97 17.97 17.97 17.97 17.97 17.97 17.97 17.97 |
| rds/CPUUtilization | 40.73 | 5.19 6.75 16.78 29.63 31.28 28.29 28.55 26.95 40.24 40.73 24.75 27.43 28.21 |
| rds/DatabaseConnections | 14.0 | 3.0 2.0 14.0 12.0 14.0 14.0 12.0 12.0 14.0 12.0 14.0 3.0 |
| rds/ReadIOPS | 34.7 | 5.77 8.07 16.33 14.4 28.95 17.46 16.98 34.7 16.36 16.28 10.13 |
| rds/WriteIOPS | 75.51 | 2.76 0.82 64.52 56.22 68.65 75.51 68.02 70.46 54.85 45.21 4.72 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.48 | 0.72 0.7 0.72 1.15 1.35 1.37 1.43 1.37 1.48 1.45 1.37 1.43 1.37 1.18 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
