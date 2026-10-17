# Optimization 1, controlled A/B (same host CPU model, 2026-10-17)

Cells: median across runs (min–max). Latency columns are the median of each run's own k6 percentile, not a pooled percentile. CPU: per-minute maximum over the level's full minutes.

## BEFORE afb830e (3 runs)

- `tests/load/results/o-pre-8175-1`: deployed afb830e; runner azure=centralus vm=Standard_D2ads_v7 cloudfront_pop=ORD58-P17; project-service host Platinum 8175M; DB 117 commits/s, 16717 tuples returned/s (whole run incl. setup)
- `tests/load/results/o-pre-8175-2`: deployed afb830e; runner azure=WestUS3 vm=Standard_D2ads_v6 cloudfront_pop=PHX52-P1; project-service host Platinum 8175M; DB 115 commits/s, 18209 tuples returned/s (whole run incl. setup)
- `tests/load/results/o-pre-8175-3`: deployed afb830e; runner azure=WestUS3 vm=Standard_D2ads_v6 cloudfront_pop=PHX52-P1; project-service host Platinum 8175M; DB 110 commits/s, 18318 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 75 (74–76) | 20 (20–20) | 0.00 (0.00–0.00) | 134 (126–142) | 644 (632–653) | 950 (921–957) | 726 (712–754) | 54 (54–55) | 48 (42–52) | 100 (99–100) | 42 (40–48) | 31 (27–35) | 3.3 (3.2–3.3) | 1.3 (1.3–1.3) |
| 100 | 67 (65–68) | 18 (17–18) | 0.00 (0.00–1.3) | 945 (910–963) | 1949 (1942–2167) | 2987 (2733–3528) | 2020 (2015–2303) | 36 (36–37) | 31 (23–34) | 100 (100–100) | 37 (37–38) | 26 (25–40) | 3.6 (3.6–3.7) | 1.2 (1.2–1.3) |
| 200 | 54 (54–57) | 14 (14–15) | 0.00 (0.00–0.26) | 3181 (3117–3212) | 5200 (4816–5373) | 6213 (5614–7392) | 5073 (4697–5183) | 24 (22–24) | 35 (24–49) | 100 (100–100) | 33 (31–35) | 32 (27–36) | 4.4 (4.3–4.6) | 1.3 (1.3–1.4) |

## AFTER 4b22d57 (2 runs)

- `tests/load/results/o-cur-8175-1`: deployed 4b22d57; runner azure=westus vm=Standard_D2ads_v5 cloudfront_pop=SFO53-P4; project-service host Platinum 8175M; DB 131 commits/s, 14716 tuples returned/s (whole run incl. setup)
- `tests/load/results/o-cur-8175-2`: deployed 4b22d57; runner azure=centralus vm=Standard_D2ads_v5 cloudfront_pop=ORD58-P17; project-service host Platinum 8175M; DB 140 commits/s, 16835 tuples returned/s (whole run incl. setup)

| VUs | req/s | writes/s | errors % | p50 ms | p95 ms | p99 ms | board p95 ms | hit % | 409s | project-service CPU % | api-gateway CPU % | RDS CPU % | project-service CPU-ms/req | api-gateway CPU-ms/req |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 84 (84–85) | 23 (22–23) | 0.00 (0.00–0.00) | 78 (67–90) | 422 (419–425) | 875 (698–1052) | 412 (397–426) | 57 (56–58) | 49 (42–56) | 98 (98–98) | 52 (51–53) | 24 (21–26) | 2.9 (2.9–2.9) | 1.4 (1.4–1.5) |
| 100 | 84 (83–86) | 22 (22–23) | 0.77 (0.00–1.5) | 628 (608–648) | 1426 (1357–1495) | 3350 (1662–5037) | 1446 (1379–1514) | 43 (42–43) | 42 (35–48) | 100 (100–100) | 51 (50–51) | 25 (24–26) | 2.8 (2.7–2.9) | 1.3 (1.3–1.4) |
| 200 | 71 (70–72) | 19 (19–19) | 0.00 (0.00–0.00) | 2368 (2368–2368) | 3781 (3631–3931) | 5077 (4222–5932) | 3509 (3393–3626) | 25 (25–26) | 44 (43–45) | 100 (100–100) | 44 (44–44) | 28 (26–29) | 3.4 (3.2–3.5) | 1.5 (1.4–1.5) |

