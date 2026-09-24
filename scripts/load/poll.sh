#!/usr/bin/env bash
# Samples the outbox backlog and the Project Service DB pool from inside the tasks every ~15 s,
# appending "<UTC time> <service> <sample>" lines to <file>.   scripts/load/poll.sh <file>
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
file="${1:?usage: poll.sh <file>}"
cluster="$(cfg 'c["cluster"]')"
while :; do
  for pair in outbox-publisher:3002 project-service:3001; do
    svc="${pair%%:*}"; port="${pair##*:}"
    task="$(aws ecs list-tasks --cluster "$cluster" --service-name "$svc" --desired-status RUNNING --query 'taskArns[0]' --output text)"
    now="$(date -u +%T)"
    aws ecs execute-command --cluster "$cluster" --task "$task" --container "$svc" --interactive \
      --command "sh -c \"wget -qO- http://127.0.0.1:${port}/metrics | grep -E '^(outbox_pending_events|outbox_oldest_pending_age_seconds|outbox_published_total|db_pool_waiting_requests|db_pool_connections)'\"" \
      </dev/null 2>/dev/null | grep -E '^[a-z_]+' | sed "s/^/$now $svc /" >>"$file" || true
  done
  sleep 15
done
