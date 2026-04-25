#!/usr/bin/env bash
# Temporary tunnel localhost:15432 → RDS through a running project-service task (SSM port
# forwarding via ECS Exec). RDS stays private: no public endpoint, no bastion, no SSH keys.
#   npm run aws:db:tunnel           (Ctrl-C closes it)
# Then, in another terminal:
#   PGPASSWORD="$(aws secretsmanager get-secret-value --secret-id dpp-dev/app-db-user \
#      --query SecretString --output text | python3 -c 'import json,sys;print(json.load(sys.stdin)["password"])')" \
#   psql "host=localhost port=15432 dbname=dpp user=dpp_app sslmode=require"
source "$(dirname "$0")/lib.sh"
require_aws_auth
require session-manager-plugin
local_port="${DB_TUNNEL_PORT:-15432}"
cluster="$(cfg 'c["cluster"]')"
host="$(cfg 'c["rds"]["address"]')"
task="$(aws ecs list-tasks --cluster "$cluster" --service-name project-service --desired-status RUNNING --query 'taskArns[0]' --output text)"
[[ "$task" == arn:* ]] || die "no running project-service task to tunnel through"
runtime="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" --query "tasks[0].containers[?name=='project-service'].runtimeId | [0]" --output text)"
info "tunnel: localhost:${local_port} → ${host%%.*}…:5432 (via task ${task##*/})"
aws ssm start-session --target "ecs:${cluster}_${task##*/}_${runtime}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$host\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$local_port\"]}"
