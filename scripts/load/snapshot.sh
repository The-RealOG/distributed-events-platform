#!/usr/bin/env bash
# Saves every service's Prometheus exposition (/metrics is private: read from inside the task via
# ECS Exec) to <dir>/<service>.prom.   scripts/load/snapshot.sh tests/load/results/<label>/before
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
require session-manager-plugin
dir="${1:?usage: snapshot.sh <dir>}"
mkdir -p "$dir"
cluster="$(cfg 'c["cluster"]')"
for pair in project-service:3001 api-gateway:3000 outbox-publisher:3002 activity-service:3003 cache-invalidator:3004 realtime-service:3005; do
  svc="${pair%%:*}"; port="${pair##*:}"
  task="$(aws ecs list-tasks --cluster "$cluster" --service-name "$svc" --desired-status RUNNING --query 'taskArns[0]' --output text)"
  [[ "$task" == arn:* ]] || { warn "$svc: no running task"; continue; }
  aws ecs execute-command --cluster "$cluster" --task "$task" --container "$svc" --interactive \
    --command "wget -qO- http://127.0.0.1:${port}/metrics" 2>/dev/null | grep -E '^[a-z_]+(\{|\s)' >"$dir/$svc.prom" || true
  echo "$(date -u +%FT%TZ)" >"$dir/at.txt"
  info "$svc: $(wc -l <"$dir/$svc.prom" | tr -d ' ') samples"
done
