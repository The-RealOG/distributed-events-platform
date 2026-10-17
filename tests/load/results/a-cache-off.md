# Experiment A: cache OFF

Cells: median across runs (min–max). Latency columns are the median of each run's own k6 percentile, not a pooled percentile. CPU: per-minute maximum over the level's full minutes.

## READ-HEAVY (3 runs)

- `tests/load/results/a-read-off-1`: deployed 4b22d57; runner azure=WestUS3 vm=Standard_D2ds_v6 cloudfront_pop=PHX52-P1; project-service host Platinum 8259CL; DB 190 commits/s, 30344 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-read-off-2`: deployed 4b22d57; runner azure=WestUS3 vm=Standard_D2ads_v6 cloudfront_pop=PHX52-P1; project-service host Platinum 8259CL; DB 192 commits/s, 34029 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-read-off-3`: deployed 4b22d57; runner azure=eastus vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 201 commits/s, 38864 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 90 (88–95) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 59 (26–60) | 205 (182–223) | 316 (310–451) | 209 (184–225) | – | 0.00 (0.00–0.00) | 91 (87–92) | 55 (51–60) | 12 (11–13) | 2.3 (2.2–2.4) | 1.4 (1.4–1.4) |
| 100 | 149 (147–153) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 141 (125–151) | 509 (508–531) | 769 (709–825) | 517 (515–542) | – | 0.00 (0.00–0.00) | 99 (98–99) | 71 (70–71) | 15 (15–16) | 1.6 (1.6–1.7) | 1.1 (1.1–1.2) |
| 200 | 142 (141–143) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 887 (879–894) | 1468 (1449–1557) | 1879 (1722–1938) | 1416 (1411–1527) | – | 0.00 (0.00–0.00) | 100 (100–100) | 68 (67–69) | 15 (15–15) | 1.8 (1.7–1.8) | 1.1 (1.1–1.1) |

## BALANCED (3 runs)

- `tests/load/results/a-bal-off-1`: deployed 4b22d57; runner azure=centralus vm=Standard_D2ads_v5 cloudfront_pop=ORD58-P17; project-service host Platinum 8259CL; DB 163 commits/s, 27357 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-bal-off-2`: deployed 4b22d57; runner azure=westus vm=Standard_D2ads_v5 cloudfront_pop=SFO53-P4; project-service host Platinum 8259CL; DB 158 commits/s, 29156 tuples returned/s (whole run incl. setup)
- `tests/load/results/a-bal-off-3`: deployed 4b22d57; runner azure=eastus2 vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 160 commits/s, 32025 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 91 (88–92) | 25 (24–25) | 0.00 (0.00–0.00) | 55 (45–78) | 305 (298–324) | 534 (500–689) | 288 (274–307) | – | 58 (43–59) | 97 (95–99) | 54 (54–58) | 18 (17–21) | 2.7 (2.6–2.7) | 1.4 (1.4–1.4) |
| 100 | 94 (92–98) | 25 (25–27) | 0.00 (0.00–0.00) | 549 (497–555) | 1198 (1140–1278) | 1534 (1487–1722) | 1245 (1162–1309) | – | 48 (43–53) | 100 (100–100) | 54 (54–55) | 19 (18–22) | 2.5 (2.5–2.7) | 1.3 (1.3–1.4) |
| 200 | 77 (76–78) | 20 (20–21) | 0.00 (0.00–0.00) | 2153 (2121–2207) | 3251 (3179–3405) | 3824 (3749–4346) | 3011 (2988–3193) | – | 49 (48–62) | 100 (100–100) | 48 (47–48) | 18 (17–21) | 3.2 (3.0–3.3) | 1.4 (1.4–1.4) |

