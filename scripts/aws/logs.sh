#!/usr/bin/env bash
# Tails a service's CloudWatch logs (JSON lines from Pino).
#   npm run aws:logs -- project-service            follow live
#   npm run aws:logs -- api-gateway --since 1h     last hour, then follow
#   npm run aws:logs -- project-service --filter <correlationId>   search (no follow)
source "$(dirname "$0")/lib.sh"
require_aws_auth
service="${1:-}"; shift || true
[[ -n "$service" ]] || die "usage: npm run aws:logs -- <api-gateway|project-service|outbox-publisher|migrate|kafka-tools> [--since 10m] [--filter text]"
group="$(cfg "c['log_groups'].get('$service','')")"
[[ -n "$group" ]] || die "unknown service '$service'"
since="10m"; filter=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) since="$2"; shift 2 ;;
    --filter) filter="$2"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
if [[ -n "$filter" ]]; then
  aws logs tail "$group" --since "$since" --format short --filter-pattern "\"$filter\""
else
  aws logs tail "$group" --since "$since" --format short --follow
fi
