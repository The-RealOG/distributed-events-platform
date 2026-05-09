#!/usr/bin/env bash
# Lists what is running in the dev environment that bills while it exists, with the current
# on-demand rate from the AWS Pricing API. Rates, not a monthly total: usage-based charges
# (data transfer, requests, storage growth) depend on activity and are not estimated.
#   npm run aws:cost-info
source "$(dirname "$0")/lib.sh"
require_aws_auth
deploy_config >/dev/null 2>&1 || { info "environment not provisioned: only the state bucket (S3 storage, cents/month)"; exit 0; }
cluster="$(cfg 'c["cluster"]')"
python3 - "$AWS_REGION" "$cluster" "$(cfg 'c["msk_cluster"]')" "$(cfg 'c["rds"]["identifier"]')" "$NAME_PREFIX" "$(cfg 'c["task_subnets"][0]')" <<'PY'
import json, subprocess, sys
region, cluster, msk, rds_id, prefix, task_subnet = sys.argv[1:]
LOC = {"us-east-2": "US East (Ohio)", "us-east-1": "US East (N. Virginia)"}.get(region, region)
def aws(*a):
    return json.loads(subprocess.check_output(["aws", *a, "--output", "json"], text=True) or "null")
def rate(service, match, *filters):
    args = ["pricing", "get-products", "--region", "us-east-1", "--service-code", service,
            "--filters", f"Type=TERM_MATCH,Field=location,Value={LOC}", *filters, "--max-items", "300"]
    for s in aws(*args)["PriceList"]:
        p = json.loads(s)
        for t in p["terms"].get("OnDemand", {}).values():
            for d in t["priceDimensions"].values():
                if match.lower() in d["description"].lower() and float(d["pricePerUnit"]["USD"]) > 0:
                    return float(d["pricePerUnit"]["USD"]), d["unit"]
    return None, None
rows = []
m = aws("kafka", "list-clusters-v2", "--cluster-name-filter", msk)["ClusterInfoList"]
if m:
    b = m[0]["Provisioned"]; itype = b["BrokerNodeGroupInfo"]["InstanceType"]; n = b["NumberOfBrokerNodes"]
    r, u = rate("AmazonMSK", itype.replace("kafka.", "") + " in")
    rows.append(("MSK brokers", f"{n} × {itype}", r and f"${r:.4f}/{u} each", "always on; cannot be paused (destroy to stop)"))
d = aws("rds", "describe-db-instances", "--db-instance-identifier", rds_id)["DBInstances"][0]
r, u = rate("AmazonRDS", f"{d['DBInstanceClass']} Single-AZ instance hour", "Type=TERM_MATCH,Field=databaseEngine,Value=PostgreSQL",
            "Type=TERM_MATCH,Field=deploymentOption,Value=Single-AZ", f"Type=TERM_MATCH,Field=instanceType,Value={d['DBInstanceClass']}")
rows.append(("RDS PostgreSQL", f"{d['DBInstanceClass']}, {d['AllocatedStorage']} GB gp3, status {d['DBInstanceStatus']}", r and f"${r:.4f}/{u}", "can be stopped up to 7 days (aws rds stop-db-instance)"))
r, u = rate("AWSELB", "Application LoadBalancer-hour", "Type=TERM_MATCH,Field=productFamily,Value=Load Balancer-Application")
rows.append(("Application Load Balancer", "1", r and f"${r:.4f}/{u} + LCU usage", "always on while it exists"))
tasks = aws("ecs", "list-tasks", "--cluster", cluster, "--desired-status", "RUNNING")["taskArns"]
vcpu = mem = 0.0
if tasks:
    for t in aws("ecs", "describe-tasks", "--cluster", cluster, "--tasks", *tasks)["tasks"]:
        vcpu += int(t["cpu"]) / 1024; mem += int(t["memory"]) / 1024
# Matched by usage type: the descriptions ("AWS Fargate - vCPU - US East 2 (Ohio)") carry no unit.
rv, _ = rate("AmazonECS", "Fargate - vCPU", "Type=TERM_MATCH,Field=usagetype,Value=USE2-Fargate-vCPU-Hours:perCPU")
rm, _ = rate("AmazonECS", "Fargate - Memory", "Type=TERM_MATCH,Field=usagetype,Value=USE2-Fargate-GB-Hours")
rows.append(("Fargate tasks", f"{len(tasks)} running: {vcpu:g} vCPU, {mem:g} GB", rv and f"${rv:.5f}/vCPU-h, ${rm:.5f}/GB-h", "scale services to 0 to stop"))
# Every public IPv4 in the VPC bills (task ENIs carry no cluster tag, so count by VPC).
vpc = aws("ec2", "describe-subnets", "--subnet-ids", task_subnet)["Subnets"][0]["VpcId"]
enis = aws("ec2", "describe-network-interfaces", "--filters", f"Name=vpc-id,Values={vpc}")["NetworkInterfaces"]
public_enis = [e for e in enis if e.get("Association", {}).get("PublicIp")]
alb_ips = sum(1 for e in public_enis if e.get("Description", "").startswith("ELB "))
public = len(public_enis)
r, u = rate("AmazonVPC", "in-use public IPv4", "Type=TERM_MATCH,Field=group,Value=VPCPublicIPv4Address")
rows.append(("Public IPv4 addresses", f"{public} ({alb_ips} ALB, {public - alb_ips} tasks; instead of a NAT gateway)", r and f"${r:.4f}/{u} each", "follow task/ALB lifetime"))
secrets = aws("secretsmanager", "list-secrets", "--filters", f"Key=name,Values={prefix}")["SecretList"]
rows.append(("Secrets Manager", f"{len(secrets)} secrets (+ RDS-managed master secret)", "$0.40/secret-month (published rate)", "deleted immediately on destroy"))
rows.append(("CloudFront, S3, ECR, CloudWatch Logs, Cloud Map", "usage-based", "per request / GB", "small at dev volumes; logs expire after 7 days"))
rows.append(("NAT gateway", "none", "-", "avoided by design (ADR-012)"))
w = [max(len(str(r[i] or "n/a")) for r in rows) for i in range(4)]
print("\nResources that bill while the environment exists (" + region + ")\n")
for r in rows: print("  " + "  ".join(str(v or "n/a").ljust(w[i]) for i, v in enumerate(r)))
print("\nStop all of it:  npm run aws:destroy   (state bucket remains: cents/month)")
PY
