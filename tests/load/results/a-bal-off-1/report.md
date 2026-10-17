# Load run `a-bal-off-1`

## k6 (load generator view)

```
time="2026-10-17T09:17:40Z" level=info msg="MEASURE_T0=2026-10-17T09:17:40.866Z" source=console

ALL (steady scenario)      n=  47253  p50=   508  p95=  2685  p99=  3395  max=  4959 ms
  projects                 n=   4833  p50=   487  p95=  2601  p99=  2956  max=  3348 ms
  activity                 n=   4786  p50=   656  p95=  3600  p99=  4048  max=  4959 ms
  move                     n=   3325  p50=   465  p95=  1973  p99=  2343  max=  3376 ms
  board                    n=  16512  p50=   496  p95=  2655  p99=  3052  max=  4219 ms
  update                   n=   3245  p50=   432  p95=  1935  p99=  2312  max=  3388 ms
  comment                  n=   1411  p50=   431  p95=  1941  p99=  2239  max=  2530 ms
  create                   n=   3215  p50=   405  p95=  1862  p99=  2175  max=  2591 ms
  delete                   n=    730  p50=   438  p95=  1891  p99=  2152  max=  2549 ms
  assign                   n=   1380  p50=   471  p95=  1974  p99=  2228  max=  2569 ms
  task                     n=   4868  p50=   473  p95=  2626  p99=  2964  max=  4014 ms
  unassign                 n=    911  p50=   354  p95=  1910  p99=  2215  max=  3121 ms
  workspaces               n=   7097  p50=   276  p95=  1704  p99=  2031  max=  3225 ms
requests 53864 (84.0/s over 641 s incl. setup), failed 0.00 %
successful writes 14062 (21.9/s)
version conflicts (409) 155

level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s
50       91.4      24.5  0.00     55    305    534        288         409       382         0.0    58
100      93.8      25.5  0.00    549   1198   1534       1245         939      1013         0.0    43
200      77.3      20.3  0.00   2153   3251   3824       2988        2164      2295         0.0    49
  board (bypass)           n=  16512  p50=   496  p95=  2655  p99=  3052  max=  4219 ms
time="2026-10-17T09:27:58Z" level=error msg="thresholds on metrics 'http_req_duration{kind:api}, http_req_duration{level:100,op:board}, http_req_duration{level:100,op:move}, http_req_duration{level:100}, http_req_duration{level:200,op:board}, http_req_duration{level:200,op:create}, http_req_duration{level:200,op:move}, http_req_duration{level:200}, http_req_duration{op:activity}, http_req_duration{op:assign}, http_req_duration{op:board}, http_req_duration{op:comment}, http_req_duration{op:create}, http_req_duration{op:delete}, http_req_duration{op:move}, http_req_duration{op:projects}, http_req_duration{op:task}, http_req_duration{op:unassign}, http_req_duration{op:update}, http_req_duration{op:workspaces}' have been crossed"
```

## Service metrics (deltas over the run)

- project-service HTTP responses by class: 2xx 28132, 4xx 63
- Outbox: published 13453; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: processed 13453; retries 0; dead-lettered 0
- cache-invalidator consumer messages: processed 13453; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 13453; retries 0; dead-lettered 0
- activity outcomes: processed 13453
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 0, idle 0; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 120840 commits (162.5/s over 743 s between snapshots), rollbacks 155; tuples returned 20337707, fetched 4686355, inserted 48018, updated 35858, deleted 536; blocks read 0, hit 7505138
- project-service memory at end: RSS 145 MiB, heap used 43 MiB
- api-gateway memory at end: RSS 129 MiB, heap used 31 MiB
- realtime-service memory at end: RSS 113 MiB, heap used 41 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 100.0 | 25.71 95.03 97.34 97.22 98.91 97.7 100.0 99.83 99.9 99.68 99.77 99.83 |
| ecs/project-service/MemoryUtilization | 31.35 | 23.63 28.22 31.15 30.76 30.47 30.66 30.96 30.18 30.08 31.05 31.35 31.35 |
| ecs/api-gateway/CPUUtilization | 57.54 | 18.71 47.68 56.11 57.54 51.38 53.5 54.44 52.08 48.41 44.31 47.58 44.53 |
| ecs/api-gateway/MemoryUtilization | 21.39 | 14.65 18.65 19.14 19.14 19.34 19.24 19.63 19.92 20.02 21.0 21.39 21.29 |
| ecs/outbox-publisher/CPUUtilization | 42.1 | 16.67 42.1 31.89 34.42 35.33 31.95 37.77 32.86 33.44 35.49 30.1 36.13 |
| ecs/outbox-publisher/MemoryUtilization | 27.44 | 27.44 23.73 23.73 24.22 24.51 24.02 23.63 23.63 23.63 23.83 24.22 23.83 |
| ecs/activity-service/CPUUtilization | 36.62 | 31.11 24.95 36.42 36.62 36.47 34.66 35.32 35.15 33.19 31.72 28.76 29.45 |
| ecs/activity-service/MemoryUtilization | 23.83 | 23.83 20.41 19.73 19.53 19.53 19.43 19.53 19.53 19.34 19.34 19.34 19.34 |
| ecs/realtime-service/CPUUtilization | 34.23 | 14.19 34.23 24.14 23.72 23.67 24.54 25.01 24.46 23.31 24.01 22.45 21.93 |
| ecs/realtime-service/MemoryUtilization | 27.44 | 20.12 27.44 20.02 19.82 19.73 19.53 19.53 19.53 19.53 19.53 19.53 19.53 |
| ecs/cache-invalidator/CPUUtilization | 34.38 | 31.12 34.38 26.46 28.73 28.84 27.38 33.69 30.55 27.12 25.06 25.13 24.36 |
| ecs/cache-invalidator/MemoryUtilization | 23.63 | 23.63 22.95 20.21 13.48 14.65 14.75 14.94 14.65 14.65 15.23 17.38 17.48 |
| rds/CPUUtilization | 18.44 | 5.16 9.34 15.02 17.72 18.44 15.99 17.89 17.06 17.93 15.32 17.21 17.25 |
| rds/DatabaseConnections | 14.0 | 1.0 13.0 12.0 12.0 14.0 12.0 12.0 14.0 12.0 12.0 13.0 12.0 1.0 |
| rds/ReadIOPS | 16.15 | 1.53 2.31 2.46 2.22 16.15 3.44 3.1 2.8 2.17 14.15 7.14 4.34 2.07 |
| rds/WriteIOPS | 88.95 | 1.15 57.33 70.39 74.46 80.99 72.7 88.95 81.05 65.12 78.13 65.68 70.62 3.64 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.03 | 0.7 0.7 0.92 0.95 0.97 1.0 1.0 1.03 1.02 0.95 0.93 0.93 0.92 |
| redis/dpp-dev-001/CurrConnections | 6.0 | 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 6.0 |
