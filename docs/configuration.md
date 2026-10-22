# Configuration reference

Every process reads its configuration from environment variables and validates it with Zod at
startup (`loadConfig` in `@dpp/config`). An invalid or missing required value stops the process
before it binds a port or connects anywhere, with a message naming the variable. Nothing reads
`process.env` outside these schemas, apart from the operator name `kafka-tools` records on a DLQ
replay (`USER`).

Where the values come from:

| Where                       | Source                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` (host)        | `.env`, copied from [`.env.example`](../.env.example)                                                                                               |
| Docker Compose              | `environment:` blocks in [`docker-compose.yml`](../docker-compose.yml)                                                                              |
| Integration and stack tests | set by each suite's setup (Testcontainers addresses)                                                                                                |
| AWS (ECS)                   | [`services.tf`](../infrastructure/terraform/environments/dev/services.tf): plain values as `environment`, secrets from Secrets Manager as `secrets` |

Services: **PS** project-service, **GW** api-gateway, **OP** outbox-publisher, **AS**
activity-service, **CI** cache-invalidator, **RT** realtime-service, **KT** kafka-tools, **MG**
migrate (one-shot job).

## Common

| Variable              | Default       | Read by                | Notes                                                                |
| --------------------- | ------------- | ---------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`            | `development` | all but MG             | `development`, `test` or `production`. Images set `production`.      |
| `LOG_LEVEL`           | `info`        | all but MG             | Pino level, `fatal` … `trace` or `silent`. KT defaults to `warn`.    |
| `HOST`                | `0.0.0.0`     | PS, GW, OP, AS, CI, RT | Listen address.                                                      |
| `PORT`                | required      | PS, GW, OP, AS, CI, RT | Conventionally GW 3000, PS 3001, OP 3002, AS 3003, CI 3004, RT 3005. |
| `SHUTDOWN_TIMEOUT_MS` | `10000`       | PS, GW, OP, AS, CI, RT | Grace period after SIGTERM before the process exits anyway.          |

The worker services (OP, AS, CI) listen only for probes (`/health`, `/ready`) and `/metrics`.

## Database

| Variable                                                  | Default         | Read by            | Notes                                                                                                                                                              |
| --------------------------------------------------------- | --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                            | required        | PS, OP, AS, RT, MG | `postgres://user:password@host:port/db`. When unset, built from the five `DB_*` values below (`withDatabaseUrl`).                                                  |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | `DB_PORT` 5432  | PS, OP, AS, RT, MG | AWS shape: ECS injects user and password separately from Secrets Manager, so a password with URL-special characters stays intact. An explicit `DATABASE_URL` wins. |
| `DATABASE_TLS_CA_FILE`                                    | unset (no TLS)  | PS, OP, AS, RT, MG | CA bundle for verified TLS. Images ship the RDS bundle at `/app/certs/rds-global-bundle.pem`.                                                                      |
| `DATABASE_POOL_MAX`                                       | PS 10, others 4 | PS, OP, AS, RT     | Connections per process. Size it against the RDS connection limit times the number of tasks.                                                                       |
| `APP_DB_USER`, `APP_DB_PASSWORD`                          | unset           | MG                 | When both are set, migrations (run as the owner) also (re)create this least-privilege role that the services connect as. Password at least 16 characters.          |

## Authentication

| Variable                 | Default      | Read by | Notes                                                                                                     |
| ------------------------ | ------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`             | required     | PS, RT  | HS256 key, at least 32 characters. The same value on both. Generate with `openssl rand -base64 48`.       |
| `JWT_ISSUER`             | `dpp-local`  | PS, RT  |                                                                                                           |
| `JWT_AUDIENCE`           | `dpp-api`    | PS, RT  |                                                                                                           |
| `JWT_TTL_SECONDS`        | `28800`      | PS      | Token lifetime (8 h).                                                                                     |
| `AUTH_DEV_LOGIN_ENABLED` | `false`      | PS      | Passwordless `POST /auth/dev-login`. Refused at startup when `DEPLOYMENT_ENVIRONMENT` is `production`.    |
| `DEPLOYMENT_ENVIRONMENT` | `production` | PS      | `local`, `test`, `dev` or `production`. Defaulting to production means forgetting it keeps dev login off. |

## API gateway

| Variable                      | Default   | Notes                                                                                                                                    |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_SERVICE_URL`         | required  | Internal address of the Project Service; never sent to browsers.                                                                         |
| `REALTIME_SERVICE_URL`        | unset     | WebSocket relay target. Without it, `/api/realtime` is not routed.                                                                       |
| `UPSTREAM_CONNECT_TIMEOUT_MS` | `2000`    | A connect failure means the request was never sent: 503 `DEPENDENCY_UNAVAILABLE`.                                                        |
| `UPSTREAM_REQUEST_TIMEOUT_MS` | `15000`   | Must exceed the Project Service's statement timeout, so its own 503 arrives first. A mutation that times out gets 504 `OUTCOME_UNKNOWN`. |
| `RATE_LIMIT_MAX`              | `600`     | Requests per client per window, per gateway task. A client is its verified user, else its IP.                                            |
| `RATE_LIMIT_WINDOW_MS`        | `60000`   |                                                                                                                                          |
| `TRUSTED_PROXY_CIDRS`         | empty     | Read `X-Forwarded-For` only from connections in these IPv4 ranges (AWS: the VPC). Empty: never read it.                                  |
| `TRUSTED_PROXY_HOPS`          | `1`       | Number of proxies in front of the gateway (AWS: CloudFront + ALB = 2).                                                                   |
| `JWT_SECRET`                  | required  | Same value as the Project Service. Used only to pick the rate-limit bucket.                                                              |
| `BODY_LIMIT_BYTES`            | `1048576` | Larger request bodies get 413 at the gateway.                                                                                            |
| `CORS_ORIGINS`                | empty     | Comma-separated browser origins. Empty allows none, which suits same-origin serving through CloudFront.                                  |

## Board cache (ADR-015)

| Variable                   | Default                          | Read by | Notes                                                                         |
| -------------------------- | -------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `CACHE_ENABLED`            | `false`                          | PS      | Off: every board read goes to PostgreSQL, which is always correct.            |
| `REDIS_URL`                | required by CI; PS when cache on | PS, CI  | `redis://…` locally, `rediss://…` (TLS) for ElastiCache.                      |
| `CACHE_TTL_SECONDS`        | `300`                            | PS      | 1 to 86400. A safety net only; Kafka-driven invalidation keeps entries fresh. |
| `CACHE_COMMAND_TIMEOUT_MS` | PS `250`, CI `500`               | PS, CI  | A slower cache is treated as unavailable: PS falls back to PostgreSQL.        |

## Attachments (ADR-021, ADR-022)

| Variable                              | Default               | Notes                                                                               |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `STORAGE_ENABLED`                     | `false`               | Off: attachment routes are not registered (404); task CRUD is unaffected.           |
| `STORAGE_BUCKET`                      | required when enabled |                                                                                     |
| `STORAGE_REGION`                      | `us-east-2`           |                                                                                     |
| `STORAGE_ENDPOINT`                    | unset                 | S3-compatible endpoint (LocalStack locally). Unset for AWS S3.                      |
| `STORAGE_PUBLIC_ENDPOINT`             | unset                 | The endpoint browsers use, when it differs from the service's (Compose host names). |
| `STORAGE_FORCE_PATH_STYLE`            | `false`               | `true` for LocalStack and MinIO.                                                    |
| `ATTACHMENT_MAX_BYTES`                | 100 MiB               | At most 5 GiB (S3's single-request limit).                                          |
| `ATTACHMENT_UPLOAD_URL_TTL_SECONDS`   | `300`                 | 30 to 3600.                                                                         |
| `ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS` | `60`                  | 10 to 3600.                                                                         |
| `ATTACHMENT_PENDING_TTL_SECONDS`      | `3600`                | An upload not finalized within this is abandoned by the sweep.                      |
| `ATTACHMENT_SWEEP_INTERVAL_MS`        | `600000`              |                                                                                     |

All read by PS only.

## Idempotency

| Variable                    | Default | Read by | Notes                                                                     |
| --------------------------- | ------- | ------- | ------------------------------------------------------------------------- |
| `IDEMPOTENCY_KEY_TTL_HOURS` | `24`    | PS      | How long a create request's `Idempotency-Key` replays its first response. |

## Kafka

| Variable                   | Default                         | Read by            | Notes                                                                                              |
| -------------------------- | ------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `KAFKA_BROKERS`            | required (KT: `localhost:9094`) | OP, AS, CI, RT, KT | Comma-separated `host:port`. Compose `kafka:9092`; host `localhost:9094`; MSK IAM brokers on 9098. |
| `KAFKA_CLIENT_ID`          | required (KT: `kafka-tools`)    | OP, AS, CI, RT, KT | Appears in broker logs and metrics.                                                                |
| `KAFKA_SSL`                | `false`                         | OP, AS, CI, RT, KT | `true` for MSK.                                                                                    |
| `KAFKA_AUTH`               | `none`                          | OP, AS, CI, RT, KT | `aws-iam` signs SASL/OAUTHBEARER with the task role. Requires `KAFKA_SSL=true` and `AWS_REGION`.   |
| `AWS_REGION`               | unset                           | OP, AS, CI, RT, KT | Required with `KAFKA_AUTH=aws-iam`.                                                                |
| `KAFKA_REPLICATION_FACTOR` | `1`                             | KT                 | Replicas per partition for `init-topics`: 1 on the local broker, 2 on MSK.                         |

## Outbox publisher (ADR-011)

| Variable                       | Default            | Notes                                                                                                    |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `OUTBOX_BATCH_SIZE`            | `50`               | Events claimed per cycle, at most 1000 (and at most one per project).                                    |
| `OUTBOX_POLL_INTERVAL_MS`      | `500`              | Sleep between cycles when idle; while events are found it re-polls immediately.                          |
| `OUTBOX_LEASE_MS`              | `60000`            | Lease on claimed rows; must exceed the longest publish attempt. Expiry causes a duplicate, never a loss. |
| `OUTBOX_BACKOFF_BASE_MS`       | `1000`             | Retry backoff after a failed publish.                                                                    |
| `OUTBOX_BACKOFF_MAX_MS`        | `60000`            | Must be at least the base.                                                                               |
| `OUTBOX_RETENTION_HOURS`       | `168`              | Published events are deleted after this (Kafka keeps 7 days).                                            |
| `OUTBOX_RETENTION_INTERVAL_MS` | `600000`           | How often retention runs.                                                                                |
| `OUTBOX_WORKER_ID`             | `<hostname>-<pid>` | Recorded in `claimed_by`.                                                                                |

## Realtime service (ADR-016 to ADR-018)

| Variable                      | Default            | Notes                                                                         |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `REALTIME_INSTANCE_ID`        | `<hostname>-<pid>` | Names this replica's own consumer group; every replica reads every event.     |
| `REALTIME_MAX_BUFFERED_BYTES` | `1048576`          | A socket with more unsent data is closed (slow consumer); the client resyncs. |
| `REALTIME_HEARTBEAT_MS`       | `15000`            | Ping interval; at least 1000.                                                 |
| `REALTIME_AUTH_TIMEOUT_MS`    | `5000`             | A socket that has not authenticated by then is closed.                        |

## Web app (build time)

Vite inlines these into the bundle when it is built (`web.Dockerfile` build arguments). They are
not secrets: everything in the bundle is public.

| Variable                 | Default                     | Notes                                                                           |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`      | `http://localhost:3000/api` | Required by the image build. `/api` when served same-origin through CloudFront. |
| `VITE_DEV_LOGIN_ENABLED` | `false`                     | Shows the dev-login form.                                                       |

The nginx image reads `API_ORIGIN` at container start: the gateway origin allowed in the
Content-Security-Policy `connect-src`.

## Secrets

Only `JWT_SECRET`, `DB_PASSWORD` (and `DATABASE_URL`, which embeds it), and `APP_DB_PASSWORD` are
secret. In AWS they come from Secrets Manager and never appear in task definitions, Terraform
outputs or logs. Locally, `.env.example` holds clearly fake values; `.env` is ignored by git, and
CI runs gitleaks on every push.
