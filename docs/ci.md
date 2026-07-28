# CI pipeline

`.github/workflows/ci.yml` runs on every pull request, on every push to `main`, and on demand.
It needs no AWS access. Deliberate-break runs (`mutations.yml`) and AWS verification
(`npm run aws:test`, `aws:demo`, `aws:audit`, `terraform plan`) are separate, run at phase and
deploy checkpoints.

```
plan (6 s) ──────────► integration: kafka │ system │ publisher+cache │ activity+project-service
static   format · lint · typecheck (Turbo-cached)          ┐
unit     unit/component tests · architecture guards · build ├ all in parallel, no Docker
security npm audit (lockfile) · gitleaks (full history)    ┘
```

## What runs when

| Change                                                                                                                                | Integration shards                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main` push, manual run                                                                                                               | all four (full distributed-system suite)                                                                                                                                       |
| documentation only (`docs/`, `*.md`), any branch                                                                                      | none                                                                                                                                                                           |
| shared tooling (root `package.json`, lockfile, `turbo.json`, TS/ESLint base configs, `.github/`, `scripts/ci/`, Compose, Dockerfiles) | all four                                                                                                                                                                       |
| anything else                                                                                                                         | the shards containing a package whose integration tests are affected: the changed package or any package depending on it, transitively (Turbo's package graph, not path globs) |

Examples of what that affected rule selects:

- A `packages/contracts` change reaches every consumer, so all shards run.
- A `packages/cache` change runs the cache, project-service and system suites.
- An `apps/web` change runs no infrastructure tests.

Static checks, unit tests and security scans always run.

`scripts/ci/plan.mjs` makes this decision. It **fails the run** if any workspace with a
`test:integration` script is not assigned to a shard, so a new suite can't be silently skipped.

## Caching

- **npm:** `setup-node`'s npm cache, keyed on `package-lock.json`. A source-only change downloads
  nothing.
- **Turbo:** the local cache (`.turbo/cache`) is persisted with `actions/cache` and shared by all
  jobs. Lint, typecheck, unit tests and builds of unchanged packages are replayed.
  - Root configs (`tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`) are global
    dependencies, so changing them invalidates everything.
  - Never cached: integration tests (they depend on containers), and `@dpp/system-tests#test`.
    The latter runs the architecture guards, which read other packages' sources that Turbo
    wouldn't see as inputs.
- **Test images:** pinned tags (`postgres:17-alpine`, `apache/kafka:4.1.1`,
  `valkey/valkey:8-alpine`, `testcontainers/ryuk:0.14.0`) start pulling in the background while
  `npm ci` runs.

## Measurements

These are GitHub-hosted `ubuntu-latest` runners. Wall clock runs from start to the last job's
end.

### Baseline

Four green runs before the change took **455–523 s** (about 475 s median).

| Job           | Time      | Notes                                                                                    |
| ------------- | --------- | ---------------------------------------------------------------------------------------- |
| `integration` | 452–486 s | `test:docker` alone 390–407 s: six suites back to back, each starting its own containers |
| `checks`      | 186–224 s | lint 73–108 s on all 31 packages; the Turbo cache was never persisted (`0 cached`)       |

Suite times within `test:docker`:

| Suite            | Time  |
| ---------------- | ----- |
| kafka            | 125 s |
| system           | 108 s |
| outbox-publisher | 92 s  |
| activity         | 48 s  |
| project-service  | 23 s  |
| cache            | 6 s   |

A fixed cost ran through all of it. Almost every Kafka-consumer test took about 5.2 s because
`consumer.stop()` waits out KafkaJS's 5 s fetch long-poll. `DomainEventConsumer` now uses a 1 s
`maxWaitTimeMs`, which also shortens every production shutdown and rolling deploy.

### After

| Run                       | Wall clock       | Details                                                                                                         |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| First (cold Turbo cache)  | 183 s            | static 179 s (cold lint), integration shards 102–151 s                                                          |
| Warm cache, full suite    | **153 s (−68%)** | static 38 s (48/48 tasks cached), unit 69 s; shards: kafka 139 s, system 112 s, publisher 111 s, consumers 79 s |
| Web-only change on `main` | 147 s            | full suite, because it's `main`                                                                                 |

Current state:

- **Fast failure signal:** format, lint and typecheck in about 40 s when most packages are
  unchanged.
- **Critical path:** the Kafka shard, about 84 s of tests plus about 55 s of setup (`npm ci`,
  building its dependencies).
- **Remaining bottleneck:** `npm ci` at 20–40 s per job, 7 jobs. Caching `node_modules`
  directly was avoided on purpose: a platform-specific tree keyed only on the lockfile would be
  fragile.

## Coverage

Nothing was removed or weakened:

- Every integration suite still runs against real PostgreSQL, Kafka and Valkey, with its own
  containers and isolation. On `main`, all of them run on every push.
- Format, lint, typecheck, unit/component tests, architecture guards, build, `npm audit` and
  gitleaks run on every change.
- There's no `continue-on-error`, and retries weren't added to hide flakiness.
- The deliberate-break workflow is unchanged.

## Deploy pipeline

CI builds no images, so there's no CI-then-deploy rebuild of the same commit. The deploy workflow
builds each image once per commit SHA, skips SHAs already in ECR, and uses the BuildKit GitHub
Actions cache. One gap remains: an image whose inputs didn't change still gets a new SHA tag and
a (cache-warm) build. Retagging by content hash is noted for later.

## Known limitations

- Playwright E2E needs the Compose stack and isn't in CI. It runs locally, or against a deployed
  backend with `WEB_URL`/`API_URL`.
- Suites inside one shard run one after another (`--concurrency=1`). Some pause or stop shared
  containers, so running them in parallel within a job would need per-suite infrastructure
  anyway.
