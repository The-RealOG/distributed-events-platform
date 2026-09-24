#!/usr/bin/env bash
# Saves every service's Prometheus samples (/metrics is private: read from inside the task via
# ECS Exec) to <dir>/<service>.prom.   scripts/load/snapshot.sh tests/load/results/<label>/before
# ECS Exec output is cut off at ~6 KB when stdout is not a terminal, so the exposition is fetched
# in line ranges, without comments and histogram buckets (sums and counts are kept).
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
require session-manager-plugin
dir="${1:?usage: snapshot.sh <dir>}"
mkdir -p "$dir"
cluster="$(cfg 'c["cluster"]')"
chunk=25
for pair in project-service:3001 api-gateway:3000 outbox-publisher:3002 activity-service:3003 cache-invalidator:3004 realtime-service:3005; do
  svc="${pair%%:*}"; port="${pair##*:}"
  task="$(aws ecs list-tasks --cluster "$cluster" --service-name "$svc" --desired-status RUNNING --query 'taskArns[0]' --output text)"
  [[ "$task" == arn:* ]] || { warn "$svc: no running task"; continue; }
  : >"$dir/$svc.prom"
  for ((start = 1; start < 2000; start += chunk)); do
    part="$(aws ecs execute-command --cluster "$cluster" --task "$task" --container "$svc" --interactive \
      --command "sh -c \"wget -qO- http://127.0.0.1:${port}/metrics | grep -v '^#' | grep -v '_bucket{' | grep -vE '^nodejs_(heap_space|gc_|active_)' | sed -n '${start},$((start + chunk - 1))p'\"" \
      </dev/null 2>/dev/null | grep -E '^[a-z_]+(\{|\s)' || true)"
    [[ -z "$part" ]] && break
    printf '%s\n' "$part" >>"$dir/$svc.prom"
  done
  info "$svc: $(wc -l <"$dir/$svc.prom" | tr -d ' ') samples"
done
date -u +%FT%TZ >"$dir/at.txt"
