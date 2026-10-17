# Experiment B: hot-project vs multi-project (cache ON, 0819abc, fresh RDS)

Cells: median across runs (min–max). Latency columns are the median of each run's own k6 percentile, not a pooled percentile. CPU: per-minute maximum over the level's full minutes.

## HOT-PROJECT (2 runs)

- `tests/load/results/b-hot-1r`: deployed 0819abc; runner azure=eastus vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 67 commits/s, 18247 tuples returned/s (whole run incl. setup)
- `tests/load/results/b-hot-2r`: deployed 0819abc; runner azure=southcentralus vm=Standard_D2ads_v7 cloudfront_pop=DFW56-P6; project-service host Platinum 8259CL; DB 64 commits/s, 10796 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 41 (40–41) | 9.7 (9.3–10) | 0.00 (0.00–0.00) | 773 (773–773) | 1535 (1489–1581) | 1903 (1821–1985) | 1721 (1655–1788) | 17 (16–17) | 116 (114–118) | 100 (100–100) | 35 (33–37) | 13 (13–14) | 6.1 (6.0–6.2) | 2.0 (1.9–2.0) |
| 100 | 27 (26–28) | 6.5 (6.3–6.6) | 0.00 (0.00–0.00) | 3357 (3208–3505) | 5303 (5220–5386) | 6138 (6013–6263) | 5212 (5125–5299) | 0.33 (0.22–0.44) | 79 (70–88) | 100 (100–100) | 29 (29–29) | 13 (13–13) | 9.3 (9.0–9.5) | 2.4 (2.4–2.4) |
| 200 | 23 (22–24) | 5.2 (5.0–5.3) | 0.03 (0.00–0.05) | 8449 (8098–8799) | 11804 (10984–12624) | 13260 (12465–14055) | 11468 (10302–12634) | 0.05 (0.00–0.09) | 131 (114–148) | 100 (100–100) | 29 (28–30) | 13 (12–13) | 11 (10–11) | 2.8 (2.8–2.8) |

## MULTI-PROJECT (60 projects) (2 runs)

- `tests/load/results/b-multi-1r`: deployed 0819abc; runner azure=eastus2 vm=Standard_D2ads_v5 cloudfront_pop=IAD55-P10; project-service host Platinum 8259CL; DB 151 commits/s, 20425 tuples returned/s (whole run incl. setup)
- `tests/load/results/b-multi-2r`: deployed 0819abc; runner azure=westcentralus vm=Standard_D2ds_v5 cloudfront_pop=DFW56-P6; project-service host Platinum 8259CL; DB 157 commits/s, 13546 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 91 (90–91) | 24 (24–24) | 0.00 (0.00–0.00) | 52 (45–58) | 346 (315–377) | 531 (489–573) | 336 (306–366) | 59 (59–59) | 50 (43–56) | 97 (96–98) | 55 (54–56) | 15 (15–15) | 2.6 (2.6–2.6) | 1.4 (1.4–1.4) |
| 100 | 109 (109–109) | 29 (28–30) | 0.00 (0.00–0.00) | 403 (398–408) | 993 (958–1028) | 1319 (1259–1379) | 1006 (971–1041) | 56 (55–57) | 54 (49–59) | 100 (100–100) | 59 (58–59) | 17 (17–17) | 2.3 (2.3–2.3) | 1.3 (1.3–1.3) |
| 200 | 93 (92–94) | 25 (25–25) | 0.00 (0.00–0.00) | 1616 (1593–1640) | 2789 (2750–2828) | 3228 (3211–3245) | 2545 (2531–2558) | 45 (45–46) | 52 (50–53) | 100 (100–100) | 50 (50–50) | 16 (15–16) | 2.7 (2.7–2.7) | 1.3 (1.3–1.3) |

