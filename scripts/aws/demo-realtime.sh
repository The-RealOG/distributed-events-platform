#!/usr/bin/env bash
# In the deployed environment: realtime between two users, refusals, reconnect
# reconciliation, realtime replica replacement, direct-to-S3 attachments.
#   npm run aws:demo:realtime
source "$(dirname "$0")/lib.sh"
require_aws_auth
exec node "$(dirname "$0")/demo-realtime.mjs" "$(cfg 'c["app_url"]')" "$(cfg 'c["cluster"]')"
