# ADR-012: AWS development runtime

**Status:** Accepted (Phase 3.5)

## Context

The full local stack (PostgreSQL, Kafka, seven containers, image builds) saturated the
development laptop. Docker Desktop had about 4 GB of memory, load averages of 20–70 were common,
in-container `npm ci` took more than 10 minutes and repeatedly failed on network resets, and the
machine slept mid-test. The goal: run the runtime in AWS, keep the laptop for code, editor and
fast unit tests, and do everything from the terminal. The design should stay small, private,
cheap when idle, and shaped like the later production environment.

## Decisions

### Runtime: ECS on Fargate

The services are already stateless containers with health/readiness endpoints and graceful
shutdown, which is what ECS expects. Fargate needs no instances to patch or scale. Each service
is a 0.25 vCPU / 0.5 GB task. EKS would add a control-plane fee and Kubernetes (out of scope by
the project brief). EC2-backed ECS would add instance management for no measured gain.

### Database: RDS PostgreSQL 17, private

- `db.t4g.micro`, single-AZ, 20 GB gp3, encrypted, TLS enforced (`rds.force_ssl=1`).
- 1-day automated backups. For the dev environment: no final snapshot and no deletion
  protection, so destroy leaves no cost behind.
- The owner password is **managed by RDS in Secrets Manager**. Terraform never sees it.
- A separate least-privilege role (`dpp_app`, DML only) is created by the migration job. Services
  use that role.
- The application still reads `DATABASE_URL`. `withDatabaseUrl` builds it from the injected
  parts, and TLS verification uses the RDS CA bundle shipped in the image.

### Kafka: MSK provisioned, 2 × kafka.t3.small, IAM authentication

Prices from the AWS Pricing API, us-east-2, at decision time:

| Option                           | Rate                                                |
| -------------------------------- | --------------------------------------------------- |
| MSK Serverless                   | $0.75 per cluster-hour + $0.0015 per partition-hour |
| MSK provisioned `kafka.t3.small` | $0.0456 per broker-hour; 2 brokers = $0.0912/h      |

Serverless costs about eight times as much for an idle dev cluster, so provisioned it is. Two
brokers is the minimum for two AZs. T3 is AWS's recommended low-cost development size. Kafka is
**3.9.x** because MSK does not offer 4.x (KRaft) on `kafka.t3.small` ("Unsupported InstanceType" at
create). The client features used (acks=all producer, consumer groups) behave the
same as the local 4.1 broker.

Authentication is **IAM only** (SASL/OAUTHBEARER on port 9098, TLS in transit, unauthenticated
access disabled). KafkaJS gets tokens from AWS's official `aws-msk-iam-sasl-signer-js`, which uses
the task role, so there are no Kafka passwords anywhere. The difference is confined to
`@dpp/kafka` configuration (`KAFKA_SSL`, `KAFKA_AUTH=aws-iam`). Topic semantics are unchanged:
`domain.events` ×3 and `domain.events.dlq` ×1, now with replication factor 2.

MSK cannot be paused. Destroying between sessions is how to stop its charge.

### Networking: no NAT gateway

A NAT gateway costs $0.045/h each, plus per-GB processing. Interface VPC endpoints for everything
the tasks call (ECR ×2, Logs, Secrets Manager, SSM messages, STS) cost $0.01/h each per AZ, which
adds up to more than a NAT. Instead:

- **Data subnets** have no internet route at all (RDS, MSK, ElastiCache).
- **Tasks** run in public subnets with public IPs used **only for outbound** HTTPS to AWS APIs.
  Their security groups admit nothing from the internet: the gateway accepts only the ALB, and
  project-service accepts only the gateway. Outbound is limited to TCP 443 plus the specific
  internal ports.
- Moving to production means private app subnets plus a NAT gateway or VPC endpoints, and
  `assign_public_ip = false`. No application change is needed.

### Entry point: CloudFront in front of both the SPA and the API

There is no custom domain, so the ALB would have no certificate, and an HTTPS page can't call an
HTTP API. CloudFront provides HTTPS on its default certificate and serves:

- `/*` from a **private** S3 bucket through Origin Access Control. SPA routes are rewritten to
  `index.html` by a CloudFront Function on the static behavior only, so API 404s stay 404s.
- `/api/*` from the ALB, uncached, with `Authorization` forwarded.

Browser and API share one origin: no CORS, no mixed content. The ALB admits only CloudFront's
managed prefix list, **and** forwards only requests carrying a secret `x-origin-verify` header.
The prefix list alone would admit any CloudFront distribution.

Serving the static SPA from S3 + CloudFront costs almost nothing, where an always-on nginx
container would bill every hour. When a domain exists, add an ACM certificate to the ALB and
CloudFront and switch the origin to HTTPS.

### Service discovery: Cloud Map private DNS

The gateway reaches project-service at `project-service.dpp-dev.internal:3001` (an A record per
task). There is no sidecar and nothing to pay per task. ECS Service Connect was the alternative:
it adds an Envoy sidecar to every task, and its traffic features aren't needed yet.

### Builds and deploys: GitHub Actions with OIDC; no local Docker

- Images are built on GitHub runners and pushed to ECR with the **git SHA** as an immutable tag.
- The deploy workflow authenticates with **GitHub OIDC**. The role trusts only this repository's
  `main` branch and has only deploy rights: ECR push, register task definitions, run and roll
  tasks, PassRole for the ECS roles only, publish the web bucket, invalidate CloudFront, and
  read job logs. There are **no AWS keys in GitHub**.
- Terraform stays a deliberate local step, so CI can't change infrastructure.
- CodeBuild was the alternative. It would need source uploads and its own IAM, and GitHub was
  already required for CI.

Deploys are manual (`workflow_dispatch`) from `main`. Pull requests never reach AWS.

### Deployment mechanics

`scripts/aws/rollout.sh <sha>` registers new task-definition revisions (Terraform's configuration
with the new image), runs the migration task (one-shot, before any service update, so replicas
never race), ensures topics, rolls services and waits for stability. The ECS deployment circuit
breaker rolls back tasks that never become healthy. The deployed SHA is stored in SSM
(`/dpp-dev/image-tag`). Terraform reads it back, so an `aws:apply` never reverts a deploy, and
services scale to 0 until the first image exists.

Scripts and CI read non-secret deployment facts from SSM (`/dpp-dev/deploy-config`) instead of
Terraform state, which contains secrets and needs broader access.

### State

The S3 backend uses a versioned, encrypted, TLS-only, private bucket with **S3 native locking**
(`use_lockfile`). DynamoDB locking is deprecated in current Terraform. The bucket is created by
an idempotent AWS CLI script (`aws:bootstrap`) and is not removed by `aws:destroy`.

### Redis: ready, off

The ElastiCache (Valkey) module exists but `enable_redis = false`. Nothing uses a cache until
Phase 7, and an idle node costs every hour.

### Security

- No data store is reachable from outside the VPC.
- No security group admits `0.0.0.0/0`.
- Both buckets block all public access and deny non-TLS requests.
- Secrets are generated by Terraform or RDS, stored in Secrets Manager and injected by ECS; they
  are never in source, variables, images or CI.
- Each task has its own role: only the publisher and kafka-tools may reach MSK, and only with the
  Kafka actions they need.
- ECS Exec and database tunnelling go over SSM: no SSH keys, no bastion, no open ports.
- Dev login stays enabled in this short-lived environment (it's how the smoke test signs in);
  a real environment would plug an identity provider into the `AuthProvider` interface.

## Consequences

- The laptop needs no container runtime for normal work. Docker Compose remains the reproducible
  local environment and runs the Testcontainers integration tests in CI.
- An idle environment still bills for MSK, RDS, the ALB, the tasks and their public IPv4
  addresses (`npm run aws:cost-info`). Destroy between sessions. Recreating takes roughly 30–40
  minutes, most of it MSK.
- Two deliberate dev-only simplifications, both variables or one-line switches for a stricter
  environment:
  - single-AZ RDS without a final snapshot
  - tasks with public IPs
