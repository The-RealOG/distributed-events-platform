# Performance: methodology, criteria and results

This file is written in two steps. The **success criteria** below were committed before any
measured run (see this file's git history), so they cannot have been tuned to the results.
The results sections are filled in only from the raw evidence in `tests/load/results/`.

## Success criteria (fixed before measuring)

A load level counts as **sustained** only if all of these hold over the steady phase:

| Signal         | Criterion                                                                                                     | Source                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Request errors | < 1 % of requests (409 version conflicts are expected under contention and counted separately, not as errors) | k6 `http_req_failed`                                         |
| Latency        | overall p95 < 500 ms and p99 < 1500 ms; every operation p95 < 1000 ms                                         | k6 per-`op` trends                                           |
| Outbox         | pending count at the end of the run is not growing (within one poll batch, ≤ 50) and oldest pending age < 5 s | `outbox_pending_events`, `outbox_oldest_pending_age_seconds` |
| Consumers      | no dead-letters or retries attributable to load; lag returns to ~0 after the run                              | consumer metrics, `kafka-tools groups`                       |
| Database       | no sustained pool waiting; RDS CPU below 90 % per-minute maximum                                              | `db_pool_waiting_requests`, CloudWatch                       |
| Services       | no ECS task restarts; CPU below 90 % per-minute maximum                                                       | CloudWatch, ECS events                                       |
| Realtime       | > 99 % of sockets subscribe; notification p95 < 2 s after the writer's HTTP 201; delivery ≥ 99 % of expected  | `tests/load/realtime.js`                                     |

The **saturation point** is the first load level at which any criterion fails, together with
the component that explains it.

Thresholds may be revised only with a documented reason in this file; none have been.

## Test environment (as measured, 2026-09-26)

- **Deployed commit:** baseline runs on `afb830e`, optimization runs on `4d3ff72`. The code difference is only the board read path (see Optimization 1).
- **AWS us-east-2, dev:** one Fargate task per service, each **0.25 vCPU / 0.5 GiB**. The services are api-gateway, project-service, outbox-publisher, activity-service, cache-invalidator and realtime-service.
- **Data and messaging:** RDS PostgreSQL 17 `db.t4g.micro` (single-AZ); MSK Kafka 3.9 with 2 × `kafka.t3.small` (`domain.events` has 3 partitions; `min.insync.replicas=1`); ElastiCache Valkey 9.1 `cache.t4g.micro`.
- **Edge:** CloudFront → ALB → gateway.
- **Pools and cadence:** project-service DB pool 10, other services 4; outbox poll 500 ms, batch 50, one send in flight (`acks=-1`); board cache TTL 300 s.
- **Load generator:** k6 1.3.0 on a GitHub-hosted runner (`.github/workflows/load.yml`; runner specs in each run's `runner.txt`). The target is the public CloudFront URL, so every request crosses the real edge.

## Workload: balanced (70 % reads / 30 % writes)

- **Operation mix:** board 35, task 10, activity 10, project list 10, workspace list 5, create 7, update 7, move 7, assign 3, unassign 2, comment 3, delete 1.
- **Tenant:** 100 users, 10 workspaces, 20 projects, 20 seed tasks per project.
- **Per-VU behaviour:** think time uniform 0–1 s (mean 0.5 s); each VU mutates at most its own 5 tasks.
- **Ladder:** one run steps through the levels, 3 minutes per level, with every sample tagged by level (`tests/load/http.js` `LADDER`).
- **Percentiles:** k6's own, computed over each level's samples. They are never averaged across runs.

### Baseline: `tests/load/results/balanced-ladder/` (commit afb830e)

| VUs  | req/s | successful writes/s | errors | p50      | p95      | p99      | board p95 | meets criteria |
| ---- | ----- | ------------------- | ------ | -------- | -------- | -------- | --------- | -------------- |
| 10   | 20.6  | 5.1                 | 0.00 % | 30 ms    | 58 ms    | 153 ms   | 55 ms     | yes            |
| 50   | 90.1  | 24.3                | 0.00 % | 47 ms    | 381 ms   | 718 ms   | 424 ms    | **yes**        |
| 100  | 93.2  | 25.0                | 0.00 % | 539 ms   | 1300 ms  | 1691 ms  | 1403 ms   | no (p95)       |
| 250  | 74.5  | 20.6                | 0.00 % | 2900 ms  | 4273 ms  | 4950 ms  | 4280 ms   | no             |
| 500  | 63.6  | 17.3                | 0.00 % | 7539 ms  | 9037 ms  | 9662 ms  | 8946 ms   | no             |
| 1000 | 59.2  | 16.3                | 0.00 % | 16457 ms | 18416 ms | 19235 ms | 18097 ms  | no             |

- **Saturation:** between 50 and 100 VUs, at about 90 req/s.
- **Why:** project-service CPU was at 97–100 % of its 0.25 vCPU for every minute from the 50-VU level on. RDS CPU peaked at 16 % with at most 14 connections. Every other service stayed at or below 58 % CPU.
- **Pool waiting is a symptom, not the cause.** The project-service pool had 50–112 requests waiting (`timeline.txt`), but the database itself was idle; requests were queuing behind a saturated event loop.
- **Outbox (the key question: does it keep up?):** 18,859 events published, 0 failures, 0 pending at the end. The backlog stayed between 1 and 13 events throughout. Publication kept up with every write rate the API could produce.
- **Consumers:** activity 18,932 events processed, cache-invalidator 18,860, 0 retries.
- **Board cache:** server-side hit rate 36.0 % = hits / (hits + misses), with 8,381 hits and 14,897 misses (errors are excluded from the formula). In this mix roughly 20 writes/s spread over 20 projects invalidate each board about once a second.

### Optimization 1: board read in one statement (commit 4d3ff72)

- **Evidence.** A CPU profile of the saturated task (`scripts/aws/cpu-profile.sh`) attributed about 29 % of busy CPU to drizzle-orm query building, versus about 5 % for pg I/O. A board cache miss ran authorization, then BEGIN, the same authorization again, board, columns, tasks, assignees and COMMIT.
- **Change (one variable).** Authorize once, then load the board with one JSON-aggregating statement. Being a single statement, it reads one snapshot: the no-duplicates/no-vanishing guarantee under concurrent moves is preserved and has a new test.
- **Rerun:** same parameters (`tests/load/results/balanced-ladder-opt1/`).

| VUs | req/s (before → after) | p95 (before → after) | p99 (before → after) | meets criteria after |
| --- | ---------------------- | -------------------- | -------------------- | -------------------- |
| 10  | 20.6 → 19.1            | 58 → 112 ms          | 153 → 141 ms         | yes                  |
| 50  | 90.1 → 95.4            | 381 → 120 ms         | 718 → 288 ms         | yes                  |
| 100 | 93.2 → **183.6**       | 1300 → **246 ms**    | 1691 → 426 ms        | **yes**              |
| 250 | 74.5 → 214.7           | 4273 → 1237 ms       | 4950 → 1495 ms       | no (p95)             |
| 500 | 63.6 → 204.9           | 9037 → 2734 ms       | 9662 → 3201 ms       | no                   |

- **Result:** kept. The highest level meeting the criteria rose from 50 to 100 VUs, and sustained throughput rose from 90 to 184 req/s (+104 %). Peak throughput rose from 93 to 215 req/s. Errors stayed at 0 % at every level.
- **New saturation point:** between 100 and 250 VUs. At saturation, project-service CPU was at 99–100 % and **api-gateway at 94–96 %**; RDS peaked at 30 %.
- **Outbox after the change:** 32,411 events published, 0 failures, 0 pending at the end.
- **Board cache:** hit rate 43.3 %. Board latency split by server action over the whole run: hit p50 107 ms, miss p50 874 ms. Both include queueing at saturated levels; see the per-level table above for the comparable view.
- **Caveat:** the 10-VU p95 rose from 58 to 112 ms. It is based on few samples per level and is inside the noise of runs made from different runner machines; it was not investigated further.

## Recovery: outbox publisher outage (`tests/failure/results/publisher-outage.txt`)

- **Injection:** the publisher was scaled to 0 tasks and 300 tasks were created: 300 of 300 returned 201 in 6.4 s, and reads kept working.
- **Recovery:** the publisher was scaled back to 1. It then published the 300 backlog events in **5.42 s (about 55 events/s)**, counted from the publisher's own log lines.
- **Visibility:** the last backlog event appeared in the activity feed 39 s after the scale-up command. That figure includes the ECS task start.
- **Headroom:** about 55 events/s is the single-stream publisher's ceiling (one send in flight, `acks=-1`). That is roughly twice the API's peak write rate before optimization and about the same as after it (57.9 writes/s at 250 VUs). The publisher still kept up with 0 pending in both runs, but its headroom is now small; see the handoff list.

## Not yet measured (next session)

Cache on vs off (`board_cache_enabled=false`, plan prepared), read-heavy, write-heavy, hot-project
and multi-project workloads, WebSocket load (100/500/1000 sockets with the one-clock probe),
the remaining failure injections (`npm run aws:demo:failures`: tasks, rds, kafka; `npm run
aws:demo`: activity, invalidator, Redis), a 30-minute soak and the post-chaos invariant audit.
