# Load run `balanced-ladder-opt1`

## k6 (load generator view)

```
ALL (steady scenario)      n= 129175  p50=   523  p95=  2358  p99=  2836  max=  7197 ms
  projects                 n=  11770  p50=   643  p95=  2393  p99=  2791  max=  4423 ms
  board                    n=  40786  p50=   567  p95=  2401  p99=  2855  max=  7189 ms
  create                   n=   5790  p50=   459  p95=  2162  p99=  2730  max=  6805 ms
  assign                   n=   3509  p50=   471  p95=  2148  p99=  2642  max=  6833 ms
  unassign                 n=   2368  p50=   393  p95=  2093  p99=  2470  max=  2850 ms
  comment                  n=   3430  p50=   483  p95=  2149  p99=  2595  max=  6826 ms
  update                   n=   8190  p50=   475  p95=  2149  p99=  2607  max=  6905 ms
  move                     n=   8101  p50=   481  p95=  2200  p99=  2628  max=  6820 ms
  task                     n=  12273  p50=   686  p95=  2448  p99=  2934  max=  7197 ms
  activity                 n=  11554  p50=   890  p95=  2774  p99=  3327  max=  6916 ms
  delete                   n=   3822  p50=   452  p95=  2166  p99=  2539  max=  7010 ms
  workspaces               n=  17582  p50=   395  p95=  2071  p99=  2468  max=  6815 ms
requests 130726 (136.9/s over 955 s incl. setup), failed 0.00 %
successful writes 34622 (36.3/s)
version conflicts (409) 588
board cache (client view, x-board-cache) hit 17665 / miss 23120 = 43.3 % hits

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
10       19.1       5.2  0.00     63    112    141         97         112       115        57.3    14
50       95.4      25.5  0.00     62    120    288        122         198       127        58.4    93
100     183.6      49.0  0.00     63    246    426        249         302       286        59.6   160
250     214.7      57.9  0.00    674   1237   1495       1217         933       961        32.0   143
500     204.9      54.8  0.00   1941   2734   3201       2749        2664      2524        32.3   178
  board (hit)              n=  17665  p50=   107  p95=  2018  p99=  2423  max=  6964 ms
  board (miss)             n=  23120  p50=   874  p95=  2559  p99=  3015  max=  7189 ms
  board (bypass)           n=      1  p50=  1176  p95=  1176  p99=  1176  max=  1176 ms
time="2026-09-26T18:33:03Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:250,op:board}, http_req_duration{level:250}, http_req_duration{level:500,op:board}, http_req_duration{level:500,op:create}, http_req_duration{level:500,op:move}, http_req_duration{level:500}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- Board cache (server): hits 17665, misses 23140, errors 8 → hit rate **43.3 %**
- project-service HTTP responses by class: 2xx 130138, 4xx 588
- Outbox: published 32411; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 32411; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 32411; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 32411; retries 0; dead-lettered 0
- activity outcomes: processed 32411
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- project-service memory at end: RSS 287 MiB, heap used 53 MiB
- api-gateway memory at end: RSS 152 MiB, heap used 48 MiB
- realtime-service memory at end: RSS 124 MiB, heap used 34 MiB

## CloudWatch (per-minute maxima over the window)

| series                                  | max    | per-minute values                                                                                                       |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| ecs/project-service/CPUUtilization      | 99.93  | 6.0 7.78 60.44 26.51 24.75 23.35 54.63 69.55 49.18 87.89 91.03 87.06 99.93 99.85 99.92 99.33 99.45 99.63                |
| ecs/project-service/MemoryUtilization   | 52.83  | 13.09 20.12 25.88 34.67 38.09 39.16 41.89 44.53 44.24 45.02 45.61 45.8 47.95 49.61 50.59 50.59 52.05 52.83              |
| ecs/api-gateway/CPUUtilization          | 96.44  | 6.95 30.04 51.73 18.96 19.23 32.24 64.88 55.67 51.83 84.89 86.88 87.86 96.44 91.58 93.27 94.04 94.14 96.41              |
| ecs/api-gateway/MemoryUtilization       | 23.83  | 9.96 14.36 17.38 17.58 17.68 17.68 17.97 18.16 18.16 18.95 19.14 19.24 21.0 21.19 21.58 23.14 23.83 23.44               |
| ecs/outbox-publisher/CPUUtilization     | 22.38  | 8.23 9.78 13.17 12.26 10.38 7.61 12.72 15.51 13.55 18.39 22.07 19.74 22.38 20.82 21.01 19.08 17.7 18.25                 |
| ecs/outbox-publisher/MemoryUtilization  | 78.12  | 70.7 78.12 65.92 58.3 58.59 58.59 58.98 58.2 59.28 59.47 59.08 60.35 59.38 59.86 59.96 59.47 60.06 60.45                |
| ecs/activity-service/CPUUtilization     | 30.17  | 11.31 16.1 30.17 12.73 12.33 11.18 18.77 17.24 18.02 25.99 21.59 24.89 24.42 21.95 22.86 22.41 22.74 25.83 21.64        |
| ecs/activity-service/MemoryUtilization  | 56.35  | 56.35 18.85 13.09 15.23 17.29 17.58 23.63 23.63 23.83 23.83 23.93 23.93 24.02 24.02 24.12 24.02 24.12 24.22 34.77       |
| ecs/realtime-service/CPUUtilization     | 38.08  | 16.34 15.68 38.08 17.39 17.0 16.89 26.66 25.94 26.72 35.57 34.91 34.15 36.61 36.84 36.01 37.6 36.49 34.78 30.72         |
| ecs/realtime-service/MemoryUtilization  | 18.95  | 14.94 11.72 18.95 13.87 13.67 14.84 14.94 15.14 17.97 18.16 18.46 18.55 18.55 18.55 18.75 18.65 18.75 18.75 18.75       |
| ecs/cache-invalidator/CPUUtilization    | 41.51  | 16.83 29.57 33.37 18.05 17.77 19.77 27.46 26.86 26.81 40.79 38.78 41.51 41.3 41.33 39.35 38.1 36.78 37.77 35.24         |
| ecs/cache-invalidator/MemoryUtilization | 17.77  | 13.09 13.96 15.23 12.7 13.87 14.06 16.02 16.8 17.38 17.48 17.58 17.77 17.77 17.77 17.77 17.77 17.77 17.77 17.77         |
| rds/CPUUtilization                      | 29.6   | 4.65 4.59 6.08 7.89 7.28 7.33 13.68 14.05 14.98 20.16 24.23 24.14 25.78 28.19 29.6 26.86 28.33 26.97 16.14              |
| rds/DatabaseConnections                 | 14.0   | 1.0 1.0 7.0 8.0 6.0 4.0 12.0 9.0 13.0 12.0 12.0 14.0 14.0 12.0 12.0 14.0 12.0 12.0 1.0                                  |
| rds/ReadIOPS                            | 15.99  | 1.37 0.1 0.78 0.8 4.83 1.37 1.63 0.93 0.77 10.72 4.8 1.77 2.05 2.22 15.99 5.25 4.31 4.25 3.94                           |
| rds/WriteIOPS                           | 165.13 | 0.77 0.33 15.94 39.78 31.84 19.43 64.38 76.55 79.36 128.81 142.27 140.62 150.63 163.93 165.13 143.59 154.1 151.37 79.84 |
| redis/dpp-dev-001/EngineCPUUtilization  | 2.9    | 0.72 0.68 0.72 0.96 0.9 0.92 1.45 1.57 1.62 2.06 2.37 2.28 2.5 2.83 2.77 2.66 2.9 2.73 1.71                             |
| redis/dpp-dev-001/CurrConnections       | 7.0    | 7.0 6.0 6.0 6.0 6.0 7.0 6.0 6.0 7.0 7.0 6.0 7.0 6.0 7.0 6.0 7.0 7.0 7.0 7.0                                             |
