# Performance: methodology, criteria and results

This file is written in two steps. The **success criteria** below were committed before any
measured run (see this file's git history), so they cannot have been tuned to the results.
The results sections are filled in only from the raw evidence in `tests/load/results/`.

## Success criteria (fixed before measuring)

A load level counts as **sustained** only if all of these hold over the steady phase:

| Signal         | Criterion                                                                                                     | Source                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Request errors | < 1 % of requests (409 version conflicts are expected under contention and counted separately, not as errors) | k6 `http_req_failed`                                         |
| Latency        | overall p95 < 500 ms and p99 < 1500 ms; every operation p95 < 1000 ms                                         | k6 per-`op` trends                                           |
| Outbox         | pending count at the end of the run is not growing (within one poll batch, ≤ 50) and oldest pending age < 5 s | `outbox_pending_events`, `outbox_oldest_pending_age_seconds` |
| Consumers      | no dead-letters or retries attributable to load; lag returns to ~0 after the run                              | consumer metrics, `kafka-tools groups`                       |
| Database       | no sustained pool waiting; RDS CPU below 90 % per-minute maximum                                              | `db_pool_waiting_requests`, CloudWatch                       |
| Services       | no ECS task restarts; CPU below 90 % per-minute maximum                                                       | CloudWatch, ECS events                                       |
| Realtime       | > 99 % of sockets subscribe; notification p95 < 2 s after the writer's HTTP 201; delivery ≥ 99 % of expected  | `tests/load/realtime.js`                                     |

The **saturation point** is the first load level at which any criterion fails, together with
the component that explains it.

Thresholds may be revised only with a documented reason in this file; none have been.
