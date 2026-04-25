#!/usr/bin/env bash
# Applies the reviewed plan from aws:plan (or plans and asks for approval).   npm run aws:apply
source "$(dirname "$0")/lib.sh"
require_aws_auth
tf_init
if [[ -f "$TF_DIR/dev.tfplan" && "${1:-}" != "--replan" ]]; then
  info "applying saved plan (review it with: terraform -chdir=$TF_DIR show dev.tfplan)"
  terraform -chdir="$TF_DIR" apply -input=false dev.tfplan
  rm -f "$TF_DIR/dev.tfplan"
else
  terraform -chdir="$TF_DIR" apply -input=false
fi
info "app URL: $(tf_output app_url)"

# Point the GitHub deploy workflow at the OIDC role (a repository variable, not a secret: it is
# an identifier, and only this repository's main branch can assume it).
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh variable set AWS_DEPLOY_ROLE_ARN --body "$(tf_output github_deploy_role_arn)" >/dev/null &&
    info "GitHub variable AWS_DEPLOY_ROLE_ARN set"
fi
