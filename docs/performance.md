# Performance

How this system was load-tested, the criteria fixed before any measurement, and what was
measured. Every number here comes from a recorded run against the AWS dev environment; nothing
is estimated. Each result names the deployed commit it was measured on.

## Method

- **Load generator:** k6 1.3.0 on a GitHub-hosted runner (2 vCPU, 7 GiB), started by
  `.github/workflows/load.yml`, never on a developer machine. The target is the public CloudFront
  URL, so every request crosses the real edge, load balancer and gateway.
- **One measured run:** `scripts/load/run.sh <label> <http|realtime> <scenario> "<k6 env>"`. It
  records what was measured (deployed SHA, task counts and sizes, each task's host CPU model, RDS
  burst balances, the exact k6 parameters), snapshots service metrics and PostgreSQL statistics
  before and after, polls gauges during the run, and writes a report. Raw evidence stays in
  `tests/load/results/<label>/`, which is not committed.
- **Workloads** (`tests/load/http.js`, `SCENARIO=`):

  | Scenario        | Mix                                                                                                                                                                  |
  | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `balanced`      | 70 % reads (board 35, task 10, activity 10, project list 10, workspace list 5), 30 % writes (create, update, move 7 each; assign 3, unassign 2, comment 3, delete 1) |
  | `read-heavy`    | 80 % board reads, no writes                                                                                                                                          |
  | `write-heavy`   | 80 % writes                                                                                                                                                          |
  | `hot-project`   | balanced, all users on one project                                                                                                                                   |
  | `multi-project` | balanced, users spread over 60 projects                                                                                                                              |

  `tests/load/realtime.js` holds WebSocket subscribers open while a probe writes tasks, and
  measures notify-after-commit: from the writer's HTTP 201 to that event arriving on the
  writer's own socket.

- **Tenant:** 100 users, 10 workspaces, 20 projects, 20 seed tasks per project, namespaced per
  run. Think time 0–1 s per virtual user (VU); each VU mutates only its own tasks.
- **Ladders:** one run steps through load levels (`LADDER=50,100,200 STEP=3m`) after a 1 min
  warm-up that is excluded. Every sample is tagged with its level.
- **Repeats:** 3 runs per configuration unless stated. A cell is the median across runs, with
  the range in brackets. Latency is the median of each run's own k6 percentile, never a pooled
  percentile.
- **CPU per request:** mean CPU over the level's full minutes × vCPU × tasks ÷ req/s.

### Comparability rules

These were learned the hard way and are applied to every comparison below:

- **Same host CPU model.** Fargate places each new task on whatever host is available. The same
  code measured 2.7 CPU-ms/request on a Xeon 8259CL host and 2.8–2.9 on an 8175M. A September
  before/after comparison across hosts overstated an optimisation's effect about fourfold, and
  was replaced by a controlled re-measurement. Results are compared only within one host model.
- **RDS storage burst.** A `db.t4g.micro` has burstable storage throughput. About 3.5 h of
  sustained benchmark writes emptied it; commits then took over 15 s and requests failed. Every
  run records the burst balance first, and runs started on an empty balance are discarded.
- **Load-generator location.** GitHub cannot pin a runner's region, so each run records it.
  Throughput at saturation is server-bound; latency comparisons across runs carry this caveat.

## Success criteria (fixed before measuring)

A load level counts as **sustained** only if all of these hold over its steady phase:

| Signal         | Criterion                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Request errors | < 1 % (409 version conflicts are expected under contention and counted separately)                     |
| Latency        | overall p95 < 500 ms and p99 < 1500 ms; every operation p95 < 1000 ms                                  |
| Outbox         | pending count not growing at the end (≤ one poll batch, 50), oldest pending < 5 s                      |
| Consumers      | no dead letters or retries caused by load; lag returns to about 0 after the run                        |
| Database       | no sustained pool waiting; RDS CPU below 90 % per-minute maximum                                       |
| Services       | no ECS task restarts; CPU below 90 % per-minute maximum                                                |
| Realtime       | > 99 % of sockets subscribe; notify-after-commit p95 < 2 s; ≥ 99 % of expected notifications delivered |

The **saturation point** is the first level at which any criterion fails, together with the
component that explains it. The thresholds have not been changed since they were set.

## Environment

AWS us-east-2 dev environment: one Fargate task per service, each 0.25 vCPU / 0.5 GiB; RDS
PostgreSQL 17 `db.t4g.micro`; MSK 2 × `kafka.t3.small` (`domain.events` with 3 partitions);
ElastiCache Valkey `cache.t4g.micro`. Project Service database pool 10, other services 4; outbox
poll 500 ms, batch 50; board cache TTL 300 s. This is a deliberately small deployment: the point
is to find where it saturates and why, not to report large numbers.

## Results (measured 2026-10-17, commits `4b22d57` and `0819abc`)

Host CPU Xeon Platinum 8259CL unless stated. At this time `min.insync.replicas` was 1 and outbox
retention did not exist.

### Saturation and bottleneck

| Balanced, at 100 VUs | Value                       |
| -------------------- | --------------------------- |
| Throughput           | 92 req/s (saturated)        |
| p95                  | 1.3 s (fails the criterion) |
| Errors               | 0 %                         |
| Project Service CPU  | 97–100 %                    |
| RDS CPU              | ≤ 22 %                      |

Balanced load saturates between 50 and 100 VUs, at about 90 req/s. **The bottleneck is Project
Service CPU** on its 0.25 vCPU: requests queue behind a saturated event loop, and the database
pool's waiting requests are a symptom of that, not the cause (RDS stayed mostly idle).

A CPU profile showed query building as the largest share of busy CPU. Loading the board in one
JSON-aggregating statement instead of several queries cut Project Service CPU per request by 22 %
and raised saturated throughput by 25–31 %, measured as a controlled A/B on the same host model
(before ×3, after ×2).

### Board cache on vs off

Only `CACHE_ENABLED` changed between arms: same image, same host model.

| Read-heavy                     | Cache on        | Cache off       |
| ------------------------------ | --------------- | --------------- |
| req/s at 200 VUs (saturated)   | 163 (162–163)   | 142 (141–143)   |
| p50 / p95 / p99 at 100 VUs     | 105 / 450 / 704 | 141 / 509 / 769 |
| Project Service CPU-ms/request | 1.5             | 1.8             |
| Database tuples returned/s     | 2.4k–8.0k       | 30k–39k         |

| Balanced                    | Cache on     | Cache off    |
| --------------------------- | ------------ | ------------ |
| req/s at 50 / 100 / 200 VUs | 90 / 92 / 76 | 91 / 94 / 77 |
| p95 at 100 VUs              | 1265 ms      | 1198 ms      |
| Server hit rate at 100 VUs  | 42 %         | –            |
| Database tuples returned/s  | 18k–20k      | 27k–32k      |

The cache cuts database work 4–14× on read-heavy load, but adds only 13 % throughput there and
none on balanced load, because the bottleneck is Project Service CPU in both arms. Under balanced
load about 20 writes/s over 20 boards invalidate each board roughly once a second, and the cache
path's own cost (round trips, serialisation, generation checks, write-back) is about what it
saves. **At this scale the cache is justified by database offload and headroom, not by latency
or throughput.**

### Workload shape

| At 100 VUs                 | req/s | p95    | errors | hit rate | CPU-ms/req |
| -------------------------- | ----- | ------ | ------ | -------- | ---------- |
| read-heavy                 | 159   | 450 ms | 0 %    | 100 %    | 1.6        |
| balanced, 20 projects      | 92    | 1.3 s  | 0 %    | 42 %     | 2.7        |
| multi-project, 60 projects | 109   | 1.0 s  | 0 %    | 56 %     | 2.3        |
| hot-project, 1 project     | 27    | 5.3 s  | 0 %    | ~0 %     | 9.3        |
| write-heavy, 80 % writes   | 58    | 5.1 s  | 7.4 %  | –        | –          |

- **Hot project:** the board read returns every task in the project, unpaginated (71 KB versus
  12 KB), and every write invalidates it. The board read is O(tasks in the project).
- **Write-heavy** fails the error criterion: multi-statement write transactions hold pool
  connections while their continuations wait for the saturated event loop, and requests time out
  acquiring one (503). The invariants audit afterwards found no partial commits.

### Horizontal scaling

A second Project Service task doubled saturated read-heavy throughput (151–156 → 298–312 req/s)
and moved the bottleneck to the single gateway task, whose profile showed only the inherent work
of a two-hop HTTP proxy. The gateway handles about 300 req/s per 0.25 vCPU task and scales
horizontally.

### Outbox publisher

At 25 VUs write-heavy (below the error onset), about 30–33 successful writes/s: events created
and published matched in every 30 s bucket, the backlog peaked at 19, and publication lag was
p50 0.27 s, p95 0.51 s, max 1.2 s, with the publisher at a third of its CPU. Batch publishing is
not justified at these rates and was not implemented.

### WebSockets

| Connections               | delivered / expected | notify-after-commit p50 / p95 | realtime CPU |
| ------------------------- | -------------------- | ----------------------------- | ------------ |
| 100, 1 replica            | 1,500 / 1,500        | 240 / 504 ms                  | ≤ 31 %       |
| 1,000, 1 replica          | 15,000 / 15,000      | 236 / 502 ms                  | ≤ 33 %       |
| 500, 2 replicas           | 7,475 / 7,475        | 275 / 503 ms                  | ≤ 26 %       |
| 1,000 at once, 2 replicas | 14,950 / 14,950      | 272 / 500 ms                  | ≤ 40 %       |

Notification latency does not depend on connection count; its p95 of about 0.5 s is set by the
publisher's 500 ms poll interval. 1,000 connections used a third of one replica's CPU, so it is
not the service's limit; the load generator was. Every client on either replica received every
event (ADR-017).

### Soak: 30 minutes, balanced at 40 VUs

Passed the criteria (p95 160 ms, errors 0.26 %, every event published and consumed, flat memory),
but from about 22 minutes in, every second minute showed slower responses and a few 503s while
RDS CPU rose, coinciding with automatic `ANALYZE` runs on `outbox_events`. At the time published outbox
rows were never deleted, so the table only grew. This led to outbox retention
([ADR-011](adr/011-transactional-outbox.md)).
