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
image_repo_for() {
  case "$1" in
    migrate) echo project-service ;;
    *) echo "$1" ;;
  esac
}

for key in project-service api-gateway outbox-publisher migrate kafka-tools; do
  family="$(cfg "c['families']['$key']")"
  repo="$(cfg "c['ecr']['$(image_repo_for "$key")']")"
  aws ecr describe-images --repository-name "${repo#*/}" --image-ids imageTag="$sha" >/dev/null 2>&1 ||
    die "image ${repo#*/}:$sha not found in ECR (build it first: npm run aws:deploy)"
  # Take the latest revision (Terraform's configuration) and change only the image.
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    python3 -c '
import json, sys
td = json.load(sys.stdin)
for k in ["taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy","deregisteredAt"]:
    td.pop(k, None)
td["containerDefinitions"][0]["image"] = sys.argv[1]
print(json.dumps(td))' "${repo}:${sha}" > "/tmp/dpp-td-${key}.json"
  arn="$(aws ecs register-task-definition --cli-input-json "file:///tmp/dpp-td-${key}.json" --query taskDefinition.taskDefinitionArn --output text)"
  rm -f "/tmp/dpp-td-${key}.json"
  info "registered ${arn##*/}"
done

run_task migrate
run_task kafka-tools

for service in project-service api-gateway outbox-publisher; do
  family="$(cfg "c['families']['$service']")"
  aws ecs update-service --cluster "$cluster" --service "$service" --task-definition "$family" \
    --desired-count 1 --query 'service.serviceName' --output text >/dev/null
  info "rolling $service → $family (latest)"
done
info "waiting for services to become stable (failed rollouts roll back automatically)"
aws ecs wait services-stable --cluster "$cluster" --services project-service api-gateway outbox-publisher ||
  die "services did not stabilize; inspect with: npm run aws:status"
for service in project-service api-gateway outbox-publisher; do
  state="$(aws ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0].deployments[0].rolloutState' --output text)"
  [[ "$state" == "COMPLETED" ]] || die "$service rollout state: $state (rolled back?)"
done
aws ssm put-parameter --name "/${NAME_PREFIX}/image-tag" --value "$sha" --overwrite >/dev/null
info "deployed $sha: $(cfg 'c["app_url"]')"
