#!/usr/bin/env bash
# Deploys the current main commit to AWS dev, without local Docker:
#   1. verify AWS auth and that HEAD is committed and pushed to origin/main
#   2. (--infra) terraform plan + apply
#   3. GitHub Actions builds images remotely → ECR, publishes the web app, runs rollout.sh
#      (migrations, Kafka topics, rolling update, stability wait) and a smoke test
#   4. print the app URL
#   npm run aws:deploy [-- --infra]
source "$(dirname "$0")/lib.sh"
require_aws_auth
require gh
cd "$REPO_ROOT"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || die "deploy from main (the AWS deploy role trusts main only)"
[[ -z "$(git status --porcelain)" ]] || die "working tree has uncommitted changes; commit first"
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "HEAD is not pushed: git push origin main"
sha="$(git rev-parse HEAD)"

if [[ "${1:-}" == "--infra" ]]; then
  "$(dirname "$0")/plan.sh"
  "$(dirname "$0")/apply.sh"
fi

info "triggering remote build + deploy of ${sha:0:7}"
gh workflow run deploy.yml --ref main
sleep 5
run_id="$(gh run list --workflow deploy.yml --branch main --limit 1 --json databaseId,headSha --jq ".[] | select(.headSha==\"$sha\") | .databaseId")"
[[ -n "$run_id" ]] || die "could not find the workflow run"
gh run watch "$run_id" --exit-status --interval 15 || die "deploy workflow failed: gh run view $run_id --log-failed"
info "deployed ${sha:0:7}: $(cfg 'c["app_url"]')"
