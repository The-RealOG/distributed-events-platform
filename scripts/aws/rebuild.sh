#!/usr/bin/env bash
# Rebuilds the whole dev environment from nothing, in one command: the counterpart of
# aws:destroy (for demos). Everything comes from the repository; no console steps.
#   1. state bucket (idempotent)
#   2. terraform plan → shown → confirm → apply   (VPC, RDS, MSK, ElastiCache, ALB, CloudFront,
#      ECS cluster/services at 0 tasks, ECR, IAM/OIDC, secrets, S3; ~30–45 min, mostly MSK)
#   3. deploy the current main commit: GitHub Actions builds the 7 images → ECR, publishes the web
#      app, runs migrations and topic creation, rolls every service to 1 task, smoke test
#   4. verify: terraform plan shows no drift; print the app URL
#   npm run aws:rebuild            (asks before creating billable resources)
#   npm run aws:rebuild -- --yes   (no prompt)
# Prerequisites: AWS CLI authenticated, gh authenticated, on main with everything pushed.
source "$(dirname "$0")/lib.sh"
require_aws_auth
require gh
require terraform
cd "$REPO_ROOT"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || die "rebuild from main (the AWS deploy role trusts main only)"
[[ -z "$(git status --porcelain)" ]] || die "working tree has uncommitted changes; commit and push first"
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "HEAD is not pushed: git push origin main"

started=$(date +%s)
info "1/4 state bucket"
"$(dirname "$0")/bootstrap.sh"

info "2/4 infrastructure plan"
"$(dirname "$0")/plan.sh" -no-color | grep -E '^\s+# .* will be|^Plan:|No changes' || true
if [[ "${1:-}" != "--yes" ]]; then
  warn "This creates billable resources (MSK 2 × kafka.t3.small, RDS db.t4g.micro, ElastiCache cache.t4g.micro,"
  warn "an ALB, CloudFront, 6 Fargate tasks with public IPv4). Rates: npm run aws:cost-info. Remove with npm run aws:destroy."
  read -r -p "Type 'rebuild' to apply: " answer
  [[ "$answer" == "rebuild" ]] || die "not confirmed; nothing applied"
fi
"$(dirname "$0")/apply.sh"

info "3/4 build and deploy $(git rev-parse --short HEAD) (GitHub Actions: images, migrations, topics, rollout, smoke)"
"$(dirname "$0")/deploy.sh"

info "4/4 verify: no drift after the deploy"
tf_init
# The deploy registers task-definition revisions and records the image tag outside Terraform (both
# tracked by design); a refresh-only apply saves them to state, including the image_tag output,
# which otherwise still reads "bootstrap" after a first deploy and makes the check below report a
# difference with no resource changes. It changes no infrastructure.
terraform -chdir="$TF_DIR" apply -refresh-only -auto-approve -input=false -no-color >/dev/null
set +e
terraform -chdir="$TF_DIR" plan -input=false -detailed-exitcode -no-color >"$TF_DIR/drift.txt" 2>&1
drift=$?
set -e
case $drift in
  0) info "terraform plan: no changes" ;;
  2) warn "terraform plan shows changes:"; grep -E '^\s+# |^Plan:|^Changes to Outputs' "$TF_DIR/drift.txt" >&2 ;;
  *) warn "terraform plan failed:"; tail -20 "$TF_DIR/drift.txt" >&2 ;;
esac
"$(dirname "$0")/status.sh" || true
info "rebuilt in $(( ($(date +%s) - started) / 60 )) min: $(cfg 'c["app_url"]')"
