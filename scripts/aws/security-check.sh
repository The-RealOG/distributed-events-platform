#!/usr/bin/env bash
# Verifies the network boundaries from outside (this Mac) and from AWS configuration.
# Positive paths inside the VPC are proven by aws:smoke (gateway→project-service→RDS) and
# aws:kafka:probe (tools→MSK).   Part of: npm run aws:test
source "$(dirname "$0")/lib.sh"
require_aws_auth
fails=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; fails=$((fails + 1)); }
unreachable() { # host port → pass if a TCP connect from here fails within 5 s
  if nc -z -G 5 "$1" "$2" >/dev/null 2>&1; then return 1; else return 0; fi
}

rds_host="$(cfg 'c["rds"]["address"]')"
rds_ip="$(dig +short "$rds_host" | tail -1)"
[[ "$(aws rds describe-db-instances --db-instance-identifier "$(cfg 'c["rds"]["identifier"]')" --query 'DBInstances[0].PubliclyAccessible' --output text)" == "False" ]] &&
  pass "RDS PubliclyAccessible=false" || fail "RDS is publicly accessible"
[[ "$rds_ip" =~ ^10\. ]] && pass "RDS resolves only to a private address ($rds_ip)" || fail "RDS resolves to $rds_ip"
unreachable "$rds_host" 5432 && pass "Internet → RDS:5432 refused/unroutable" || fail "Internet → RDS:5432 connected"

msk_arn="$(aws kafka list-clusters-v2 --cluster-name-filter "$(cfg 'c["msk_cluster"]')" --query 'ClusterInfoList[0].ClusterArn' --output text)"
public_access="$(aws kafka describe-cluster-v2 --cluster-arn "$msk_arn" --query 'ClusterInfo.Provisioned.BrokerNodeGroupInfo.ConnectivityInfo.PublicAccess.Type' --output text)"
[[ "$public_access" == "DISABLED" || "$public_access" == "None" ]] && pass "MSK public access: ${public_access}" || fail "MSK public access: $public_access"
broker="$(aws kafka get-bootstrap-brokers --cluster-arn "$msk_arn" --query BootstrapBrokerStringSaslIam --output text | cut -d, -f1)"
unreachable "${broker%:*}" "${broker##*:}" && pass "Internet → MSK:${broker##*:} refused/unroutable" || fail "Internet → MSK connected"
unauth="$(aws kafka describe-cluster-v2 --cluster-arn "$msk_arn" --query 'ClusterInfo.Provisioned.ClientAuthentication.Unauthenticated.Enabled' --output text)"
[[ "$unauth" != "True" ]] && pass "MSK unauthenticated access disabled (IAM only)" || fail "MSK allows unauthenticated clients"

redis="$(aws elasticache describe-replication-groups --replication-group-id "$NAME_PREFIX" --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text 2>/dev/null || true)"
if [[ -n "$redis" && "$redis" != "None" ]]; then
  unreachable "$redis" 6379 && pass "Internet → Redis:6379 refused/unroutable" || fail "Internet → Redis connected"
else
  pass "Redis not provisioned (enable_redis=false): nothing exposed"
fi

alb="$(aws elbv2 describe-load-balancers --names "$NAME_PREFIX" --query 'LoadBalancers[0].DNSName' --output text)"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://$alb/" || true)"
[[ "$code" == "000" ]] && pass "Internet → ALB directly: blocked (security group admits CloudFront only)" || fail "Internet → ALB returned HTTP $code"

for bucket in "$(cfg 'c["web_bucket"]')" "${NAME_PREFIX}-attachments-${AWS_ACCOUNT_ID}-${AWS_REGION}"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${bucket}.s3.${AWS_REGION}.amazonaws.com/index.html")"
  [[ "$code" == "403" ]] && pass "Anonymous read of s3://$bucket → 403" || fail "Anonymous read of s3://$bucket → $code"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X PUT --data x "https://${bucket}.s3.${AWS_REGION}.amazonaws.com/probe.txt")"
  [[ "$code" == "403" ]] && pass "Anonymous write to s3://$bucket → 403" || fail "Anonymous write to s3://$bucket → $code"
done

open="$(aws ec2 describe-security-groups --filters "Name=tag:Project,Values=dpp" \
  --query "SecurityGroups[].IpPermissions[?contains(IpRanges[].CidrIp, '0.0.0.0/0')].[FromPort]" --output text)"
[[ -z "$open" ]] && pass "No security group admits 0.0.0.0/0 inbound" || fail "0.0.0.0/0 inbound on ports: $open"

[[ $fails -eq 0 ]] || die "$fails security check(s) failed"
info "security checks passed"
