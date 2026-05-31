#!/usr/bin/env bash
# Phases 6–7 in the deployed environment: eventual activity, activity outage, cache hit/miss,
# Kafka-driven invalidation, invalidator outage, Redis outage (a real node reboot).
#   npm run aws:demo
source "$(dirname "$0")/lib.sh"
require_aws_auth
exec node "$(dirname "$0")/demo.mjs" "$(cfg 'c["app_url"]')" "$(cfg 'c["cluster"]')" "$NAME_PREFIX"
