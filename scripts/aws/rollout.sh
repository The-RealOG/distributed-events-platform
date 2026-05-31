#!/usr/bin/env bash
# Deploys already-built images of one git SHA. Used by the GitHub deploy workflow after it builds
# and pushes images; also the rollback tool:  scripts/aws/rollout.sh <previous-sha>
#   1. register new task-definition revisions pointing at <sha> (all five families)
#   2. run migrations (one-shot task); stop on failure
#   3. ensure Kafka topics (one-shot task)
#   4. roll the three services; wait for stability (circuit breaker rolls back failed rollouts)
#   5. record <sha> as deployed (SSM image-tag), so Terraform keeps using it
source "$(dirname "$0")/lib.sh"
require_aws_auth
sha="${1:-}"
[[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "usage: rollout.sh <git-sha>"

cluster="$(cfg 'c["cluster"]')"
# Families and long-running services come from Terraform (deploy config), not a list kept here.
families="$(cfg '" ".join(c["families"])')"
services="$(cfg '" ".join(c["services"])')"
image_repo_for() {
  case "$1" in
    migrate) echo project-service ;;
    *) echo "$1" ;;
  esac
}

for key in $families; do
  family="$(cfg "c['families']['$key']")"
  repo="$(cfg "c['ecr']['$(image_repo_for "$key")']")"
  aws ecr describe-images --repository-name "${repo#*/}" --image-ids imageTag="$sha" >/dev/null 2>&1 ||
    die "image ${repo#*/}:$sha not found in ECR (build it first: npm run aws:deploy)"
  # Take the latest revision (Terraform's configuration) and change only the image.
  # --include TAGS: carry Terraform's tags over, so the revision matches Terraform's (no drift).
  aws ecs describe-task-definition --task-definition "$family" --include TAGS --output json |
    python3 -c '
import json, sys
described = json.load(sys.stdin)
td = described["taskDefinition"]
if described.get("tags"):
    td["tags"] = described["tags"]
for k in ["taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy","deregisteredAt"]:
    td.pop(k, None)
td["containerDefinitions"][0]["image"] = sys.argv[1]
print(json.dumps(td))' "${repo}:${sha}" > "/tmp/dpp-td-${key}.json"
  arn="$(aws ecs register-task-definition --cli-input-json "file:///tmp/dpp-td-${key}.json" --query taskDefinition.taskDefinitionArn --output text)"
  rm -f "/tmp/dpp-td-${key}.json"
  printf -v "arn_${key//-/_}" '%s' "$arn" # bash 3.2 (macOS) has no associative arrays
  info "registered ${arn##*/}"
done

run_task migrate
run_task kafka-tools

for service in $services; do
  family="$(cfg "c['families']['$service']")"
  arn_var="arn_${service//-/_}"
  aws ecs update-service --cluster "$cluster" --service "$service" --task-definition "${!arn_var}" \
    --desired-count 1 --query 'service.serviceName' --output text >/dev/null
  info "rolling $service → $family (latest)"
done
info "waiting for services to become stable (failed rollouts roll back automatically)"
# shellcheck disable=SC2086 # word splitting intended
aws ecs wait services-stable --cluster "$cluster" --services $services ||
  die "services did not stabilize; inspect with: npm run aws:status"
# "Stable" (running == desired) can precede ECS marking the deployment COMPLETED, and after a
# circuit-breaker rollback the primary deployment is the OLD revision, also COMPLETED. So wait
# for the deployment of the revision registered above to reach COMPLETED; fail on FAILED or if
# that revision is no longer the primary deployment.
for service in $services; do
  arn_var="arn_${service//-/_}"
  deadline=$((SECONDS + 600))
  while :; do
    read -r primary state <<<"$(aws ecs describe-services --cluster "$cluster" --services "$service" \
      --query 'services[0].deployments[?status==`PRIMARY`] | [0].[taskDefinition,rolloutState]' --output text)"
    [[ "$primary" == "${!arn_var}" ]] || die "$service: primary deployment is ${primary##*/}, not ${!arn_var##*/} (rolled back)"
    [[ "$state" == "COMPLETED" ]] && break
    [[ "$state" == "FAILED" ]] && die "$service rollout FAILED (circuit breaker)"
    ((SECONDS < deadline)) || die "$service rollout still $state after 10 minutes"
    sleep 10
  done
  info "$service: ${primary##*/} COMPLETED"
done
aws ssm put-parameter --name "/${NAME_PREFIX}/image-tag" --value "$sha" --overwrite >/dev/null
info "deployed $sha: $(cfg 'c["app_url"]')"
