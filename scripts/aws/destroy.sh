#!/usr/bin/env bash
# Tears down the dev environment (everything Terraform created), after confirmation.
# Survives: the Terraform state bucket (npm run aws:destroy:all removes it too).
# Gone, by design: RDS (no final snapshot), buckets and ECR images (force-emptied), secrets
# (no recovery window), log groups, task-definition revisions.   npm run aws:destroy
source "$(dirname "$0")/lib.sh"
require_aws_auth
confirm_destructive "DESTROY the '${DPP_ENV}' environment (RDS data, MSK topics, images, logs, secrets)"
tf_init
terraform -chdir="$TF_DIR" destroy -input=false -auto-approve
# Task-definition revisions registered by deploys are outside Terraform: deregister and delete.
for family in project-service api-gateway outbox-publisher migrate kafka-tools activity-service cache-invalidator realtime-service; do
  arns="$(aws ecs list-task-definitions --family-prefix "${NAME_PREFIX}-${family}" --query 'taskDefinitionArns' --output text)"
  for arn in $arns; do aws ecs deregister-task-definition --task-definition "$arn" >/dev/null; done
  inactive="$(aws ecs list-task-definitions --family-prefix "${NAME_PREFIX}-${family}" --status INACTIVE --query 'taskDefinitionArns' --output text)"
  [[ -n "$inactive" ]] && aws ecs delete-task-definitions --task-definitions $inactive >/dev/null || true
done
left="$(aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=dpp Key=Environment,Values="$DPP_ENV" --query 'ResourceTagMappingList[].ResourceARN' --output text)"
[[ -z "$left" ]] && info "no tagged resources remain" || warn "still listed (may be deleting): $left"
info "destroyed. Remaining: state bucket $(state_bucket) (cents/month). Remove with npm run aws:destroy:all"
