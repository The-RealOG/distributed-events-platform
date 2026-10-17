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

> **Superseded (2026-10-17).** The before/after figures in this subsection compare runs on different, unrecorded compute and overstate the effect. The controlled re-measurement below replaces them; they are kept unchanged as the original record.

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

### Optimization 1, controlled re-measurement (2026-10-17): `tests/load/results/o-opt1-ab.md`

**Why it was re-measured.** On 2026-10-17 the balanced ladder on the optimized code (`4b22d57`: same
application code as `4d3ff72`, identical task definitions) gave 92 req/s at 100 VUs in 3 of 3 runs
(92–92). That is the September _baseline_, not 184. In the September "after" run, api-gateway also
needed 27 % less CPU per request (1.68 → 1.22 CPU-ms; its code and configuration had not changed).
Payload size (about 12 KB per request) and the unsaturated hit rate (57–58 %) were the same in all
runs. The September after-run therefore also ran on different compute: every deploy places new
Fargate tasks, and the host CPU was not recorded (bug ledger #25).

**Design.**

- **Arms:** before = `afb830e`, after = `4b22d57`. Between them the only runtime difference is the
  board read path (3 project-service files). There are no differences in migrations, lockfile,
  Dockerfile or the other six services.
- **Same session:** both arms ran in this session, with project-service on the **same host CPU
  model (Xeon Platinum 8175M)** and 1 task of 0.25 vCPU.
- **Workload:** balanced ladder 50/100/200 VUs, 3 min steps after a 1 min warm-up; 100 users,
  10 workspaces, 20 projects.
- **Runs:** before ×3, after ×2.

Cells: median across runs (min–max); latency is the median of each run's own k6 percentile.

| VUs | req/s before → after | p95 before → after | project-service CPU-ms/request before → after |
| --- | -------------------- | ------------------ | --------------------------------------------- |
| 50  | 75 → 84              | 644 → 422 ms       | 3.3 → 2.9                                     |
| 100 | 67 → **84 (+25 %)**  | 1949 → **1426 ms** | 3.6 → **2.8 (−22 %)**                         |
| 200 | 54 → 71 (+31 %)      | 5200 → 3781 ms     | 4.4 → 3.4                                     |

- **Result:** the optimization is real and kept. It cuts project-service CPU per request by about
  22 % and raises saturated throughput by about 25–31 % on the same host type. It does **not**
  double sustained throughput, and on this deployment no level of the balanced ladder meets the
  latency criteria at 100 VUs, before or after.
- **Host effect, measured:** the same optimized code costs 2.7 CPU-ms/request on a Xeon 8259CL
  task (92 req/s at 100 VUs) and 2.8–2.9 on an 8175M task (84 req/s). Comparisons are therefore
  made only within one host model. Every run's `meta.txt` records it.

## Recovery: outbox publisher outage (`tests/failure/results/publisher-outage.txt`)

- **Injection:** the publisher was scaled to 0 tasks and 300 tasks were created: 300 of 300 returned 201 in 6.4 s, and reads kept working.
- **Recovery:** the publisher was scaled back to 1. It then published the 300 backlog events in **5.42 s (about 55 events/s)**, counted from the publisher's own log lines.
- **Visibility:** the last backlog event appeared in the activity feed 39 s after the scale-up command. That figure includes the ECS task start.
- **Headroom:** about 55 events/s is the single-stream publisher's ceiling (one send in flight, `acks=-1`). That is roughly twice the API's peak write rate before optimization and about the same as after it (57.9 writes/s at 250 VUs). The publisher still kept up with 0 pending in both runs, but its headroom is now small; see the handoff list.

## Phase 10 session, 2026-10-17

### Environment and method (applies to every result below)

- **AWS us-east-2, dev**, as in the September runs: one Fargate task per service, each **0.25 vCPU /
  0.5 GiB**; RDS PostgreSQL 17 `db.t4g.micro`; MSK 2 × `kafka.t3.small`; Valkey `cache.t4g.micro`.
- **Deployed code:**
  - Experiment A and the Optimization 1 A/B: `4b22d57`.
  - From 14:40Z: `0819abc`. It differs from `4b22d57` only by the 503 mapping fix (bug ledger #27),
    which is not on the request hot path.
- **Host CPU** (recorded per task in each run's `meta.txt`): Xeon Platinum 8259CL for every run
  below, unless stated otherwise. Comparisons are made only within one host model (bug ledger #25).
- **Load generator:** k6 1.3.0 on GitHub-hosted runners (2 vCPU, 7 GiB). Their Azure region cannot
  be controlled, so each run records it in `runner.txt` (eastus, eastus2, centralus, northcentralus,
  southcentralus, westus, westus2, westus3 occurred). Throughput at saturation is server-bound.
  Latency comparisons across runs carry that caveat.
- **Ladder:** 1 min warm-up at the lowest level, excluded from results. Then 3 min per level, with
  100 users / 10 workspaces / 20 projects / 20 seed tasks unless stated.
- **Repeats and cells:** 3 runs per configuration unless stated. Cells are the median across runs
  (min–max). Latency is the median of each run's own k6 percentile, never a pooled percentile.
- **CPU-ms/request:** mean CPU over the level's full minutes × vCPU × tasks ÷ req/s
  (`scripts/load/compare.py`).
- **Database work:** `pg_stat_database` deltas (`pgstats.sh`). Commits approximate statements.
- **Database storage burst:** a `db.t4g.micro` has burstable EBS throughput.
  - About 3.5 h of sustained benchmark writes emptied it (`EBSByteBalance%` 0 at 13:00Z). Commits
    then exceeded 15 s and requests failed. The affected runs are in `results/invalid/`.
  - RDS was replaced with the same class, and every later run records the balance before starting
    (99–100 % for all runs below). A real deployment needs a non-burstable class or provisioned
    throughput for sustained writes.

### Experiment A: Redis board cache ON vs OFF (`results/a-cache-on.md`, `results/a-cache-off.md`)

Only `CACHE_ENABLED` changed: one task-definition revision, the same image and the same host
model. With the cache off, board reads take the same code path as a cache miss.

| Read-heavy (80 % board reads, no writes) | Cache ON        | Cache OFF       | Difference |
| ---------------------------------------- | --------------- | --------------- | ---------- |
| req/s at 100 VUs                         | 159 (153–167)   | 149 (147–153)   | −6 %       |
| req/s at 200 VUs (saturated)             | 163 (162–163)   | 142 (141–143)   | −13 %      |
| p50 / p95 / p99 at 100 VUs               | 105 / 450 / 704 | 141 / 509 / 769 | slower     |
| project-service CPU-ms/request, 200 VUs  | 1.5             | 1.8             | +20 %      |
| RDS CPU (per-minute max)                 | 8–11 %          | 15–16 %         | +6 pts     |
| DB tuples returned/s (whole run)         | 2.4k–8.0k       | 30k–39k         | 4–14×      |
| DB commits/s (whole run)                 | 125–135         | 190–201         | +50 %      |

| Balanced (70/30)                        | Cache ON         | Cache OFF        | Difference |
| --------------------------------------- | ---------------- | ---------------- | ---------- |
| req/s at 50 / 100 / 200 VUs             | 90 / 92 / 76     | 91 / 94 / 77     | none       |
| p95 at 50 VUs                           | 407 (381–416)    | 305 (298–324)    | OFF lower  |
| p95 at 100 VUs                          | 1265 (1256–1326) | 1198 (1140–1278) | none       |
| project-service CPU-ms/request, 100 VUs | 2.7              | 2.5              | none       |
| server hit rate at 50 / 100 VUs         | 57 % / 42 %      | –                |            |
| DB tuples returned/s (whole run)        | 18k–20k          | 27k–32k          | 1.5×       |

**Interpretation:**

- The cache reduces database work substantially, by 4–14× in tuples on read-heavy.
- It adds only modest throughput on read-heavy (+13 % at saturation) and none on balanced. The
  bottleneck is project-service CPU in both configurations, and the database was never limiting
  (RDS ≤ 22 %).
- Under balanced load, about 20 writes/s spread over 20 boards invalidate each board roughly once a
  second. The cache path's own CPU (Redis round trips, serialization, generation checks and
  write-back) then costs about what it saves.
- **At this scale, Redis is justified by database offload and headroom, not by latency or
  throughput.**
- At saturation the Redis client also timed out on a starved event loop: 214 of 219 errors in one
  run, while Redis engine CPU stayed ≤ 1.6 %. Each timeout falls back to PostgreSQL, so it adds
  work exactly when capacity is shortest.

### Experiment B: workload characterization

| At 100 VUs (median of runs)     | req/s | p95    | errors | hit rate | CPU-ms/req | evidence          |
| ------------------------------- | ----- | ------ | ------ | -------- | ---------- | ----------------- |
| read-heavy                      | 159   | 450 ms | 0 %    | 100 %    | 1.6        | `a-cache-on.md`   |
| balanced, 20 projects           | 92    | 1.3 s  | 0 %    | 42 %     | 2.7        | `a-cache-on.md`   |
| multi-project, 60 projects (×2) | 109   | 1.0 s  | 0 %    | 56 %     | 2.3        | `b-hot-multi.md`  |
| hot-project, 1 project (×2)     | 27    | 5.3 s  | 0 %    | ~0 %     | 9.3        | `b-hot-multi.md`  |
| write-heavy, 80 % writes (×3)   | 58    | 5.1 s  | 7.4 %  | –        | –          | `b-write-{1,2,3}` |

- **Hot project.** The single shared board returns every user's tasks, unpaginated: 71 KB per
  response against 12 KB for balanced. Every write invalidates it, so nearly every read rebuilds
  it.
  - Throughput falls as VUs rise (41 → 27 → 23 req/s) and CPU per request is 2–4× balanced.
  - Expected 409 conflicts (70–148 per level) are counted separately: 0.03 % 5xx at most.
  - The outbox kept up, with only 5–10 writes/s on one partition.
  - **The board read is O(tasks in the project).**
- **Multi-project.** Spreading the same users over 60 projects means fewer invalidations per board,
  so the hit rate is higher (56 %), each request is cheaper and throughput is about 18 % above
  balanced. Per-project Kafka keys over 3 partitions created no measurable difference for the
  publisher at these rates.
- **Write-heavy at 50–200 VUs** failed the error criterion at every level (5–18 % 5xx).
  - Project-service CPU was 95–100 %. Its 10-connection pool sat full with up to 118 waiters,
    because multi-statement write transactions hold a connection while their continuations wait
    for the saturated event loop.
  - After the pool's 5 s connect timeout these requests failed. They returned 500 until the fix in
    bug ledger #27, and 503 after it.
  - No partial commits resulted: the invariants audit after all load passed (213,658 events).

### Publisher capacity (`results/d-publisher-{1,2}/outbox-rates.txt`)

Write-heavy at a fixed 25 VUs, below the error onset, 8 min, ×2. Arrival and publication are
measured by PostgreSQL over the same 30 s buckets (`created_at` and `published_at`).

| Run | successful writes/s | errors | created vs published per bucket | max backlog | lag p50 / p95 / p99 / max  | publisher CPU |
| --- | ------------------- | ------ | ------------------------------- | ----------- | -------------------------- | ------------- |
| 1   | 32.5                | 0 %    | equal in every bucket (31–34/s) | 19          | 0.27 / 0.51 / 0.60 / 1.2 s | ≤ 34 %        |
| 2   | 29.9                | 0 %    | equal in every bucket (29–32/s) | 18          | 0.28 / 0.51 / 0.62 / 1.2 s | ≤ 38 %        |

- **The sustainable write rate of this deployment is about 30–33 successful writes/s**
  (project-service at 67–93 % CPU). At that rate the single-stream publisher keeps up, with
  sub-second lag, at about a third of its CPU.
- The large backlogs in the 50–200 VU write-heavy runs (peak 1,990, mean lag about 7 s) occurred
  only after the API itself was saturated and its pool exhausting.
- **Batch publishing is not justified by these measurements and was not implemented.** The
  earlier recovery figure (about 55 events/s draining a backlog, September) is a drain rate, not a
  steady-state limit, and was not re-measured.

### Experiment C: api-gateway CPU and horizontal scaling (`results/c-scale-out.md`, `results/c-profile-2task/`)

| Read-heavy           | 1 project-service task | 2 project-service tasks (×2) |
| -------------------- | ---------------------- | ---------------------------- |
| req/s at 100 VUs     | 158                    | 188 (188–189)                |
| req/s at 200 VUs     | 156                    | 298 (297–298)                |
| req/s at 300 VUs     | 151                    | 312 (310–314)                |
| p95 / p99 at 200 VUs | 1437 / 1961 ms         | 485 / 700 ms                 |
| project-service CPU  | 99–100 %               | 91–94 %                      |
| api-gateway CPU      | 67–70 %                | **99–100 %**                 |
| errors               | 0 %                    | 0 %                          |

- **Scaling.** A second project-service task (same host model) roughly **doubled saturated
  throughput (151–156 → 298–312 req/s, 2.0×)**. The bottleneck then moved to the single
  api-gateway task.
  - Two gateway tasks were not tested (NOT RUN; optional in the plan).
  - The scale was set through Terraform variables and restored to 1 task. Plan exit 0 afterwards.
- **Gateway profile.** Taken during a 250-VU load verified steady before and after: ALB 295–307
  req/s, gateway CPU 97–99 %.
  - Busy time is the inherent work of an HTTP proxy: Node's HTTP core parsing and writing headers
    on two hops (26.7 % of samples; largest single function `_addHeaderLine` 5.2 %) and
    `@fastify/reply-from`/undici (about 13.5 %).
  - Per-request logging (pino plus redaction, 8 %), GC (5 %), Fastify, helmet, CORS and
    prom-client account for the rest.
  - **There is no single inefficiency, so there was no code change.** The gateway's capacity is
    about 300 req/s per 0.25 vCPU task (about 0.8 CPU-ms/request) and it scales horizontally.
    Turning off per-request info logging would save about 10 % of busy CPU, at the cost of
    observability. Not done.
- The earlier profiling run of this session (`results/invalid/c-profile-load`) is not a CPU profile: it was
  taken after the storage-throttled database had already failed the load.

### Experiment D: WebSocket load (`results/e-ws-*`)

Subscribers spread over 20 projects hold a socket for 3 min. A probe VU creates 300 tasks
(2/s) in one project and measures **notify-after-commit** on one clock: from receiving the HTTP 201
(the commit is already done) to receiving that task's event on its own socket. This interval covers
the outbox poll, Kafka, the realtime consumer, the WebSocket send and the network back to the
client. It is not browser-to-browser end-to-end. Expected deliveries are the subscribers on the
probe's project × the probe's events.

| Run                                           | subscribed | delivered / expected | notify-after-commit p50 / p95 / p99 | connect p50 / p95 / max | realtime CPU | gateway CPU |
| --------------------------------------------- | ---------- | -------------------- | ----------------------------------- | ----------------------- | ------------ | ----------- |
| 100 connections, 1 replica                    | 100 %      | 1,500 / 1,500        | 240 / 504 / 550 ms                  | 104 / 121 / 152 ms      | ≤ 31 %       | ≤ 46 %      |
| 500 connections, 1 replica                    | 100 %      | 7,500 / 7,500        | 244 / 520 / 547 ms                  | 105 / 115 / 312 ms      | ≤ 34 %       | ≤ 43 %      |
| 1,000 connections, 1 replica                  | 100 %      | 15,000 / 15,000      | 236 / 502 / 551 ms                  | 108 / 117 / 426 ms      | ≤ 33 %       | ≤ 44 %      |
| 500 connections, **2 replicas**               | 100 %      | 7,475 / 7,475        | 275 / 503 / 547 ms                  | 105 / 112 / 265 ms      | ≤ 26 %       | ≤ 29 %      |
| 1,000 at once (**storm**, RAMP=0), 2 replicas | 100 %      | 14,950 / 14,950      | 272 / 500 / 513 ms                  | 3.0 s / 5.1 s / 5.5 s   | ≤ 40 %       | ≤ 61 %      |

- **Notification latency does not depend on the connection count.** Its p95 of about 0.5 s is set
  by the outbox publisher's 500 ms poll interval. One replica at 1,000 open connections used a third
  of its CPU, so 1,000 is not this service's limit. Higher counts were not tested; the 2-vCPU load
  generator is the practical limit of this harness.
- **Multiple replicas.** Clients were spread across both replicas: the new replica's own broadcast
  counter rose from 0 to 3,887 during the run (`replicas.txt`). Every client received every event,
  so the one-consumer-group-per-replica fanout (ADR-017) works as deployed, without Redis Pub/Sub.
- **Reconnect storm.** 1,000 simultaneous connects were all accepted, with no auth timeouts and no
  server closes. Connection setup slowed to 3–5 s while the upgrades queued, and live delivery
  latency was unchanged.
  - k6 connects without the web client's exponential backoff and jitter, which is covered by the
    web unit tests. This run tests the server side of a storm.
- **Slow clients** (bounded send buffer) were not exercised on AWS. They are covered by the
  realtime integration tests (backpressure), which can control a client's read rate.
- **Load-generator caveat.** The first WebSocket runs were invalid: the harness busy-waited and
  starved k6 (bug ledger #28). They are kept under `results/invalid/`.

### Soak: 30 minutes, balanced at 40 VUs (`results/f-soak-http/`)

The 40-VU level is moderate, below the about-50-VU saturation of balanced. The load workflow
allows one run at a time, so the WebSocket half (200 connections held for 30 min,
`results/f-soak-ws/`) ran right after it, not alongside.

- **Against the fixed criteria: PASS.**
  - Overall p50 / p95 / p99: 32 / 160 / 476 ms. Errors 0.26 % (134 × 503, plus 724 expected 409s
    counted separately). 20.0 successful writes/s.
  - Outbox: 35,561 events, 0 pending at the end. Each consumer processed all 35,561 with 0 retries
    and 0 dead-lettered.
- **Flat, so no leak.** Memory per service is flat after warm-up (project-service 27–28 %,
  api-gateway 18 %, realtime 18–19 %). RDS connections stay at 12–13. Throughput held at 77–80
  req/s for the first 21 minutes.
- **An emerging periodic degradation (sustained, not a one-off spike).** From about 22 minutes in,
  every second minute (21:10, 21:12, 21:14, 21:16, 21:18Z) shows:
  - mean ALB target response 77–148 ms (about 22 ms otherwise);
  - 19–47 × 503 (pool acquisition timeouts);
  - throughput dips to 63–71 req/s;
  - project-service CPU _falling_ to 55–59 % while RDS CPU rises: requests waiting on the
    database.
- **What the database log shows for those minutes:**
  - `automatic analyze of table "outbox_events"` at 21:14:15, 21:16:15 and 21:18:15;
  - `could not accept SSL connection: EOF detected` from the app subnet, meaning new connections
    took longer than the pool's 5 s connect timeout. Checkpoints (5 min, spread over 270 s) do not
    match the period.
- **Interpretation (correlation, not proven causation).**
  - Published outbox rows are never deleted, so `outbox_events` only grows and its maintenance
    keeps getting heavier on a `db.t4g.micro`.
  - Under a burst, the pool re-opens connections (pg-pool idle timeout 10 s), and each TLS +
    SCRAM handshake competes for the same small instance.
  - Next steps, not done in Phase 10: outbox retention, pool idle and minimum settings, and a
    longer soak to confirm the trend.

**WebSocket half (`results/f-soak-ws/`, 21:19–21:51Z).** 200 connections were held for 30 min while
the probe wrote 2 tasks/s.

- 100 % subscribed for the whole run, with no server closes.
- Delivery 35,320 / 35,320 expected (3,532 events × 10 subscribers on the probe's project).
- Notify-after-commit p50 / p95 / p99: 248 / 500 / 510 ms (max 1.7 s).
- realtime-service memory flat at 19.4–20.1 % and CPU at about 14.5 %, so no leak.
