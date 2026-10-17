# Experiment C: project-service scale-out (read-heavy, cache ON, 0819abc, all tasks on Xeon 8259CL)

Cells: median across runs (min–max). Latency columns are the median of each run's own k6 percentile, not a pooled percentile. CPU: per-minute maximum over the level's full minutes.

## 1 TASK (1 runs)

- `tests/load/results/c-scale-1task`: deployed 0819abc; runner azure=eastus vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 140 commits/s, 387382 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 96 | 0.00 | 0.00 | 25 | 166 | 296 | 166 | 100 | 0.00 | 86 | 53 | 13 | 2.2 | 1.3 |
| 100 | 158 | 0.00 | 0.00 | 104 | 462 | 737 | 461 | 100 | 0.00 | 99 | 70 | 16 | 1.6 | 1.1 |
| 200 | 156 | 0.00 | 0.00 | 728 | 1437 | 1961 | 1231 | 100 | 0.00 | 100 | 70 | 16 | 1.6 | 1.1 |
| 300 | 151 | 0.00 | 0.00 | 1481 | 2250 | 2713 | 1923 | 100 | 0.00 | 100 | 67 | 15 | 1.6 | 1.1 |

## 2 TASKS (2 runs)

- `tests/load/results/c-scale-2task-1`: deployed 0819abc; runner azure=eastus vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 219 commits/s, 641381 tuples returned/s (whole run incl. setup)
- `tests/load/results/c-scale-2task-2`: deployed 0819abc; runner azure=eastus vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 208 commits/s, 607376 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 98 (98–98) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 24 (24–24) | 98 (92–103) | 197 (181–213) | 96 (90–101) | 100 (100–100) | 0.00 (0.00–0.00) | 72 (71–74) | 65 (64–66) | 14 (13–15) | 2.6 (2.6–2.6) | 1.4 (1.4–1.4) |
| 100 | 188 (188–189) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 24 (24–25) | 196 (191–202) | 308 (307–308) | 196 (189–202) | 100 (100–100) | 0.00 (0.00–0.00) | 91 (90–91) | 86 (86–87) | 20 (20–21) | 2.1 (2.1–2.1) | 1.1 (1.1–1.1) |
| 200 | 298 (297–298) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 145 (145–146) | 485 (482–487) | 700 (695–706) | 478 (474–482) | 100 (100–100) | 0.00 (0.00–0.00) | 92 (92–92) | 99 (99–100) | 25 (24–26) | 1.5 (1.5–1.5) | 0.82 (0.80–0.83) |
| 300 | 312 (310–314) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 475 (467–482) | 863 (860–865) | 1082 (1074–1089) | 833 (826–839) | 100 (100–100) | 0.00 (0.00–0.00) | 94 (93–95) | 99 (99–99) | 27 (25–28) | 1.4 (1.4–1.4) | 0.76 (0.73–0.78) |

