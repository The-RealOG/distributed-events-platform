# Experiment A: cache ON

Cells: median across runs (min–max). Latency columns are the median of each run's own k6 percentile, not a pooled percentile. CPU: per-minute maximum over the level's full minutes.

## READ-HEAVY (3 runs)

- `tests/load/results/a-read-on-1`: deployed 4b22d57; runner azure=eastus vm=Standard_D2ads_v6 cloudfront_pop=IAD55-P10; DB 135 commits/s, 3841 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-read-on-2`: deployed 4b22d57; runner azure=westus2 vm=Standard_D2ads_v5 cloudfront_pop=HIO52-P3; DB 125 commits/s, 2446 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-read-on-3`: deployed 4b22d57; runner azure=southcentralus vm=Standard_D2ads_v7 cloudfront_pop=DFW56-P6; DB 131 commits/s, 7981 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 92 (87–96) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 44 (24–78) | 184 (174–197) | 363 (340–371) | 185 (169–198) | 100 (100–100) | 0.00 (0.00–0.00) | 86 (86–87) | 55 (49–57) | 8.4 (8.0–9.2) |
| 100 | 159 (153–167) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 105 (84–121) | 450 (401–476) | 704 (565–706) | 449 (401–474) | 100 (100–100) | 0.00 (0.00–0.00) | 100 (100–100) | 64 (64–72) | 9.8 (9.0–11) |
| 200 | 163 (162–163) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 677 (671–689) | 1363 (1358–1393) | 1811 (1807–1842) | 1157 (1134–1177) | 100 (100–100) | 0.00 (0.00–0.00) | 100 (100–100) | 69 (67–71) | 9.0 (8.9–11) |

## BALANCED (3 runs)

- `tests/load/results/a-bal-on-1`: deployed 4b22d57; runner azure=northcentralus vm=Standard_D2ads_v5 cloudfront_pop=ORD58-P17; DB 146 commits/s, 18070 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-bal-on-2`: deployed 4b22d57; runner azure=northcentralus vm=Standard_D2ads_v5 cloudfront_pop=ORD58-P17; DB 147 commits/s, 17981 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-bal-on-3`: deployed 4b22d57; runner azure=eastus vm=Standard_D2ads_v6 cloudfront_pop=IAD55-P10; DB 148 commits/s, 20257 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 90 (88–90) | 24 (24–24) | 0.00 (0.00–0.00) | 56 (53–57) | 407 (381–416) | 607 (596–685) | 391 (368–406) | 57 (57–58) | 54 (51–71) | 99 (97–99) | 57 (53–60) | 16 (13–16) |
| 100 | 92 (92–92) | 25 (25–25) | 0.00 (0.00–0.00) | 562 (539–563) | 1265 (1256–1326) | 1639 (1597–1723) | 1279 (1277–1347) | 42 (42–43) | 45 (33–56) | 100 (100–100) | 53 (52–53) | 16 (16–17) |
| 200 | 76 (76–77) | 21 (20–21) | 0.00 (0.00–0.00) | 2166 (2135–2187) | 3328 (3313–3390) | 3848 (3823–3878) | 3114 (3080–3143) | 26 (25–27) | 45 (40–55) | 100 (100–100) | 46 (45–48) | 16 (15–18) |

