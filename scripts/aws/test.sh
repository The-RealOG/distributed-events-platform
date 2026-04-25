#!/usr/bin/env bash
# Cloud verification suite against the deployed dev environment.   npm run aws:test
source "$(dirname "$0")/lib.sh"
require_aws_auth
cluster="$(cfg 'c["cluster"]')"
here="$(dirname "$0")"

run_smoke() { # prints the smoke run's correlation ID
  local out
  out="$("$here/smoke.sh" 2>&1 | tee /dev/stderr)" || die "smoke test failed"
  grep -o 'correlationId=smoke-[0-9a-f-]*' <<<"$out" | tail -1 | cut -d= -f2
}

logged_in() { # <service> <text>: waits (≤90 s) until the text appears in the service's logs
  local group deadline
  group="$(cfg "c['log_groups']['$1']")"
  deadline=$((SECONDS + 90))
  while ((SECONDS < deadline)); do
    n="$(aws logs filter-log-events --log-group-name "$group" --start-time $(( ($(date +%s) - 900) * 1000 )) \
      --filter-pattern "\"$2\"" --query 'length(events)' --output text 2>/dev/null || echo 0)"
    [[ "$n" != "0" && "$n" != "None" ]] && { echo "$n"; return 0; }
    sleep 5
  done
  echo 0; return 1
}

info "1/5 smoke test (CloudFront → ALB → gateway → project-service → RDS, stale edit → 409)"
cid="$(run_smoke)"

info "2/5 correlation ID $cid in CloudWatch logs of every hop"
for svc in api-gateway project-service; do
  n="$(logged_in "$svc" "$cid")" || die "$cid not found in $svc logs"
  info "  $svc: $n log lines"
done
n="$(logged_in outbox-publisher "$cid")" || die "$cid not found in outbox-publisher logs (events not published to MSK?)"
info "  outbox-publisher: $n lines (events published to MSK with the request's correlation ID)"

info "3/5 Kafka probe inside the VPC"
"$here/kafka-probe.sh"

info "4/5 security boundaries"
"$here/security-check.sh"

info "5/5 independence: Kafka path unavailable (publisher scaled to 0) → CRUD still works"
aws ecs update-service --cluster "$cluster" --service outbox-publisher --desired-count 0 >/dev/null
aws ecs wait services-stable --cluster "$cluster" --services outbox-publisher
cid2="$(run_smoke)"
info "  CRUD succeeded with no path to Kafka; restoring the publisher"
aws ecs update-service --cluster "$cluster" --service outbox-publisher --desired-count 1 >/dev/null
aws ecs wait services-stable --cluster "$cluster" --services outbox-publisher
n="$(logged_in outbox-publisher "$cid2")" || die "backlog from $cid2 was not published after recovery"
info "  backlog drained: $n publish log lines for $cid2"
info "all cloud tests passed"
