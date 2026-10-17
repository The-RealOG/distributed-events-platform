# Load run `f-soak-http`

## k6 (load generator view)

```
time="2026-10-17T20:48:27Z" level=info msg="MEASURE_T0=2026-10-17T20:48:27.950Z" source=console

ALL (steady scenario)      n= 141669  p50=    32  p95=   160  p99=   476  max= 12949 ms
  workspaces               n=  19393  p50=    29  p95=   113  p99=   322  max=  8215 ms
  unassign                 n=   2593  p50=    30  p95=   173  p99=   422  max=  8907 ms
  create                   n=   5405  p50=    33  p95=   207  p99=   550  max= 10038 ms
  comment                  n=   3841  p50=    32  p95=   192  p99=   500  max= 12634 ms
  assign                   n=   3838  p50=    33  p95=   238  p99=   731  max= 12949 ms
  activity                 n=  12751  p50=    32  p95=   168  p99=   625  max= 10931 ms
  delete                   n=   5046  p50=    31  p95=   188  p99=   484  max=  7930 ms
  update                   n=   8898  p50=    32  p95=   203  p99=   535  max= 12892 ms
  task                     n=  13431  p50=    31  p95=   130  p99=   407  max= 12902 ms
  projects                 n=  12846  p50=    29  p95=   105  p99=   264  max=  5880 ms
  board                    n=  44550  p50=    34  p95=   160  p99=   474  max=  8446 ms
  move                     n=   9077  p50=    34  p95=   218  p99=   607  max= 11257 ms
requests 143220 (75.7/s over 1893 s incl. setup), failed 0.26 %
successful writes 37946 (20.0/s)
version conflicts (409) 724
board cache (client view, x-board-cache) hit 25921 / miss 18422 = 58.5 % hits
  board (hit)              n=  25921  p50=    32  p95=   132  p99=   354  max=  6820 ms
  board (miss)             n=  18422  p50=    35  p95=   195  p99=   553  max=  8446 ms
  board (bypass)           n=      1  p50=   658  p95=   658  p99=   658  max=   658 ms
```

## Service metrics (deltas over the run)

- Board cache (server): hits 25921, misses 18469, errors 2 → hit rate **58.4 %**
- project-service HTTP responses by class: 2xx 143369, 4xx 724, 5xx 134
- Outbox: published 35561; failures 0; pending after 0.0; oldest pending age after 0.0 s
- activity-service consumer messages: dead_lettered 0, malformed 0, processed 35561; retries 0; dead-lettered 0
- cache-invalidator consumer messages: malformed 0, processed 35561; retries 0; dead-lettered 0
- realtime-service consumer messages: processed 35561; retries 0; dead-lettered 0
- activity outcomes: processed 35561
- realtime hub: broadcast 0; connections now 201.0
- project-service DB pool at end: total 0, idle 0; waiting 0
- outbox-publisher DB pool at end: total 2, idle 2; waiting 0
- activity-service DB pool at end: total 0, idle 0; waiting 0
- realtime-service DB pool at end: total 1, idle 1; waiting 0
- PostgreSQL (pg_stat_database, includes setup/seed): 297608 commits (147.7/s over 2015 s between snapshots), rollbacks 724; tuples returned 37637590, fetched 11083005, inserted 122418, updated 97814, deleted 1203; blocks read 270481, hit 13366128
- project-service memory at end: RSS 149 MiB, heap used 36 MiB
- api-gateway memory at end: RSS 125 MiB, heap used 26 MiB
- realtime-service memory at end: RSS 125 MiB, heap used 35 MiB

## CloudWatch (per-minute maxima over the window)

| series | max | per-minute values |
|---|---|---|
| ecs/project-service/CPUUtilization | 82.86 | 17.27 3.14 82.86 80.76 78.63 79.61 74.18 73.52 74.94 74.86 73.84 73.16 75.84 72.42 73.71 73.84 74.86 69.1 75.2 76.41 74.69 77.47 77.0 71.6 77.28 69.76 70.95 74.23 69.86 72.14 66.56 69.75 72.29 71.05 |
| ecs/project-service/MemoryUtilization | 28.71 | 21.58 14.45 23.14 27.05 26.95 27.44 27.44 27.44 27.73 27.93 28.12 28.03 28.03 27.05 28.32 28.32 28.32 28.22 27.64 28.42 28.61 28.52 28.71 27.34 27.05 27.15 27.15 27.05 27.15 27.25 27.34 27.15 27.34 27.54 |
| ecs/api-gateway/CPUUtilization | 57.07 | 18.64 4.51 34.69 45.64 57.07 45.14 40.59 41.61 41.09 43.75 40.37 42.02 40.35 38.94 46.18 41.96 43.4 41.05 41.92 43.58 38.34 41.68 39.85 39.9 40.47 40.52 41.56 43.25 39.47 43.45 40.34 41.35 39.46 44.02 |
| ecs/api-gateway/MemoryUtilization | 18.75 | 17.19 14.45 17.68 18.26 18.75 18.26 18.26 18.26 18.16 18.36 18.16 18.26 18.36 18.36 18.36 18.36 18.36 18.46 18.46 18.55 18.16 18.26 18.16 18.16 18.26 18.26 18.16 18.36 18.26 18.26 18.16 18.16 18.26 18.16 |
| ecs/outbox-publisher/CPUUtilization | 52.96 | 18.57 17.98 52.96 28.61 31.07 31.63 29.41 32.02 25.04 32.26 31.51 28.97 26.6 29.72 25.92 26.86 28.92 33.14 26.27 30.25 28.89 26.42 28.07 26.17 28.12 28.89 24.56 27.78 26.64 26.7 25.43 27.26 27.85 23.89 |
| ecs/outbox-publisher/MemoryUtilization | 23.05 | 14.45 19.73 16.7 17.09 19.82 20.21 21.09 21.39 21.48 21.58 21.78 21.0 22.17 21.68 21.88 22.07 21.88 21.88 21.88 21.88 21.97 21.88 21.88 21.97 21.97 22.07 21.88 22.17 21.0 21.88 21.78 23.05 23.05 22.85 |
| ecs/activity-service/CPUUtilization | 49.51 | 14.95 32.2 49.51 36.13 35.06 34.45 32.27 30.54 29.5 32.32 32.68 35.44 29.08 28.96 31.97 28.61 29.64 29.16 32.19 29.04 26.79 28.61 28.46 28.56 30.15 27.86 29.81 29.75 26.66 29.79 27.0 27.85 27.61 28.36 |
| ecs/activity-service/MemoryUtilization | 19.82 | 14.84 19.82 16.41 18.75 18.95 18.95 18.95 18.95 18.95 19.04 19.14 19.04 19.14 19.14 19.14 19.34 19.34 19.14 19.14 19.14 19.14 19.14 19.14 19.24 19.34 19.34 19.34 19.34 19.34 19.34 19.14 19.14 19.14 19.24 |
| ecs/realtime-service/CPUUtilization | 34.88 | 14.27 21.92 34.88 26.78 25.53 25.74 23.79 22.4 23.75 23.97 23.7 25.66 23.35 22.0 25.89 21.64 21.99 21.88 22.27 21.91 21.35 22.89 22.28 22.2 22.94 21.39 23.35 23.06 20.74 21.49 20.51 24.34 21.3 22.19 |
| ecs/realtime-service/MemoryUtilization | 19.82 | 12.5 19.82 13.96 15.43 15.43 16.31 17.77 17.77 17.97 18.16 18.26 18.26 18.36 18.36 18.36 18.46 18.46 18.46 18.55 18.55 18.55 18.55 18.65 18.75 18.65 18.75 18.65 18.75 18.75 18.75 18.85 18.95 18.95 19.04 |
| ecs/cache-invalidator/CPUUtilization | 43.3 | 14.8 28.59 43.3 26.9 28.34 26.74 25.7 24.6 25.92 25.44 27.45 26.69 29.38 23.4 29.19 24.29 24.96 25.32 24.26 24.33 21.96 24.78 23.01 24.02 23.92 23.77 24.21 24.25 22.83 22.79 22.29 23.66 21.15 24.3 |
| ecs/cache-invalidator/MemoryUtilization | 20.31 | 12.11 20.31 14.65 15.04 17.38 17.77 17.77 17.87 17.87 17.87 17.97 17.97 17.97 17.77 17.77 17.87 17.87 17.87 17.87 17.97 17.97 17.97 18.16 17.97 17.97 17.97 17.97 17.97 17.97 17.97 17.97 17.97 17.97 17.97 |
| rds/CPUUtilization | 24.99 | 6.73 5.45 8.6 12.19 14.25 13.53 14.0 13.23 16.38 13.91 13.96 14.61 17.17 13.22 16.19 14.61 16.02 15.05 14.85 13.49 16.19 15.65 15.3 15.32 17.84 13.93 19.99 14.4 18.74 14.65 24.99 17.5 21.15 13.25 |
| rds/DatabaseConnections | 14.0 | 3.0 1.0 7.0 14.0 12.0 13.0 12.0 13.0 14.0 14.0 12.0 13.0 13.0 12.0 12.0 14.0 12.0 13.0 9.0 13.0 14.0 12.0 14.0 14.0 12.0 13.0 |
| rds/ReadIOPS | 81.06 | 14.17 0.37 81.06 56.82 40.74 30.22 25.43 48.97 52.81 42.77 21.65 9.43 9.43 14.89 4.6 6.36 14.01 9.08 12.85 7.39 19.55 8.51 14.59 8.03 16.68 14.66 |
| rds/WriteIOPS | 84.13 | 0.65 0.18 75.36 62.6 69.98 69.1 66.1 79.35 76.37 84.13 68.27 70.22 69.15 77.69 73.09 66.66 77.05 74.03 73.77 69.07 71.0 73.67 67.41 60.82 81.22 58.45 |
| redis/dpp-dev-001/EngineCPUUtilization | 1.57 | 0.72 0.7 0.72 0.98 1.4 1.52 1.5 1.52 1.5 1.52 1.52 1.5 1.45 1.5 1.47 1.57 1.52 1.52 1.5 1.52 1.43 1.48 1.47 1.48 1.55 1.47 1.5 1.45 1.47 1.42 1.43 1.4 1.43 1.43 |
| redis/dpp-dev-001/CurrConnections | 7.0 | 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 7.0 |
