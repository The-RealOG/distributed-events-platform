#!/usr/bin/env bash
# Shared helpers for scripts/aws/*. Source it; do not execute it.
set -euo pipefail

# Tools installed as standalone binaries (terraform, session-manager-plugin) live here.
export PATH="$HOME/.local/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$REPO_ROOT/infrastructure/terraform/environments/${DPP_ENV:-dev}"
export DPP_ENV="${DPP_ENV:-dev}"
export AWS_REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""
PROJECT="dpp"
NAME_PREFIX="$PROJECT-$DPP_ENV"

info() { printf '\033[36m▶ %s\033[0m\n' "$*" >&2; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

require() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (see docs/aws-development.md#prerequisites)"; }

# Verifies credentials without printing secrets; exports AWS_ACCOUNT_ID.
require_aws_auth() {
  require aws
  local identity
  identity="$(aws sts get-caller-identity --query '[Account,Arn]' --output text 2>/dev/null)" ||
    die "AWS CLI is not authenticated. Run: aws configure sso   (or: aws login) and retry."
  AWS_ACCOUNT_ID="$(cut -f1 <<<"$identity")"
  export AWS_ACCOUNT_ID
  info "AWS account ${AWS_ACCOUNT_ID} as $(cut -f2 <<<"$identity" | sed 's#.*/##') in ${AWS_REGION} (env: ${DPP_ENV})"
}

state_bucket() { echo "${PROJECT}-tfstate-${AWS_ACCOUNT_ID}-${AWS_REGION}"; }

# terraform init against the remote state (idempotent, quiet).
tf_init() {
  require terraform
  terraform -chdir="$TF_DIR" init -input=false -upgrade=false \
    -backend-config="bucket=$(state_bucket)" \
    -backend-config="key=${DPP_ENV}/terraform.tfstate" \
    -backend-config="region=${AWS_REGION}" >/dev/null
}

tf_output() { terraform -chdir="$TF_DIR" output -raw "$1" 2>/dev/null; }

# Guards every destructive operation: right environment, and a human who types it.
confirm_destructive() {
  local what="$1"
  [[ "$DPP_ENV" == "dev" || "${DPP_ALLOW_NON_DEV:-}" == "yes-i-am-sure" ]] ||
    die "Refusing: environment is '$DPP_ENV', not 'dev' (set DPP_ALLOW_NON_DEV=yes-i-am-sure to override)."
  local expected="${DPP_EXPECTED_ACCOUNT_ID:-}"
  if [[ -n "$expected" && "$expected" != "$AWS_ACCOUNT_ID" ]]; then
    die "Refusing: account $AWS_ACCOUNT_ID does not match DPP_EXPECTED_ACCOUNT_ID=$expected"
  fi
  warn "About to $what"
  warn "  account=$AWS_ACCOUNT_ID region=$AWS_REGION env=$DPP_ENV"
  if [[ "${DPP_CONFIRM:-}" == "$NAME_PREFIX" ]]; then return 0; fi
  [[ -t 0 ]] || die "Not a terminal: set DPP_CONFIRM=$NAME_PREFIX to confirm non-interactively."
  local answer
  read -r -p "Type '$NAME_PREFIX' to continue: " answer
  [[ "$answer" == "$NAME_PREFIX" ]] || die "Aborted."
}

# Non-secret deployment facts written by Terraform to SSM (/dpp-<env>/deploy-config). Scripts and
# the GitHub deploy workflow read this instead of Terraform state.
DEPLOY_CONFIG_JSON=""
deploy_config() {
  if [[ -z "$DEPLOY_CONFIG_JSON" ]]; then
    DEPLOY_CONFIG_JSON="$(aws ssm get-parameter --name "/${NAME_PREFIX}/deploy-config" \
      --query Parameter.Value --output text 2>/dev/null)" ||
      die "No deploy config in SSM: the environment is not provisioned (npm run aws:apply)."
  fi
  printf '%s' "$DEPLOY_CONFIG_JSON"
}
# cfg <python expression over `c`>, e.g. cfg 'c["cluster"]' or cfg '",".join(c["task_subnets"])'
cfg() { deploy_config | python3 -c "import json,sys; c=json.load(sys.stdin); v=$1; print(v if isinstance(v,str) else json.dumps(v))"; }

# Runs a one-off ECS task (latest ACTIVE revision of a family) inside the VPC, prints its logs,
# and fails with the container's exit code. Usage: run_task <family> [command args...]
run_task() {
  local key="$1"; shift
  local cluster family subnets sg overrides task_arn
  cluster="$(cfg 'c["cluster"]')"
  family="$(cfg "c['families']['$key']")"
  subnets="$(cfg '",".join(c["task_subnets"])')"
  sg="$(cfg "c['security_groups']['$key']")"
  overrides="{}"
  if [[ $# -gt 0 ]]; then
    overrides="$(python3 -c 'import json,sys; print(json.dumps({"containerOverrides":[{"name":sys.argv[1],"command":sys.argv[2:]}]}))' "$key" "$@")"
  fi
  info "running one-off task $family ${*:+($*)}"
  task_arn="$(aws ecs run-task --cluster "$cluster" --task-definition "$family" \
    --launch-type FARGATE --count 1 --started-by scripts-aws \
    --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${sg}],assignPublicIp=ENABLED}" \
    --overrides "$overrides" --query 'tasks[0].taskArn' --output text)"
  [[ "$task_arn" == arn:* ]] || die "run-task failed"
  info "task ${task_arn##*/} started; waiting for it to finish"
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task_arn" || warn "wait timed out; checking status"
  aws logs get-log-events --log-group-name "$(cfg "c['log_groups']['$key']")" \
    --log-stream-name "${key}/${key}/${task_arn##*/}" --start-from-head \
    --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' || warn "no logs found"
  local code reason
  code="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --query "tasks[0].containers[0].exitCode" --output text)"
  reason="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task_arn" --query "tasks[0].stoppedReason" --output text)"
  [[ "$code" == "0" ]] || die "task $family failed: exit=$code ($reason)"
  info "task $family succeeded"
}
