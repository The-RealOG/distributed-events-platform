#!/usr/bin/env bash
# Applies database migrations with a one-shot ECS task inside the VPC (never on service start,
# so replicas cannot race). Also (re)creates the least-privilege app role.   npm run aws:migrate
source "$(dirname "$0")/lib.sh"
require_aws_auth
run_task migrate
