# Distributed Project Platform

A project-management platform (workspaces, boards, tasks, comments, attachments) built to
practice distributed-systems engineering, with its claims backed by tests, experiments and
measurements on real AWS infrastructure.

## What it demonstrates

- **Authoritative state:** PostgreSQL, with optimistic concurrency (a stale `expectedVersion`
  returns 409).
- **Events that can't diverge from state:** a transactional outbox writes each change and its
  event in one transaction, and a separate publisher delivers events to Kafka (keyed by
  project, `acks=-1`).
- **Duplicate-safe consumers:** each consumer records `processed_events` in the same
  transaction as its side effect.
- **Read models:** an Activity feed projection, and a shared Redis board cache invalidated by
  Kafka events (never written or deleted from the request path).
- **Realtime collaboration:** WebSocket notifications fed only by committed events, delivered
  through every realtime replica, with invalidate-and-refetch clients.
- **Failure handling:** bounded retries with transient/permanent classification, and a DLQ
  with safe replay.
- **Attachments:** S3 presigned uploads and downloads; the API is only the control plane.
- **Observability:** Prometheus metrics with a cardinality guard, Grafana dashboards as code,
  and correlation IDs from browser to consumers.
- **Infrastructure and delivery:** Terraform for AWS (ECS Fargate, RDS, MSK, ElastiCache, ALB,
  CloudFront, S3), CI/CD through GitHub Actions and OIDC with no long-lived keys, and 81
  deliberate breaks ("mutations") that CI proves the tests catch.

```
Browser ─▶ CloudFront ─▶ ALB ─▶ api-gateway ─▶ project-service ─▶ PostgreSQL (state + outbox, one transaction)
   │                                 │                 └─▶ Redis (board cache, disposable)
   │  wss (relay)                    └─▶ realtime-service ◀─┐
   └─ presigned POST/GET ─▶ S3                              │
outbox-publisher ─▶ Kafka ─┬─▶ activity-service (+ DLQ) ─▶ PostgreSQL
                           ├─▶ cache-invalidator ─▶ Redis
                           └─▶ realtime-service (one group per replica) ─▶ WebSockets
```

Full diagram and details: [docs/architecture.md](docs/architecture.md). The guarantees are
stated precisely in [docs/consistency-and-delivery.md](docs/consistency-and-delivery.md).
Decisions are recorded in [docs/adr/](docs/adr/) (ADR-001 to ADR-022).

## Status

Phases 0–10 are complete. Phase 10 (measure, break, document) ran on AWS on 2026-10-17. The full
methodology and raw evidence are in [docs/performance.md](docs/performance.md) and
[docs/failure-testing.md](docs/failure-testing.md), and the defects found are in
[docs/bug-ledger.md](docs/bug-ledger.md) (#22–29 found in Phase 10). Phases 11–12 have not been
started.

Results in one paragraph:

- **Bottleneck:** project-service CPU (one 0.25 vCPU task) in every workload. A second task doubled
  saturated throughput, and the api-gateway then became the limit at about 300 req/s per 0.25 vCPU
  task.
- **Optimization 1:** the board read in one statement cuts CPU per request by 22 % in a controlled
  A/B. The earlier +104 % was a measurement error and is withdrawn.
- **Redis:** it offloads the database (4–14× fewer tuples read) but adds little throughput.
- **Outbox publisher:** it keeps up with the API's sustainable write rate, at sub-second lag.
- **WebSockets:** 1,000 connections are well within one replica.
- **Failure tests:** 14 of 17 failure scenarios pass on AWS. Three were not run: the S3 outage
  (needs an approved IAM change), and slow clients and DLQ replay, which are tested in CI only.
- **Integrity:** two data-invariant audits hold.
- **Limitations** (documented, not fixed): `min.insync.replicas=1` durability, non-idempotent POST
  retries, no rate limiting, unbounded outbox growth, a burstable database class, single tasks per
  service.

## Verified résumé evidence

Every number below was measured on 2026-10-17 on the AWS dev environment.

- **Environment:** ECS Fargate with **one 0.25 vCPU / 0.5 GiB task per service** unless stated;
  RDS `db.t4g.micro`; MSK 2 × `kafka.t3.small`; Valkey `cache.t4g.micro`; project-service on Xeon
  8259CL hosts unless stated.
- **Load:** k6 from GitHub-hosted runners through CloudFront.
- **"VUs"** are k6 virtual users with 0–1 s think time, not simultaneous real users.
- **"Sustained"** means it met the success criteria fixed before measuring (errors < 1 %, p95 < 500
  ms, p99 < 1500 ms).

| Claim                                                                                                                                                                                                 | Workload and qualification                                                                                  | Commit                | Evidence                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| **158 req/s sustained** on one project-service task; **298 req/s sustained** with two (p95 485 ms, p99 700 ms, 0 errors). Peak 312 req/s                                                              | read-heavy (80 % board reads, cached), 100 / 200 VUs; horizontal scaling 2.0×; gateway saturated at 2 tasks | `0819abc`             | `tests/load/results/c-scale-out.md`                       |
| **−22 % CPU per request, +25 % throughput** from replacing a multi-query board read with one JSON-aggregating SQL statement                                                                           | balanced, 100 VUs; controlled A/B on the same host model, same session (3 vs 2 runs)                        | `afb830e` → `4b22d57` | `tests/load/results/o-opt1-ab.md`                         |
| Redis board cache: **4–14× fewer database tuples read**, +13 % saturated throughput; **no gain** under the balanced mix                                                                               | read-heavy and balanced ladders, cache ON vs OFF, 3 runs each                                               | `4b22d57`             | `a-cache-on.md`, `a-cache-off.md`                         |
| Transactional outbox at **30–33 writes/s sustained: publish lag p95 0.51 s, p99 0.6 s, max backlog 19, 0 errors**                                                                                     | write-heavy, 25 VUs, 8 min × 2; arrival and publication measured in PostgreSQL per 30 s bucket              | `0819abc`             | `d-publisher-{1,2}/outbox-rates.txt`                      |
| Outbox recovery: **300 events written during a publisher outage, all published in 4.2 s after restart**, none lost                                                                                    | failure injection (publisher scaled to 0)                                                                   | `0819abc`             | `tests/failure/results/2026-10-17-failures-publisher.txt` |
| **1,000 concurrent open WebSocket connections on one 0.25 vCPU replica, 100 % delivery** (15,000 notifications); notify-after-commit p95 ≈ 0.5 s                                                      | 3 min hold; latency is from the writer's HTTP 201 to its own socket (one clock), not browser to browser     | `0819abc`             | `tests/load/results/e-ws-1000/`                           |
| Reconnect storm: **1,000 simultaneous connects, 0 dropped**, connect p95 5.1 s                                                                                                                        | 2 realtime replicas; k6 without client backoff                                                              | `0819abc`             | `e-ws-storm-1000-2rep/`                                   |
| **14 failure scenarios passed on AWS**, among them: RDS reboot (writes 503, not 500; recovered in 62 s with no restarts), MSK broker reboot (170/170 writes OK), ECS task kills (replaced in 40–50 s) | single-AZ RDS reboot, not a Multi-AZ failover; 3 more scenarios NOT RUN, listed                             | `0819abc`             | `docs/failure-testing.md`                                 |
| **Data invariants held across 327,494 events** (no lost, unpublished or duplicated side effects, gap-free versions) after load and failures                                                           | two read-only audits (213,658 + 113,836 events, two database instances)                                     | –                     | `tests/failure/results/invariants-2026-10-17-*.txt`       |
| **397 automated tests** (217 unit + 180 integration against real PostgreSQL, Kafka, Redis and S3 emulation) and **81 deliberate breaks**                                                              | 79 breaks verified before this session, 2 on 2026-10-17                                                     | `7168fae`             | CI run 39071494758                                        |

Not claimed: two-gateway scaling (not run), sustained capacity above 1,000 WebSocket connections
(not tested), any multi-AZ or production-scale figure, and CI speed improvements (not re-measured).

## Repository layout

```
apps/
  web/                 React SPA (Vite, React Router, TanStack Query); talks only to the gateway
  api-gateway/         Single external HTTP entry point: routing, CORS, correlation, timeouts
  project-service/     Workspaces, projects, boards, tasks, assignees, comments (Fastify)
  outbox-publisher/    Worker: PostgreSQL outbox → Kafka (claim/lease, backoff, at-least-once)
  kafka-tools/         Kafka CLI: topic init job, inspection, sample/malformed producers, DLQ list/replay
  activity-service/    Kafka consumer → activity feed projection (idempotent; DLQ for poison events)
  cache-invalidator/   Kafka consumer → board cache invalidation (Redis)
  realtime-service/    Kafka consumer → WebSocket notifications (JWT auth, project rooms)
    src/http/          transport concerns: auth hook, error model, shared schemas
    src/domain/        roles and access checks
    src/modules/*/     routes → service → repository per area
    test/              integration tests against a real PostgreSQL (Testcontainers)
packages/
  config/              Zod-validated, typed environment configuration
  database/            Drizzle schema, SQL migrations, pool, migration runner
  auth/                AuthProvider interface + local HS256 JWT implementation
  observability/       Pino options, request/correlation IDs, request logging
  test-utils/          Testcontainers helpers
  contracts/           Shared contracts (Zod): HTTP DTOs, the public error shape, domain events
  kafka/               Kafka client, topics, DomainEventProducer/Consumer, partitioning
  runtime/             Graceful shutdown and connection draining for services
  cache/               Shared board cache (cache-aside, generation-guarded write-back)
  storage/             ObjectStorage interface + S3 implementation (presigned POST/GET)
tests/
  architecture/        Static guards (e.g. the request path must not depend on Kafka)
  integration/         Cross-service tests with real service processes (gateway → service → DB)
  e2e/                 Playwright tests against the running Docker stack
  load/                k6 load tests (HTTP scenarios, WebSocket fanout) and their results/
infrastructure/
  docker/              Shared Node-service Dockerfile; web Dockerfile + nginx config
  terraform/           AWS dev environment (modules + environments/dev)
  observability/       Prometheus config, Grafana provisioning, dashboards (generated)
scripts/aws/           AWS operations: rebuild/deploy/destroy, audit, demos, failure injections
scripts/load/          Load-run orchestration (metrics snapshots, CloudWatch window, report)
scripts/mutations/     Deliberate breaks and their runner (CI: .github/workflows/mutations.yml)
scripts/smoke.mjs      End-to-end smoke test against a running stack
scripts/kafka          Kafka developer tooling (see below)
scripts/outbox         Outbox diagnostics and API-driven backlog generator
docs/                  Architecture notes and ADRs
docker-compose.yml     Local environment
```

See [docs/architecture.md](docs/architecture.md) for the topology, the gateway, frontend
server-state strategy, conflict UX, layering, authorization, the error model and the data model.

## AWS environment

Terraform in `infrastructure/terraform`, driven by `npm run aws:*` scripts; images are built by
GitHub Actions (OIDC; no long-lived keys). See [docs/aws-development.md](docs/aws-development.md).

```bash
npm run aws:rebuild    # everything from nothing, one command: state bucket → plan → confirm →
                       # apply → build + deploy main → drift check (~45 min, mostly MSK)
npm run aws:destroy    # tear it all down (confirmation required); aws:destroy:all also
                       # removes the Terraform state bucket
npm run aws:deploy     # deploy the current main commit (build, migrate, roll, smoke)
npm run aws:status     # what is running, where, which SHA
npm run aws:audit      # read-only security/inventory audit (40 checks)
npm run aws:cost-info  # current AWS unit rates for the deployed resources
npm run aws:demo:realtime   # Phase 8-9 demo: two users live, reconnect, replica swap, S3
npm run aws:demo:dlq        # poison message → DLQ on MSK
npm run aws:demo            # activity/invalidator/Redis outages and catch-up
npm run aws:demo:failures   # publisher outage, ECS task stops, RDS reboot, MSK broker reboot
npm run aws:invariants      # read-only data-invariant audit through an SSM tunnel
scripts/load/run.sh <label> http balanced "LADDER=10,50,100 STEP=3m"   # measured load run
```

The environment costs money while it exists: `npm run aws:destroy` when not demoing, and
`npm run aws:rebuild` to bring it back exactly (all state is in the repository).

## Quick start

```bash
docker compose up --build        # web :8080, api-gateway :3000 (project-service is internal),
                                 # kafka :9094 from the host (topics created by kafka-init)
open http://localhost:8080       # sign in with any email (development login)
```

## Prerequisites

- Node.js ≥ 22.12 (`.nvmrc` pins 24)
- npm ≥ 10
- Docker with Compose v2

## Commands

```bash
npm install              # install all workspaces
npm run build            # build every package (Turborepo, dependency-ordered)
npm run lint             # ESLint (type-aware)
npm run typecheck        # tsc --noEmit across workspaces
npm run test             # unit tests (Vitest, no external dependencies); alias: test:unit
npm run test:docker      # Testcontainers integration tests (needs Docker; also run in CI)
npm run test:aws         # cloud verification against the deployed dev environment
npm run test:integration # integration tests; starts PostgreSQL and Kafka via Testcontainers (needs Docker)
npm run test:e2e         # Playwright against the running stack (docker compose up first;
                         # first time: npx playwright install chromium)
npm run format           # Prettier write
npm run format:check     # Prettier check
npm run check            # all of the above, as CI will run it

docker compose up --build        # start the local environment (runs migrations first)
docker compose down -v           # stop and delete volumes
node scripts/smoke.mjs           # end-to-end check against the running stack

# Kafka (host listener localhost:9094; run via this script so Ctrl-C shuts consumers down cleanly)
scripts/kafka topics                                   # partitions, leaders, offsets
scripts/kafka groups                                   # consumer groups, committed offsets, lag
scripts/kafka produce-sample --type task.moved         # publish a valid sample event
scripts/kafka produce-malformed --kind bad-schema-version
scripts/kafka consume --group probe --from-beginning   # probe consumer

# Outbox (Compose database)
scripts/outbox status                                  # pending count, oldest pending age, failing
scripts/outbox pending | failing | recent --limit 20
scripts/outbox backlog --tasks 25                      # create events through the real API
npm run demo:kafka-outage                              # Kafka down → writes succeed → drain (needs the stack)
npm run test:stack                                     # all tests that drive the Compose stack

# Database
npm run db:generate -w @dpp/database   # generate a SQL migration from schema changes
npm run db:migrate -w @dpp/database    # apply migrations using DATABASE_URL (.env)
```

### Fast local development (outside Docker)

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
docker compose up -d postgres migrate
npm run build
npm run dev -w @dpp/project-service     # :3001, tsx watch, reads ../../.env
npm run dev -w @dpp/api-gateway         # :3000, proxies to PROJECT_SERVICE_URL
npm run dev -w @dpp/web                 # :5173, Vite; calls VITE_API_BASE_URL (the gateway)
```

## Configuration

Every service validates its environment with Zod at startup and exits immediately with a
list of the offending variable names if anything is missing or malformed. Values are never
echoed, since the environment carries secrets. See [`.env.example`](.env.example).

## API

The browser calls everything through the gateway at `http://localhost:3000/api/...`, which
forwards `/api/auth/*`, `/api/me`, `/api/workspaces*`, `/api/projects*` and `/api/tasks*` to the
Project Service with `/api` stripped. Anything else under `/api` is a gateway 404. The gateway's
own endpoints are `GET /health` and `GET /ready`.

Project Service endpoints (paths as seen behind `/api`). All except probes and dev login need `Authorization: Bearer <jwt>`. Mutations that
depend on the client's view of a task take `expectedVersion` and return **409
`VERSION_CONFLICT`** if it is stale ([ADR-008](docs/adr/008-optimistic-concurrency-control.md)).

| Method & path                         | Purpose                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /health`                         | liveness                                                                          |
| `GET /ready`                          | readiness: 503 while shutting down or if PostgreSQL is down                       |
| `POST /auth/dev-login`                | `{email, displayName}` → `{token, user}`; only when `AUTH_DEV_LOGIN_ENABLED=true` |
| `GET /me`                             | current user                                                                      |
| `POST /workspaces`                    | create; caller becomes OWNER                                                      |
| `GET /workspaces`                     | caller's workspaces with their role                                               |
| `GET /workspaces/:id`                 | workspace                                                                         |
| `GET /workspaces/:id/members`         | members                                                                           |
| `POST /workspaces/:id/members`        | `{email, role: ADMIN\|MEMBER}`; ADMIN+ (only OWNER grants ADMIN)                  |
| `POST /projects`                      | `{workspaceId, name, description?}`; ADMIN+; creates board + default columns      |
| `GET /workspaces/:id/projects`        | projects in a workspace                                                           |
| `GET /projects/:id`                   | project                                                                           |
| `GET /projects/:id/board`             | columns with ordered tasks and assignee IDs (one snapshot)                        |
| `POST /tasks`                         | `{projectId, columnId, title, description?}`; appended to column                  |
| `GET /tasks/:id`                      | task                                                                              |
| `PATCH /tasks/:id`                    | `{expectedVersion, title?, description?}`                                         |
| `DELETE /tasks/:id?expectedVersion=`  | soft delete                                                                       |
| `POST /tasks/:id/move`                | `{expectedVersion, columnId, afterTaskId: uuid\|null}` (null = top)               |
| `POST /tasks/:id/assignees`           | `{userId}`; must be a workspace member; idempotent                                |
| `DELETE /tasks/:id/assignees/:userId` | idempotent                                                                        |
| `GET /tasks/:id/comments`             | comments, oldest first                                                            |
| `POST /tasks/:id/comments`            | `{body}`                                                                          |

## Testing

Executed test counts per package from CI run 39071494758 on `7168fae` (2026-10-17, all green; the
test steps print every vitest summary). Integration tests run
against real PostgreSQL, Kafka, Redis and LocalStack S3 via Testcontainers:

| Area                                                                                                   | Unit                         | Integration (real infrastructure) |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------- |
| project-service (HTTP → PostgreSQL, outbox, attachments, board snapshot)                               | 13                           | 74                                |
| outbox-publisher                                                                                       | 8                            | 16                                |
| kafka (producer/consumer, retries, DLQ)                                                                | 19                           | 22                                |
| activity-service (idempotent projection)                                                               | 4                            | 10                                |
| cache / cache-invalidator                                                                              | 2 / 1                        | 7                                 |
| realtime-service (auth, rooms, replicas, backpressure, heartbeats)                                     | 5                            | 9                                 |
| storage (presigned policy, S3 behaviour)                                                               | 2                            | 5                                 |
| system (real processes: gateway ⇄ services ⇄ DB/Kafka, dashboards vs Prometheus) + architecture guards | 23                           | 37                                |
| web (React)                                                                                            | 54                           | —                                 |
| api-gateway / auth / config / contracts / database / observability / runtime                           | 16 / 10 / 6 / 35 / 6 / 8 / 5 | —                                 |
| **Total executed in CI (397)**                                                                         | **217**                      | **180**                           |

Plus:

- **Deliberate breaks:** 81, each with a baseline per phase. Every break edits the code in one
  exact place, and CI requires the named tests to fail (`.github/workflows/mutations.yml`).
  - The 79 breaks for Phases 4–9 passed in CI before this session and were not rerun on
    2026-10-17.
  - The two Phase-10 breaks, for the 503 mapping and the dev-login guard, were CAUGHT in CI on
    `f1757d7`.
- **Playwright:** 4 specs against the local Compose stack. They include Docker-level outages,
  so they don't run in CI.
- **AWS demos and failure injections:** the `npm run aws:demo*` scripts, with results recorded
  in `docs/performance.md` and `docs/failure-testing.md`.

CI (`.github/workflows/ci.yml`) plans affected work, shards the integration suites, and runs
static checks (lint, typecheck, format), security checks (`npm audit` for production
dependencies, gitleaks secret scanning), unit tests and the integration shards. Images are scanned
on push by ECR, and `npm run aws:audit` checks the live AWS configuration; see [docs/ci.md](docs/ci.md).

## Docker images

`infrastructure/docker/node-service.Dockerfile` builds every Node service:
`turbo prune` reduces the monorepo to the target service's dependency graph, a build stage
compiles TypeScript, and the runtime stage contains only production dependencies and
compiled output, running as the non-root `node` user. `infrastructure/docker/web.Dockerfile`
builds the SPA (the gateway URL is baked in at build time) and serves it from unprivileged nginx
with a strict Content-Security-Policy whose `connect-src` allows only the gateway origin.
