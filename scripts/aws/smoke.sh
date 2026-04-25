#!/usr/bin/env bash
# The deployed chain end to end: HTTPS → CloudFront → ALB → api-gateway → project-service → RDS.
# Reuses scripts/smoke.mjs (login, workspace, project, task, update, stale edit → 409, move,
# comment, board), plus checks that the web app is served.   npm run aws:smoke
source "$(dirname "$0")/lib.sh"
require_aws_auth
url="$(cfg 'c["app_url"]')"
info "web app: $url"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url/")"
[[ "$code" == "200" ]] || die "web app returned $code"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url/projects/deep/link")"
[[ "$code" == "200" ]] || die "SPA deep link returned $code"
info "API: $url/api"
node "$REPO_ROOT/scripts/smoke.mjs" "$url/api"
