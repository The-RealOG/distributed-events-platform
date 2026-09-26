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
