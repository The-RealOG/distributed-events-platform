# Load run `a-bal-off-3`

## k6 (load generator view)

```
time="2026-10-17T09:49:06Z" level=info msg="MEASURE_T0=2026-10-17T09:49:06.565Z" source=console

ALL (steady scenario)      n=  46622  p50=   505  p95=  2776  p99=  3608  max=  6243 ms
  create                   n=   3252  p50=   398  p95=  1917  p99=  2436  max=  4294 ms
  board                    n=  16530  p50=   473  p95=  2727  p99=  3263  max=  5198 ms
  comment                  n=   1411  p50=   411  p95=  1950  p99=  2449  max=  4100 ms
  unassign                 n=    904  p50=   402  p95=  1984  p99=  2363  max=  4051 ms
  workspaces               n=   6981  p50=   268  p95=  1744  p99=  2217  max=  3968 ms
  delete                   n=    798  p50=   420  p95=  2030  p99=  2410  max=  3823 ms
  update                   n=   3184  p50=   411  p95=  1928  p99=  2376  max=  4165 ms
  assign                   n=   1394  p50=   436  p95=  1969  p99=  2523  max=  4177 ms
  projects                 n=   4621  p50=   477  p95=  2692  p99=  3097  max=  4810 ms
  task                     n=   4850  p50=   460  p95=  2719  p99=  3268  max=  4790 ms
  move                     n=   3224  p50=   474  p95=  1992  p99=  2434  max=  4156 ms
  activity                 n=   4661  p50=   654  p95=  3684  p99=  4277  max=  6243 ms
requests 53361 (83.0/s over 643 s incl. setup), failed 0.00 %
successful writes 13999 (21.8/s)
version conflicts (409) 168

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       91.7      24.9  0.00     45    298    689        274         348       423         0.0    43
100      91.6      25.0  0.00    555   1278   1722       1309         998      1076         0.0    48
200      75.6      20.3  0.00   2207   3405   4346       3193        2367      2369         0.0    62
  board (bypass)           n=  16530  p50=   473  p95=  2727  p99=  3263  max=  5198 ms
time="2026-10-17T09:59:24Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 53194, 4xx 168
- Outbox: published 13398; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 13398; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 13398; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 13398; retries 0; dead-lettered 0
- activity outcomes: processed 13398
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 119920 commits (159.6/s over 752 s between snapshots), rollbacks 168; tuples returned 24070071, fetched 4322387, inserted 47787, updated 35530, deleted 465; blocks read 0, hit 8358547
- project-service memory at end: RSS 141 MiB, heap used 46 MiB
- api-gateway memory at end: RSS 128 MiB, heap used 28 MiB
- realtime-service memory at end: RSS 113 MiB, heap used 36 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 25.92 11.14 97.19 98.17 95.43 95.45 99.58 99.82 99.64 99.77 100.0 99.85 99.13 |
| ecs/project-service/MemoryUtilization | 32.32 | 26.27 22.56 31.25 32.32 29.98 31.25 30.37 30.66 30.96 31.35 31.74 31.54 31.05 |
| ecs/api-gateway/CPUUtilization | 54.13 | 13.27 37.46 52.04 53.46 51.91 54.07 50.59 54.13 53.45 46.0 43.87 47.73 43.51 |
| ecs/api-gateway/MemoryUtilization | 21.39 | 15.72 13.28 19.24 18.95 19.24 19.34 19.53 19.63 20.02 20.31 21.19 21.39 21.09 |
| ecs/outbox-publisher/CPUUtilization | 45.86 | 33.29 18.15 45.86 36.39 35.25 31.47 33.96 36.09 31.99 31.81 33.84 28.25 29.3 |
| ecs/outbox-publisher/MemoryUtilization | 26.95 | 26.95 24.41 24.8 24.32 24.41 24.22 24.22 24.12 24.32 24.22 24.61 24.22 24.02 |
| ecs/activity-service/CPUUtilization | 36.68 | 14.57 31.44 32.46 34.03 32.24 33.28 35.19 33.81 36.68 32.64 29.5 28.77 28.43 |
| ecs/activity-service/MemoryUtilization | 23.93 | 20.31 23.93 20.51 20.51 20.31 20.51 20.7 20.7 20.7 20.7 20.7 20.7 20.7 |
| ecs/realtime-service/CPUUtilization | 32.3 | 14.28 32.3 23.03 23.6 26.77 23.47 24.09 25.22 24.16 22.64 22.41 21.42 22.4 |
| ecs/realtime-service/MemoryUtilization | 26.66 | 19.92 26.66 20.51 20.51 19.73 19.63 19.53 19.53 19.63 19.53 19.63 19.63 19.63 |
| ecs/cache-invalidator/CPUUtilization | 29.28 | 15.84 29.28 24.31 26.88 25.94 26.48 25.75 26.38 27.01 25.01 24.97 24.04 23.73 |
| ecs/cache-invalidator/MemoryUtilization | 23.34 | 19.73 23.34 19.73 19.73 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 19.34 |
| rds/CPUUtilization | 23.49 | 5.1 5.05 19.21 19.06 19.49 21.28 20.49 22.03 21.89 23.49 20.54 19.01 15.69 |
| rds/DatabaseConnections | 14.0 | 1.0 8.0 12.0 12.0 14.0 14.0 12.0 12.0 13.0 12.0 12.0 14.0 1.0 |
| rds/ReadIOPS | 22.52 | 2.72 2.8 10.18 21.89 9.63 9.98 11.18 10.65 22.52 15.78 11.9 12.51 8.01 |
| rds/WriteIOPS | 88.78 | 0.48 13.7 85.95 80.25 78.3 87.75 74.84 81.25 88.78 64.67 74.49 66.41 28.06 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.03 | 0.72 0.7 0.78 0.98 1.0 1.0 1.03 0.98 1.02 1.02 0.93 0.95 0.93 |
| redis/dpp-dev-001/CurrConnections | 6.0 | 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 |
