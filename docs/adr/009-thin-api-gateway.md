# ADR-009: Thin API Gateway as the single external entry point

**Status:** Accepted

## Context

The browser needs to call the platform's HTTP APIs: the Project Service, and the Realtime
Service over WebSockets, with the platform on AWS behind a load balancer. If the browser knew
every service's address, each new service would add another origin to configure, another CORS
policy to keep
consistent, and another place where correlation IDs, body limits and security headers could
drift. Internal service addresses would also leak into client bundles.

## Decision

`apps/api-gateway` is the only backend origin the browser knows (`VITE_API_BASE_URL`). It is a
reverse proxy with a fixed routing table and owns only transport concerns:

| Owns                                                                             | Explicitly does not own                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Routing `/api/<prefix>` to the owning service (allowlisted prefixes; else 404)   | Authentication decisions (the JWT is forwarded; services verify it) |
| CORS allowlist, security headers, request body size limit                        | Authorization, membership, roles                                    |
| Establishing/propagating `x-correlation-id`; its own per-hop `x-request-id`      | Domain validation, business rules                                   |
| Forwarding an allowlist of request headers (`authorization`, `content-type`, …)  | Database access                                                     |
| Upstream connect/response timeouts; translating upstream failure into a safe 503 | Optimistic concurrency, retries of any kind                         |
| Structured request logging, `/health`, `/ready`, graceful shutdown               | Response shaping / aggregation (not a BFF yet)                      |

Specific choices:

- **No retries at the gateway, for any method.** A POST or PATCH whose response was lost may
  already have been applied, so replaying it could duplicate the operation. `@fastify/reply-from`
  retries GETs on upstream 503 up to 10 times by default, and that count can't be set to zero
  (`0 || 10`). The gateway therefore passes `retryMethods: []`, and a test asserts that exactly
  one upstream call is made. Reads are retried by the browser's query layer, with backoff and
  a limit on attempts.
- **Timeouts are explicit.** Connect: 2 s. Response headers/body: 15 s, deliberately longer
  than the Project Service's 10 s statement timeout, so the service's own 503 arrives first.
  Only a request that was never sent (connection refused, DNS failure, connect timeout) is a
  confirmed failure: 503 `DEPENDENCY_UNAVAILABLE`, `reason: upstream_unreachable`. Once a
  mutation may have reached the Project Service (response timeout, or the connection dropped),
  the gateway returns 504 `OUTCOME_UNKNOWN` (`reason: upstream_timeout` or
  `upstream_connection_lost`), telling the client to refetch rather than resubmit. Reads get 503
  in every case.
- **Bodies are forwarded as bytes.** The gateway enforces size but does not parse JSON. The
  owning service validates. (A test pins this: reply-from would otherwise re-serialize a Buffer
  body as `{"type":"Buffer",…}`.)
- **Request IDs are per hop; correlation IDs span hops.** The gateway never forwards the
  client's `x-request-id`. Each service mints its own, and they are joined by
  `x-correlation-id`. That same ID is carried into every Kafka event the request causes.
- **Readiness reflects the gateway only.** If the Project Service is down, the gateway still
  answers quickly with 503. Marking it unready would just make the load balancer return errors
  instead.

## Alternatives considered

- **Browser talks to each service directly.** Multiple origins, duplicated CORS/header
  policy, internal topology exposed to clients, harder migration to ALB routing.
- **Vite dev-server proxy.** Only exists in development; production would behave differently.
- **A BFF that aggregates responses.** Not needed yet. It would pull presentation logic into
  the gateway. It can be added later behind the same origin if a real need appears.
- **An off-the-shelf gateway (nginx/Envoy/Kong).** Viable in AWS (ALB path routing covers most
  of it). A small Fastify gateway keeps the same logging/correlation code as the services and
  is testable in-process. Replacing it with ALB rules later changes only infrastructure.

## Consequences

- One more network hop on every request.
- Adding a service means adding a routing prefix here, with no browser changes.
- In AWS, this maps to an ECS service behind the ALB (or ALB listener rules plus a thin
  service for correlation/CORS if we choose to drop the process).
