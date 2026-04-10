# Distributed Project Platform

A project-management platform (workspaces, boards, tasks, comments, attachments) built as a
vehicle for demonstrating distributed-systems engineering: PostgreSQL as the source of truth,
a transactional outbox feeding Kafka, idempotent consumers, Redis cache-aside with
event-driven invalidation, WebSocket realtime delivery, presigned direct-to-object-storage
uploads, and Prometheus/Grafana observability — all runnable locally with Docker Compose.

> **Status:** under active, phased construction. This README describes only what exists and
> has been verified. Sections for later phases are added as those phases land.

## Implementation status

| Phase | Scope                                                                  | State       |
| ----- | ---------------------------------------------------------------------- | ----------- |
| 0     | Monorepo, TypeScript strict, lint/format, Vitest, config, Docker setup | Done        |
| 1     | PostgreSQL schema, Project Service, JWT auth, optimistic concurrency   | Done        |
| 2     | Frontend baseline + thin API Gateway                                   | Done        |
| 3     | Kafka infrastructure and domain-event contracts (no publishing yet)    | Done        |
| 4     | Transactional outbox + outbox publisher (PostgreSQL → Kafka)           | Done        |
| 5     | Activity Service and idempotent consumers                              | Not started |
| 6     | Realtime (WebSocket) Service                                           | Not started |
| 7     | Redis cache-aside and distributed invalidation                         | Not started |
| 8     | File Service and presigned uploads                                     | Not started |
| 9     | Reliability: retries, DLQ, shutdown, readiness                         | Not started |
| 10    | Observability: Prometheus, Grafana                                     | Not started |
| 11    | Load testing (k6)                                                      | Not started |
| 12    | CI, Docker hardening, Terraform skeleton                               | Not started |

## Repository layout

```
apps/
  web/                 React SPA (Vite, React Router, TanStack Query); talks only to the gateway
  api-gateway/         Single external HTTP entry point: routing, CORS, correlation, timeouts
  project-service/     Workspaces, projects, boards, tasks, assignees, comments (Fastify)
  outbox-publisher/    Worker: PostgreSQL outbox → Kafka (claim/lease, backoff, at-least-once)
  kafka-tools/         Kafka CLI: topic init job, inspection, sample/malformed producers, probe consumer
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
tests/
  architecture/        Static guards (e.g. the request path must not depend on Kafka)
  integration/         Cross-service tests with real service processes (gateway → service → DB)
  e2e/                 Playwright tests against the running Docker stack
infrastructure/
  docker/              Shared Node-service Dockerfile; web Dockerfile + nginx config
scripts/smoke.mjs      End-to-end smoke test against a running stack
scripts/kafka          Kafka developer tooling (see below)
scripts/outbox         Outbox diagnostics and API-driven backlog generator
docs/                  Architecture notes and ADRs
docker-compose.yml     Local environment
```

See [docs/architecture.md](docs/architecture.md) for the topology, the gateway, frontend
server-state strategy, conflict UX, layering, authorization, the error model and the data model.

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
npm run test             # unit tests (Vitest, no external dependencies)
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

| Suite                    | Where                                               | What it proves                                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                     | `packages/*/src/*.test.ts`, `apps/*/src/*.test.ts`  | config validation, JWT verification (expiry, issuer, audience, `alg:none`), role rules, request IDs, error shape, readiness                                                                                                                                                                         |
| Integration              | `apps/project-service/test/*.int.test.ts`           | full HTTP → PostgreSQL behaviour: RBAC, 401/403/404/409, ordering, soft delete, idempotent assignment, DB-down 503                                                                                                                                                                                  |
| Forced-interleaving race | `apps/project-service/test/concurrency.int.test.ts` | two real transactions in the lost-update interleaving; the second matches zero rows                                                                                                                                                                                                                 |
| Gateway                  | `apps/api-gateway/test/gateway.test.ts`             | routing allowlist, header allowlist, correlation/request IDs, byte-exact bodies, 503 on unreachable/slow upstream, no retries, 413, CORS, security headers, draining                                                                                                                                |
| Frontend                 | `apps/web/src/**/*.test.ts(x)`                      | error parsing, API client, session/401 flow, board rendering, moves, 409 conflict UX, 503/403/404 states                                                                                                                                                                                            |
| Event contracts          | `packages/contracts/src/events.test.ts`             | every event type round-trips; missing fields, wrong payload for a type, bad metadata, unknown type, unsupported schemaVersion are each classified                                                                                                                                                   |
| Kafka (real broker)      | `packages/kafka/test/*.int.test.ts`                 | acks + key + metadata, invalid events never sent, failures surfaced, 8 kinds of malformed message skipped without stopping, per-project order, key→partition, consumer-group split vs. independent groups, graceful consumer/producer shutdown, broker stop/restart recovery, correlation unchanged |
| Architecture             | `tests/architecture/*.test.ts`                      | no request-path app depends on or imports Kafka                                                                                                                                                                                                                                                     |
| Stack demonstrations     | `tests/stack/*.stack.test.ts`                       | Kafka down (and publisher down) on the real Compose stack: writes succeed, events wait, then drain with unchanged identity                                                                                                                                                                          |
| Cross-service            | `tests/integration/*.int.test.ts`                   | real gateway + project-service processes + PostgreSQL: correlation across hops (from logs), no JWT in logs, DB outage and upstream outage → safe 503                                                                                                                                                |
| Browser E2E              | `tests/e2e/*.spec.ts`                               | full lifecycle in Chromium; two-browser stale edit; PostgreSQL and project-service outages with recovery                                                                                                                                                                                            |
| Smoke                    | `scripts/smoke.mjs`                                 | the running Docker stack end to end, through the gateway                                                                                                                                                                                                                                            |

The critical guards were checked by mutation: breaking the version check, the gateway's error
handling, retry suppression, timeouts, correlation propagation, body forwarding, and the
frontend's conflict handling each makes the corresponding tests fail.

## Docker images

`infrastructure/docker/node-service.Dockerfile` builds every Node service:
`turbo prune` reduces the monorepo to the target service's dependency graph, a build stage
compiles TypeScript, and the runtime stage contains only production dependencies and
compiled output, running as the non-root `node` user. `infrastructure/docker/web.Dockerfile`
builds the SPA (the gateway URL is baked in at build time) and serves it from unprivileged nginx
with a strict Content-Security-Policy whose `connect-src` allows only the gateway origin.
