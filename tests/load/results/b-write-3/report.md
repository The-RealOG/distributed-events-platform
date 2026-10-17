# Load run `b-write-3`

## k6 (load generator view)

```
time="2026-10-17T12:21:50Z" level=info msg="MEASURE_T0=2026-10-17T12:21:50.110Z" source=console

ALL (steady scenario)      n=  33995  p50=   698  p95=  5034  p99=  7128  max= 15286 ms
  comment                  n=   3441  p50=   652  p95=  5021  p99=  5968  max= 15258 ms
  unassign                 n=   1687  p50=   519  p95=  5020  p99=  6048  max= 12605 ms
  delete                   n=   1668  p50=  1114  p95=  5020  p99=  5602  max= 12035 ms
  move                     n=   7021  p50=   643  p95=  5032  p99=  6679  max= 15286 ms
  create                   n=   4504  p50=   568  p95=  5025  p99=  6576  max= 15250 ms
  assign                   n=   2709  p50=   654  p95=  5031  p99=  7175  max= 15243 ms
  task                     n=   2048  p50=  1016  p95=  5690  p99=  7328  max= 14697 ms
  update                   n=   6907  p50=   610  p95=  5021  p99=  6300  max= 15233 ms
  board                    n=   3616  p50=   937  p95=  5464  p99=  7358  max= 13184 ms
  activity                 n=   1686  p50=  1227  p95=  7235  p99= 10043  max= 15255 ms
requests 36838 (56.8/s over 649 s incl. setup), failed 5.10 %
successful writes 26255 (40.5/s)
version conflicts (409) 418
board cache (client view, x-board-cache) hit 198 / miss 3103 = 6.0 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       60.5      45.9  2.68     50   1075   5033       1742        1047      1001        12.5   141
100      61.2      44.8  7.57    588   5027   5908       5024        5021      5031         4.5    95
200      67.2      50.2  5.12   1922   5590   7981       6729        5423      5350         0.2   171
  board (hit)              n=    198  p50=    95  p95=  1293  p99=  2999  max=  9943 ms
  board (miss)             n=   3103  p50=   986  p95=  4396  p99=  7059  max= 13184 ms
  board (bypass)           n=      2  p50=  1145  p95=  1174  p99=  1177  max=  1177 ms
time="2026-10-17T12:32:10Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:create}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{level:50,op:board}, http_req_duration{level:50,op:create}, http_req_duration{level:50,op:move}, http_req_duration{level:50}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_failed, http_req_failed{level:100}, http_req_failed{level:200}, http_req_failed{level:50}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 198, misses 3180, errors 3 → hit rate **5.9 %**
- project-service HTTP responses by class: 2xx 34587, 4xx 418, 5xx 1729
- Outbox: published 24865; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 24865; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 24865; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 24865; retries 0; dead-lettered 0
- activity outcomes: duplicate 0, failed 0, processed 24865
- realtime hub: duplicate_suppressed 0; connections now 0.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 3, idle 3; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 96592 commits (126.3/s over 765 s between snapshots), rollbacks 436; tuples returned 17602048, fetched 4672612, inserted 85892, updated 66907, deleted 621; blocks read 494369, hit 8572965
- project-service memory at end: RSS 145 MiB, heap used 46 MiB
- api-gateway memory at end: RSS 141 MiB, heap used 30 MiB
- realtime-service memory at end: RSS 118 MiB, heap used 35 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 99.94 | 8.58 80.84 63.48 95.77 96.47 96.17 99.54 99.92 98.91 99.94 86.36 99.67 17.54 |
| ecs/project-service/MemoryUtilization | 36.23 | 22.75 29.98 28.71 30.86 31.05 31.05 29.98 30.37 30.08 30.57 30.86 30.66 36.23 |
| ecs/api-gateway/CPUUtilization | 48.64 | 18.63 45.18 30.74 48.46 45.69 46.26 48.64 47.28 40.05 42.87 38.18 45.92 12.75 |
| ecs/api-gateway/MemoryUtilization | 23.24 | 15.82 17.97 18.85 19.82 19.92 19.92 20.31 20.31 20.41 20.8 21.09 21.29 23.24 |
| ecs/outbox-publisher/CPUUtilization | 55.04 | 29.4 22.4 25.17 44.09 52.3 51.64 48.08 53.55 55.04 44.07 50.39 46.5 48.33 |
| ecs/outbox-publisher/MemoryUtilization | 25.39 | 25.39 22.66 23.05 23.14 23.14 23.93 23.54 23.14 23.34 23.73 23.34 22.95 23.05 |
| ecs/activity-service/CPUUtilization | 54.93 | 20.22 20.58 22.05 48.87 48.1 49.45 53.42 43.62 46.45 44.5 54.93 47.69 32.82 |
| ecs/activity-service/MemoryUtilization | 26.17 | 26.17 19.53 19.63 19.53 19.53 19.43 19.24 19.34 19.34 19.34 19.34 19.24 19.14 |
| ecs/realtime-service/CPUUtilization | 45.41 | 15.2 27.71 27.85 42.25 41.16 40.68 45.41 43.08 39.48 41.65 37.11 42.52 23.14 |
| ecs/realtime-service/MemoryUtilization | 26.17 | 18.55 26.17 19.14 19.14 18.95 18.85 18.75 18.75 18.85 18.85 18.75 18.75 18.75 |
| ecs/cache-invalidator/CPUUtilization | 44.69 | 14.4 19.7 20.4 29.88 38.37 38.79 38.26 44.69 37.42 29.49 40.93 33.07 38.08 |
| ecs/cache-invalidator/MemoryUtilization | 24.02 | 19.14 24.02 18.16 18.16 18.07 18.16 18.16 18.16 17.97 18.07 18.07 17.97 17.97 |
| rds/CPUUtilization | 47.37 | 9.4 15.36 42.83 29.59 30.76 32.02 29.66 33.55 35.54 35.2 47.37 41.04 21.04 |
| rds/DatabaseConnections | 14.0 | 1.0 14.0 12.0 14.0 12.0 12.0 14.0 12.0 12.0 12.0 12.0 14.0 1.0 |
| rds/ReadIOPS | 185.7 | 82.22 185.7 129.28 176.41 106.09 98.26 136.53 84.63 92.74 119.18 137.46 92.07 52.78 |
| rds/WriteIOPS | 175.44 | 13.44 69.86 93.22 137.97 126.83 172.07 140.29 141.67 125.17 134.7 144.43 175.44 36.39 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.53 | 0.7 0.7 0.85 1.07 1.35 1.25 1.48 1.53 1.37 1.18 1.45 1.5 1.52 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
