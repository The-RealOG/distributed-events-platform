#!/usr/bin/env bash
# CPU profile of a running service under whatever load it has right now (bottleneck
# analysis).   scripts/aws/cpu-profile.sh [service=project-service] [seconds=20]
# The inspector opened by SIGUSR1 listens on 127.0.0.1 inside the task only; redeploying or
# replacing the task closes it.
source "$(dirname "$0")/lib.sh"
require_aws_auth
require session-manager-plugin
svc="${1:-project-service}"; secs="${2:-20}"
cluster="$(cfg 'c["cluster"]')"
task="$(aws ecs list-tasks --cluster "$cluster" --service-name "$svc" --desired-status RUNNING --query 'taskArns[0]' --output text)"
b64="$(base64 <"$(dirname "$0")/cpu-profile.mjs" | tr -d '\n')"
aws ecs execute-command --cluster "$cluster" --task "$task" --container "$svc" --interactive \
  --command "sh -c \"echo $b64 | base64 -d > /tmp/cpu-profile.mjs && node /tmp/cpu-profile.mjs $secs\"" </dev/null 2>/dev/null |
  grep -vE '^(Starting session|Exiting session|The Session Manager plugin)' | tr -d '\r'
