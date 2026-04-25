#!/usr/bin/env bash
# One-screen summary of the dev environment, without secrets.   npm run aws:status
source "$(dirname "$0")/lib.sh"
require_aws_auth
if ! deploy_config >/dev/null 2>&1; then
  warn "environment not provisioned (no deploy config). Next: npm run aws:bootstrap && npm run aws:plan"
  exit 0
fi
cluster="$(cfg 'c["cluster"]')"
printf '\n%-18s %s\n' "App URL" "$(cfg 'c["app_url"]')"
printf '%-18s %s\n' "Deployed image" "$(aws ssm get-parameter --name "/${NAME_PREFIX}/image-tag" --query Parameter.Value --output text)"

printf '\n%s\n' "ECS services (cluster $cluster)"
aws ecs describe-services --cluster "$cluster" --services project-service api-gateway outbox-publisher \
  --query 'services[].[serviceName,desiredCount,runningCount,deployments[0].rolloutState,split(`:`, taskDefinition)[-1]]' \
  --output text | awk '{printf "  %-18s desired=%s running=%s rollout=%-12s taskdef-rev=%s\n",$1,$2,$3,$4,$5}'

tg="$(aws elbv2 describe-target-groups --names "${NAME_PREFIX}-gateway" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
if [[ "$tg" == arn:* ]]; then
  printf '\n%-18s %s\n' "ALB targets" "$(aws elbv2 describe-target-health --target-group-arn "$tg" --query 'TargetHealthDescriptions[].TargetHealth.State' --output text | tr '\t' ' ')"
fi
printf '%-18s %s\n' "CloudFront" "$(aws cloudfront get-distribution --id "$(cfg 'c["distribution_id"]')" --query 'Distribution.Status' --output text)"
printf '%-18s %s\n' "RDS" "$(aws rds describe-db-instances --db-instance-identifier "$(cfg 'c["rds"]["identifier"]')" --query 'DBInstances[0].[DBInstanceStatus,DBInstanceClass,EngineVersion,PubliclyAccessible]' --output text | awk '{print $1" "$2" pg"$3" public="$4}')"
printf '%-18s %s\n' "MSK" "$(aws kafka list-clusters-v2 --cluster-name-filter "$(cfg 'c["msk_cluster"]')" --query 'ClusterInfoList[0].[State,Provisioned.BrokerNodeGroupInfo.InstanceType,Provisioned.NumberOfBrokerNodes,Provisioned.CurrentBrokerSoftwareInfo.KafkaVersion]' --output text)"
redis="$(aws elasticache describe-replication-groups --replication-group-id "${NAME_PREFIX}" --query 'ReplicationGroups[0].Status' --output text 2>/dev/null || echo 'not provisioned (enable_redis=false)')"
printf '%-18s %s\n' "Redis" "$redis"
printf '%-18s %s\n' "Web bucket" "$(aws s3api get-public-access-block --bucket "$(cfg 'c["web_bucket"]')" --query 'PublicAccessBlockConfiguration.RestrictPublicBuckets' --output text | sed 's/True/private (public access blocked)/')"

printf '\n%s\n' "Recent deployments (GitHub Actions)"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh run list --workflow deploy.yml --limit 3 --json databaseId,status,conclusion,headSha,createdAt \
    --jq '.[] | "  #\(.databaseId) \(.status)/\(.conclusion // "-") \(.headSha[0:7]) \(.createdAt)"' 2>/dev/null || echo "  (none)"
fi
