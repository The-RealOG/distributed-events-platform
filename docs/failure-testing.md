# Failure testing

Every row is an experiment that was actually run. **AWS** rows ran against the deployed dev
environment through the public URL (scripts in `scripts/aws/`, raw output in
`tests/failure/results/`); **CI** rows are automated real-infrastructure tests (Testcontainers
PostgreSQL/Kafka/Redis/LocalStack) that run on every change. Recovery times are wall-clock
observations of single runs, not distributions.

## Matrix

<!-- FAILURE-MATRIX -->

## Not applicable / not tested, and why

- **Redis Pub/Sub failure:** there is no Pub/Sub in this system. Cross-replica realtime fanout
  uses one Kafka consumer group per replica (ADR-017). Its failure mode is covered by the realtime
  replica replacement row: notifications missed during a disconnect are recovered by the client's
  refetch on resubscribe.
- **RDS managed failover:** the dev instance is single-AZ (`db.t4g.micro`), so there is no standby
  to fail over to. The closest practical interruption, an instance reboot, was tested instead; it
  exercises the same client behavior (all connections drop, DNS stays, the server comes back).
- **Full Kafka outage on AWS:** MSK offers no supported "stop the cluster" action, and with
  `min.insync.replicas=1` a single broker reboot does not stop writes. A broker reboot was
  tested on AWS; for the write path, a full outage is equivalent to the publisher-outage row (the
  outbox accumulates and drains), and a stopped broker is tested in CI.
- **S3 outage on AWS:** injecting it needs an IAM change restored by Terraform, which was left
  to an explicit operator decision. The storage-outage behavior (503 on attachment endpoints,
  task CRUD unaffected, S3 errors that are not connection failures also 503) is tested in CI.

## S3 outage on AWS: manual runbook (status: NOT RUN, awaiting operator approval)

This injection changes IAM, so it is never automated. It needs an explicit go-ahead each time it is
run. Until it has been run, the AWS row stays **NOT RUN** and only the CI coverage above applies.

**Injection.** Add one explicit-Deny inline policy, `s3-outage-drill`, to the project-service task
role. The Terraform-managed `attachments-objects` policy is left untouched. An explicit Deny
overrides it for both the service's own S3 calls (HEAD on complete, DELETE) and every presigned URL
it signs, because S3 evaluates a presigned request with the signer's permissions.

```bash
role=dpp-dev-task-project-service
bucket=$(terraform -chdir=infrastructure/terraform/environments/dev output -raw attachments_bucket)
aws iam put-role-policy --role-name "$role" --policy-name s3-outage-drill --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Effect\": \"Deny\", \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::$bucket\", \"arn:aws:s3:::$bucket/*\"]}]}"
date -u +%FT%TZ   # injection time; IAM changes take effect within seconds to about a minute
```

**Expected.**

- `POST /tasks/:id/attachments` still returns 201, because presigning is local signing. The browser's
  POST to S3 then fails with 403 AccessDenied.
- `POST /attachments/:id/complete` returns 503 `DEPENDENCY_UNAVAILABLE`, not 500 and not a false
  "uploaded".
- `GET /attachments/:id/download` returns a URL that S3 answers with 403.
- Task, board, comment and activity endpoints are unaffected, with no 5xx.
- No attachment row is marked uploaded without its object.

**Rollback.** One command; Terraform does not track this extra inline policy.

```bash
aws iam delete-role-policy --role-name "$role" --policy-name s3-outage-drill
aws iam list-role-policies --role-name "$role"   # must list exactly: attachments-objects, ecs-exec
```

**Verification after rollback.**

- `npm run aws:demo:realtime` (its attachment step uploads and downloads through S3).
- `npm run aws:audit` (IAM least privilege).
- `npm run aws:plan`, which must show no changes.
- `npm run aws:invariants`, where the attachment metadata checks must pass.
