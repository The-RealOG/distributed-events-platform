#!/usr/bin/env bash
# Failure injections (publisher outage, ECS task stops, RDS reboot, MSK broker reboot).
#   npm run aws:demo:failures [-- publisher|tasks|rds|kafka]
source "$(dirname "$0")/lib.sh"
require_aws_auth
msk_arn="$(aws kafka list-clusters-v2 --cluster-name-filter "$(cfg 'c["msk_cluster"]')" --query 'ClusterInfoList[0].ClusterArn' --output text)"
exec node "$(dirname "$0")/demo-failures.mjs" "$(cfg 'c["app_url"]')" "$(cfg 'c["cluster"]')" "$(cfg 'c["rds"]["identifier"]')" "$msk_arn" "${1:-}"
