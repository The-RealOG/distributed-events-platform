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
  CloudFront, S3), CI/CD through GitHub Actions and OIDC with no long-lived keys, and 79
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

## Status and next session

Phases 0–9 are complete, deployed and verified on AWS. **Phase 10 (measure, break, document)
is in progress.** Done so far:

- **Load harness:** k6 scenarios, a WebSocket load test, and a runner workflow. Every run keeps
  its evidence in `tests/load/results/`.
- **Baseline balanced load ladder:** sustained up to 50 VUs, at about 90 req/s with p95 381 ms
  and 0 errors. The bottleneck is project-service CPU (0.25 vCPU); RDS stayed at ≤16 %.
- **Optimization 1**, measured with a CPU profile before the change: the board is now read in
  one statement. That doubled the sustained load to 100 VUs, at 184 req/s with p95 246 ms.
- **Outbox recovery:** a backlog of 300 events drained at about 55 events/s.
- **AWS verification of Phases 8–9:** realtime between two users, DLQ on MSK, and
  direct-to-S3 attachments. Two real bugs were found and fixed; see
  [docs/bug-ledger.md](docs/bug-ledger.md).

Details: [docs/performance.md](docs/performance.md). Remaining Phase-10 work, in order:

1. The cache on/off experiment (`-var board_cache_enabled=false`), then read-heavy, write-heavy,
   hot-project and multi-project runs.
2. The api-gateway CPU, which is now a co-bottleneck at saturation.
3. WebSocket load at 100, 500 and 1000 sockets.
4. Failure injections: `npm run aws:demo:failures` (ECS tasks, RDS reboot, MSK broker reboot)
   and `npm run aws:demo` (Activity, invalidator and Redis outages).
5. A 30-minute soak.
6. `npm run aws:invariants`.
7. The final Terraform plan and `aws:audit`, the README results and the final report.

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

Executed test counts per package from the CI run of `4d3ff72` (all green). Integration tests run
against real PostgreSQL, Kafka, Redis and LocalStack S3 via Testcontainers:

| Area                                                                                                   | Unit                         | Integration (real infrastructure) |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------- |
| project-service (HTTP → PostgreSQL, outbox, attachments, board snapshot)                               | 10                           | 74                                |
| outbox-publisher                                                                                       | 8                            | 16                                |
| kafka (producer/consumer, retries, DLQ)                                                                | 19                           | 22                                |
| activity-service (idempotent projection)                                                               | 4                            | 10                                |
| cache / cache-invalidator                                                                              | 2 / 1                        | 7                                 |
| realtime-service (auth, rooms, replicas, backpressure, heartbeats)                                     | 5                            | 9                                 |
| storage (presigned policy, S3 behaviour)                                                               | 2                            | 5                                 |
| system (real processes: gateway ⇄ services ⇄ DB/Kafka, dashboards vs Prometheus) + architecture guards | 23                           | 37                                |
| web (React)                                                                                            | 54                           | —                                 |
| api-gateway / auth / config / contracts / database / observability / runtime                           | 16 / 10 / 6 / 35 / 5 / 8 / 5 | —                                 |
| **Total executed in CI (393)**                                                                         | **213**                      | **180**                           |

Plus:

- **Deliberate breaks:** 79, each with a baseline per phase. Every break edits the code in
  one exact place, and CI requires the named tests to fail (`npm run` via
  `.github/workflows/mutations.yml`). All pass for Phases 4–9.
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
