# Failure testing

Every row is an experiment that was actually run. **AWS** rows ran against the deployed dev
environment through the public URL (scripts in `scripts/aws/`, raw output in
`tests/failure/results/`); **CI** rows are automated real-infrastructure tests (Testcontainers
PostgreSQL/Kafka/Redis/LocalStack) that run on every change. Recovery times are wall-clock
observations of single runs, not distributions.

## Matrix

<!-- FAILURE-MATRIX -->

AWS rows ran on 2026-10-17 (deployed `0819abc`; one task per service, which is why stateless
failures show a short outage), one at a time, each with a passing smoke test immediately before
and after. Evidence: `tests/failure/results/2026-10-17-*.txt`. Data integrity for every row is
checked by the invariants audit run after all of them and the soak (see the last section).

| #   | Component / injection (method)                                              | Expected                                                                                    | Observed                                                                                                                               | Recovery (mechanism, time)                                                                                    | Manual step | Status                |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- | --------------------- |
| 1   | outbox-publisher outage (scale to 0)                                        | writes succeed; events wait in the outbox; drain after restart; nothing lost                | 300/300 writes OK with no publisher; board/activity reads unaffected                                                                   | scale-up: 300 events published in 4.2 s (72/s); visible in activity 47 s after the command (incl. task start) | no          | **PASS**              |
| 2   | api-gateway task stopped (`ecs stop-task`)                                  | ECS replaces it; requests resume                                                            | probe GET failed 33/61 (503) over 27 s                                                                                                 | ECS replacement RUNNING after 49 s                                                                            | no          | **PASS**              |
| 3   | project-service task stopped                                                | ECS replaces it; no durable state lost                                                      | probe GET failed 44/61 (503) over 38 s                                                                                                 | ECS replacement RUNNING after 50 s                                                                            | no          | **PASS**              |
| 4   | activity-service task stopped                                               | API unaffected; projection resumes                                                          | 0/74 probe failures; a new event reached activity 12 s after the replacement                                                           | ECS replacement RUNNING after 40 s                                                                            | no          | **PASS**              |
| 5   | RDS reboot (single-AZ instance; **not** a Multi-AZ failover)                | requests fail as 503 (not 500), no partial commits, pools reconnect                         | reads failed 9/43 over 9 s; writes failed 8/41, all **503 DEPENDENCY_UNAVAILABLE**; no ECS task restarted                              | pools reconnected by themselves; first write 62 s after the reboot request (0 s after RDS was available)      | no          | **PASS**              |
| 6   | MSK broker reboot (1 of 2; `kafka reboot-broker`)                           | writes continue; publication resumes through leader failover                                | 170/170 writes OK during the reboot; 0 publisher "publish failed" lines                                                                | cluster ACTIVE after 194 s; last write reached activity 0 s after ACTIVE                                      | no          | **PASS**              |
| 7   | Activity Service outage (scale to 0)                                        | writes succeed; activity stale; catch-up without duplicates                                 | backlog applied after restart; no duplicates                                                                                           | consumer resumes from committed offsets: 11.7 s after restart                                                 | no          | **PASS**              |
| 8   | cache-invalidator outage (scale to 0)                                       | boards stale (bounded by TTL); converge after restart                                       | stale while stopped                                                                                                                    | converged 6.4 s after restart                                                                                 | no          | **PASS**              |
| 9   | Redis outage (ElastiCache node reboot)                                      | reads fall back to PostgreSQL; writes unaffected; caching resumes                           | reads fell back; writes unaffected                                                                                                     | caching resumed 8.4 s later, no repair                                                                        | no          | **PASS**              |
| 10  | poison message (malformed event injected on MSK, then a valid one)          | permanent failure dead-lettered (no retries), consumer moves on, nothing else dead-lettered | DLQ empty before; after: exactly 1 record (`malformed`, `activity-service`, attempts 1, source partition/offset); live groups at lag 0 | consumer never stopped                                                                                        | no          | **PASS**              |
| 11  | realtime replica replaced (ECS redeploy) while a client is connected        | going-away close, client reconnects, live again                                             | old socket closed 1001 after 80 s; resubscribed 81 s after the redeploy began; live events resumed                                     | client reconnect + resubscribe                                                                                | no          | **PASS**              |
| 12  | realtime notification missed while disconnected                             | state restored by refetch, not by replay                                                    | board had the missed task 39 ms after resubscribing (1 read); notification not replayed                                                | invalidate-and-refetch on resubscribe                                                                         | no          | **PASS**              |
| 13  | realtime authorization (outsider, foreign Origin, bad token)                | refused                                                                                     | outsider FORBIDDEN; Origin evil.example HTTP 403; bad token close 4401                                                                 | –                                                                                                             | no          | **PASS**              |
| 14  | attachments policy (oversize, changed Content-Type, unsigned GET, outsider) | S3/API refuse                                                                               | oversize → S3 400; changed Content-Type → S3 403; unsigned GET → 403; outsider → 403                                                   | –                                                                                                             | no          | **PASS**              |
| 15  | S3 outage (IAM Deny on the project-service role)                            | see runbook below                                                                           | not executed: requires an IAM change, left to an explicit operator decision                                                            | –                                                                                                             | –           | **NOT RUN**           |
| 16  | slow WebSocket client (bounded send buffer) on AWS                          | slow client disconnected, others unaffected                                                 | not exercised on AWS (k6 cannot throttle a client's reads); covered by the realtime integration tests (CI)                             | –                                                                                                             | –           | **NOT RUN** (CI only) |
| 17  | DLQ replay (logical identity, duplicate replay)                             | replayed event keeps its eventId; replaying twice adds no side effect                       | not part of the AWS demo; covered by the kafka DLQ/replay integration tests (CI)                                                       | –                                                                                                             | –           | **NOT RUN** (CI only) |

**Durability limitation (row 6).**

- MSK runs `default.replication.factor=2` with **`min.insync.replicas=1`**. The producer uses
  `acks=-1`, `maxInFlightRequests=1` and no idempotent producer.
- With `min.insync.replicas=1`, `acks=-1` means "every _current_ in-sync replica has it". While a
  broker is down the ISR is the leader alone, so an acknowledged event can exist on one broker
  only.
- Had that broker failed before re-replication, the event would be lost from Kafka. The outbox
  would already have marked it published, so it would not be resent.
- The reboot test shows availability, not durability. `min.insync.replicas=2` would turn this into
  failed (retried) publishes during a broker outage instead. It was not changed during this work.

**Operational note (realtime consumer groups).**

- Each realtime replica uses its own consumer group (ADR-017). Every replaced replica leaves an
  Empty group behind with growing lag: six after this session.
- Kafka expires Empty groups after its offsets-retention period. Until then, any alert on consumer
  lag must exclude Empty `realtime-service.*` groups, or it fires falsely.

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
