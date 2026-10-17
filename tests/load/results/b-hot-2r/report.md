# Load run `b-hot-2r`

## k6 (load generator view)

```
time="2026-10-17T15:43:08Z" level=info msg="MEASURE_T0=2026-10-17T15:43:08.226Z" source=console

ALL (steady scenario)      n=  15950  p50=  2117  p95= 10386  p99= 12838  max= 16720 ms
  move                     n=   1156  p50=  1213  p95=  7679  p99=  9151  max= 10404 ms
  board                    n=   6013  p50=  1387  p95= 10514  p99= 12633  max= 14359 ms
  unassign                 n=    335  p50=  1114  p95=  7100  p99=  8735  max=  9666 ms
  delete                   n=    136  p50=  1021  p95=  7618  p99=  8379  max=  8749 ms
  create                   n=   1398  p50=  1038  p95=  7144  p99=  8581  max=  9941 ms
  workspaces               n=   2622  p50=   665  p95=  6743  p99=  7841  max=  9752 ms
  update                   n=   1101  p50=   995  p95=  7585  p99=  8798  max= 10308 ms
  activity                 n=   1718  p50=  1337  p95= 13182  p99= 15228  max= 16720 ms
  task                     n=   2955  p50=  1012  p95=  9755  p99= 11885  max= 12706 ms
  assign                   n=    479  p50=  1212  p95=  7494  p99=  8621  max=  9583 ms
  comment                  n=    486  p50=  1102  p95=  7628  p99=  9240  max= 10193 ms
  projects                 n=   1728  p50=   907  p95=  9599  p99= 11298  max= 12611 ms
requests 21260 (33.2/s over 641 s incl. setup), failed 0.01 %
successful writes 4746 (7.4/s)
version conflicts (409) 345
board cache (client view, x-board-cache) hit 1007 / miss 4758 = 17.5 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       40.2       9.3  0.00    773   1581   1985       1788        1459      1601        16.8   114
100      26.2       6.3  0.00   3505   5386   6263       5299        3572      3806         0.4    70
200      22.1       5.0  0.05   8799  12624  14055      12634        8867      9145         0.1   114
  board (hit)              n=   1007  p50=   249  p95=   825  p99=  1066  max=  1808 ms
  board (miss)             n=   4758  p50=  2586  p95= 10630  p99= 12795  max= 14359 ms
  board (bypass)           n=    246  p50=  4993  p95= 11921  p99= 12848  max= 13149 ms
time="2026-10-17T15:53:28Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50,op:board}, http_req_duration{level:50,op:create}, http_req_duration{level:50,op:move}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 1007, misses 4804, errors 749 → hit rate **17.3 %**
- project-service HTTP responses by class: 2xx 21026, 4xx 348, 5xx 2
- Outbox: published 4442; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 4442; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 4442; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 4442; retries 0; dead-lettered 0
- activity outcomes: processed 4442
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 49424 commits (64.5/s over 766 s between snapshots), rollbacks 348; tuples returned 8273479, fetched 5720741, inserted 17176, updated 12254, deleted 403; blocks read 0, hit 9900685
- project-service memory at end: RSS 163 MiB, heap used 59 MiB
- api-gateway memory at end: RSS 137 MiB, heap used 29 MiB
- realtime-service memory at end: RSS 119 MiB, heap used 39 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 26.96 13.96 99.56 100.0 99.83 99.83 100.0 99.58 100.0 100.0 99.65 100.0 100.0 |
| ecs/project-service/MemoryUtilization | 36.91 | 25.98 21.29 31.45 32.81 33.98 32.52 34.96 32.91 33.89 34.38 34.57 36.23 36.91 |
| ecs/api-gateway/CPUUtilization | 46.2 | 16.55 4.01 46.2 42.71 32.75 30.22 28.48 29.24 27.86 26.49 27.97 25.17 23.59 |
| ecs/api-gateway/MemoryUtilization | 24.71 | 24.71 20.12 20.31 20.51 21.0 20.21 20.61 20.21 20.7 21.19 20.9 21.0 20.7 |
| ecs/outbox-publisher/CPUUtilization | 28.46 | 28.41 15.6 28.46 28.21 23.83 22.54 18.7 21.59 21.79 19.22 22.26 17.45 21.58 |
| ecs/outbox-publisher/MemoryUtilization | 23.14 | 23.14 22.66 21.68 21.48 21.78 22.07 21.68 21.78 21.68 21.88 21.78 21.78 21.88 |
| ecs/activity-service/CPUUtilization | 29.75 | 13.72 25.85 29.75 28.64 21.19 19.88 18.16 18.92 17.29 17.92 16.72 17.55 20.85 |
| ecs/activity-service/MemoryUtilization | 25.0 | 19.34 25.0 19.92 19.73 19.34 19.34 19.34 19.34 19.43 19.53 19.53 19.53 19.53 |
| ecs/realtime-service/CPUUtilization | 22.95 | 14.41 22.83 22.95 19.38 18.36 17.02 17.36 17.3 19.33 16.85 16.95 16.57 16.01 |
| ecs/realtime-service/MemoryUtilization | 24.02 | 18.16 24.02 18.65 18.75 18.36 18.36 18.36 18.36 18.36 18.36 18.36 18.46 18.55 |
| ecs/cache-invalidator/CPUUtilization | 28.59 | 14.98 28.59 23.69 21.8 20.41 18.12 19.1 19.19 17.66 17.77 18.0 17.27 16.83 |
| ecs/cache-invalidator/MemoryUtilization | 23.93 | 17.97 23.93 18.16 17.97 17.87 17.77 17.77 17.68 17.77 17.77 17.87 17.97 17.97 |
| rds/CPUUtilization | 14.12 | 4.43 4.68 11.2 13.07 13.83 14.12 13.62 12.56 12.53 12.68 12.57 13.03 10.27 |
| rds/DatabaseConnections | 13.0 | 1.0 8.0 12.0 13.0 12.0 13.0 12.0 13.0 12.0 12.0 13.0 1.0 |
| rds/ReadIOPS | 10.61 | 0.0 0.2 0.13 1.45 10.61 1.47 1.35 0.22 9.71 0.3 |
| rds/WriteIOPS | 69.52 | 0.15 28.43 69.52 48.74 44.66 25.18 27.1 22.01 37.42 9.65 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.5 | 0.7 0.72 0.7 1.5 1.48 1.5 1.47 1.38 1.43 1.45 1.43 1.43 1.37 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
