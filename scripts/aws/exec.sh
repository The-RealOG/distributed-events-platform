#!/usr/bin/env bash
# Opens a shell in a running service container via ECS Exec (SSM; no SSH, no open ports).
#   npm run aws:exec -- project-service [command]
source "$(dirname "$0")/lib.sh"
require_aws_auth
require session-manager-plugin
service="${1:-}"; shift || true
[[ -n "$service" ]] || die "usage: npm run aws:exec -- <api-gateway|project-service|outbox-publisher> [command]"
cluster="$(cfg 'c["cluster"]')"
task="$(aws ecs list-tasks --cluster "$cluster" --service-name "$service" --desired-status RUNNING --query 'taskArns[0]' --output text)"
[[ "$task" == arn:* ]] || die "no running task for $service"
aws ecs execute-command --cluster "$cluster" --task "$task" --container "$service" --interactive --command "${*:-/bin/sh}"
