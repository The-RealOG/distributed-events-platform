#!/usr/bin/env python3
"""Read-only audit of the deployed dev environment, from live AWS state (never Terraform source).

Prints a human summary and writes a machine-readable inventory (JSON) to --out. Never reads
secret values. Exits 1 if any check fails.   npm run aws:audit [-- --out file.json]
"""
import json, subprocess, sys, argparse

REGION = "us-east-2"
P = "dpp-dev"
FINDINGS = []


def aws(*args, default=None):
    r = subprocess.run(["aws", *args, "--region", REGION, "--output", "json"], capture_output=True, text=True)
    if r.returncode != 0:
        if default is not None:
            return default
        raise RuntimeError(f"aws {' '.join(args[:2])}: {r.stderr.strip()[:200]}")
    return json.loads(r.stdout) if r.stdout.strip() else ({} if default is None else default)


def check(ok, what):
    FINDINGS.append(("PASS" if ok else "FAIL", what))


def note(what):
    FINDINGS.append(("NOTE", what))


ap = argparse.ArgumentParser()
ap.add_argument("--out", default="/tmp/dpp-aws-inventory.json")
args = ap.parse_args()
inv = {"region": REGION}

# ---- identity
ident = aws("sts", "get-caller-identity")
inv["account"] = ident["Account"]
inv["principal"] = ident["Arn"].split("/")[-1]

# ---- tagged inventory
res = aws("resourcegroupstaggingapi", "get-resources", "--tag-filters", "Key=Project,Values=dpp")["ResourceTagMappingList"]
BILLING = {  # service → (billing class, persistence)
    "kafka": ("hourly (brokers + storage)", "persistent"), "rds": ("hourly (instance + storage)", "persistent"),
    "elasticloadbalancing": ("hourly + LCU (load balancer)", "persistent"), "ecs": ("per running task (Fargate)", "ephemeral tasks"),
    "ec2": ("free (VPC/subnet/SG/route); public IPv4 billed per address", "persistent"),
    "s3": ("usage (storage/requests)", "persistent"), "ecr": ("usage (storage)", "persistent"),
    "secretsmanager": ("$0.40/secret-month + API calls", "persistent"), "logs": ("usage (ingest/storage)", "persistent"),
    "cloudfront": ("usage (requests/transfer)", "persistent"), "servicediscovery": ("usage + hosted zone", "persistent"),
    "ssm": ("free (standard parameters)", "persistent"), "iam": ("free", "persistent"), "budgets": ("free (first 2)", "persistent"),
    "route53": ("hosted zone $/month", "persistent"),
}
items = []
for r in res:
    arn = r["ResourceARN"]; svc = arn.split(":")[2]
    tags = {t["Key"]: t["Value"] for t in r["Tags"]}
    billing, persistence = BILLING.get(svc, ("see service pricing", "persistent"))
    items.append({"service": svc, "arn": arn, "name": tags.get("Name", arn.split(":")[-1].split("/")[-1]),
                  "managed_by": tags.get("ManagedBy"), "billing": billing, "persistence": persistence})
inv["tagged_resources"] = items
unmanaged = [i["name"] for i in items if i["managed_by"] not in ("Terraform", "scripts/aws/bootstrap.sh")]
check(not unmanaged, f"{len(items)} tagged resources, all ManagedBy=Terraform (+ the state bucket from bootstrap.sh)" + (f"; unmanaged: {unmanaged}" if unmanaged else ""))

# ---- networking
vpc = aws("ec2", "describe-vpcs", "--filters", f"Name=tag:Name,Values={P}")["Vpcs"][0]
vid = vpc["VpcId"]
subnets = aws("ec2", "describe-subnets", "--filters", f"Name=vpc-id,Values={vid}")["Subnets"]
rts = aws("ec2", "describe-route-tables", "--filters", f"Name=vpc-id,Values={vid}")["RouteTables"]
rt_of = {}
for rt in rts:
    for a in rt.get("Associations", []):
        if a.get("SubnetId"): rt_of[a["SubnetId"]] = rt
def default_route(rt):
    for r in rt.get("Routes", []):
        if r.get("DestinationCidrBlock") == "0.0.0.0/0": return r.get("GatewayId") or r.get("NatGatewayId") or "other"
    return None
net = {"vpc_id": vid, "cidr": vpc["CidrBlock"], "subnets": []}
for s in sorted(subnets, key=lambda s: s["CidrBlock"]):
    tier = {t["Key"]: t["Value"] for t in s.get("Tags", [])}.get("Tier")
    dr = default_route(rt_of.get(s["SubnetId"], {}))
    net["subnets"].append({"id": s["SubnetId"], "az": s["AvailabilityZone"], "cidr": s["CidrBlock"], "tier": tier,
                           "default_route": dr, "auto_public_ip": s["MapPublicIpOnLaunch"]})
    if tier == "data": check(dr is None, f"data subnet {s['CidrBlock']} ({s['AvailabilityZone']}) has no internet route")
    if tier == "public": check(dr and dr.startswith("igw-"), f"public subnet {s['CidrBlock']} routes 0.0.0.0/0 → IGW; auto-assign public IP={s['MapPublicIpOnLaunch']}")
nats = aws("ec2", "describe-nat-gateways", "--filter", f"Name=vpc-id,Values={vid}")["NatGateways"]
check(not [n for n in nats if n["State"] not in ("deleted",)], "no NAT gateway in the VPC")
endpoints = aws("ec2", "describe-vpc-endpoints", "--filters", f"Name=vpc-id,Values={vid}")["VpcEndpoints"]
net["vpc_endpoints"] = [e["ServiceName"] for e in endpoints]
note(f"VPC endpoints: {net['vpc_endpoints'] or 'none'} (tasks reach AWS APIs over public IPs, outbound only)")
net["internet_gateway"] = [g["InternetGatewayId"] for g in aws("ec2", "describe-internet-gateways", "--filters", f"Name=attachment.vpc-id,Values={vid}")["InternetGateways"]]
inv["network"] = net

# ---- security groups (actual rules)
sgs = aws("ec2", "describe-security-groups", "--filters", f"Name=vpc-id,Values={vid}")["SecurityGroups"]
name_of = {g["GroupId"]: g["GroupName"].replace(P + "-", "") for g in sgs}
matrix = []
for g in sgs:
    for p_ in g["IpPermissions"]:
        port = f"{p_.get('FromPort','all')}" if p_.get("FromPort") == p_.get("ToPort") else f"{p_.get('FromPort')}-{p_.get('ToPort')}"
        for pair in p_.get("UserIdGroupPairs", []):
            matrix.append((name_of.get(pair["GroupId"], pair["GroupId"]), name_of[g["GroupId"]], port))
        for rng in p_.get("IpRanges", []):
            matrix.append((rng["CidrIp"], name_of[g["GroupId"]], port))
        for pl in p_.get("PrefixListIds", []):
            matrix.append(("cloudfront-prefix-list", name_of[g["GroupId"]], port))
inv["security_group_ingress"] = [{"from": a, "to": b, "port": c} for a, b, c in sorted(matrix)]
open_world = [m for m in matrix if m[0] in ("0.0.0.0/0", "::/0")]
check(not open_world, f"no ingress from 0.0.0.0/0 anywhere (found: {open_world or 'none'})")
expected = {("alb", "gateway", "3000"), ("gateway", "project-service", "3001"), ("project-service", "rds", "5432"),
            ("outbox-publisher", "rds", "5432"), ("tools", "rds", "5432"), ("outbox-publisher", "msk", "9098"),
            ("tools", "msk", "9098"), ("cloudfront-prefix-list", "alb", "80")}
actual = {m for m in matrix if not m[0].startswith("default") and m[1] != "default"}
check(actual == expected, f"ingress rules exactly as designed ({len(actual)} rules)" + ("" if actual == expected else f"; unexpected={actual-expected} missing={expected-actual}"))
for g in sgs:
    if name_of[g["GroupId"]] in ("rds", "msk", "redis"):
        check(not g["IpPermissionsEgress"], f"{name_of[g['GroupId']]} SG has no egress rules")

# ---- RDS
db = aws("rds", "describe-db-instances", "--db-instance-identifier", P)["DBInstances"][0]
inv["rds"] = {k: db.get(k) for k in ["DBInstanceStatus", "EngineVersion", "DBInstanceClass", "AllocatedStorage", "StorageType",
            "StorageEncrypted", "BackupRetentionPeriod", "DeletionProtection", "MultiAZ", "PubliclyAccessible"]}
inv["rds"]["endpoint"] = f"{db['Endpoint']['Address']}:{db['Endpoint']['Port']}"
inv["rds"]["subnet_group"] = db["DBSubnetGroup"]["DBSubnetGroupName"]
inv["rds"]["security_groups"] = [name_of.get(s["VpcSecurityGroupId"]) for s in db["VpcSecurityGroups"]]
check(db["PubliclyAccessible"] is False, "RDS PubliclyAccessible = false")
check(db["StorageEncrypted"], "RDS storage encrypted")
check(db["DBInstanceStatus"] == "available", f"RDS status {db['DBInstanceStatus']}, PostgreSQL {db['EngineVersion']}, {db['DBInstanceClass']}")
check(all(s["SubnetIdentifier"] in [x["id"] for x in net["subnets"] if x["tier"] == "data"] for s in db["DBSubnetGroup"]["Subnets"]), "RDS subnet group uses only data subnets")
check(bool(db.get("MasterUserSecret")), "RDS master password managed by RDS in Secrets Manager")
params = aws("rds", "describe-db-parameters", "--db-parameter-group-name", P, "--query", "Parameters[?ParameterName=='rds.force_ssl']")
check(any(p_["ParameterName"] == "rds.force_ssl" and p_.get("ParameterValue") == "1" for p_ in params), "rds.force_ssl = 1 (TLS required)")

# ---- MSK
msk = aws("kafka", "list-clusters-v2", "--cluster-name-filter", P)["ClusterInfoList"]
if msk:
    c = msk[0]; prov = c["Provisioned"]; bn = prov["BrokerNodeGroupInfo"]
    inv["msk"] = {"state": c["State"], "kafka_version": prov["CurrentBrokerSoftwareInfo"]["KafkaVersion"], "instance_type": bn["InstanceType"],
                  "brokers": prov["NumberOfBrokerNodes"], "volume_gb": bn["StorageInfo"]["EbsStorageInfo"]["VolumeSize"],
                  "public_access": bn.get("ConnectivityInfo", {}).get("PublicAccess", {}).get("Type"),
                  "iam_auth": prov["ClientAuthentication"]["Sasl"]["Iam"]["Enabled"],
                  "unauthenticated": prov["ClientAuthentication"].get("Unauthenticated", {}).get("Enabled", False),
                  "tls_in_transit": prov["EncryptionInfo"]["EncryptionInTransit"]["ClientBroker"],
                  "security_groups": [name_of.get(s) for s in bn["SecurityGroups"]]}
    check(inv["msk"]["public_access"] in ("DISABLED", None), f"MSK public access {inv['msk']['public_access']}")
    check(inv["msk"]["iam_auth"] and not inv["msk"]["unauthenticated"], "MSK: IAM auth only, unauthenticated disabled")
    check(inv["msk"]["tls_in_transit"] == "TLS", "MSK client-broker TLS only")
    check(all(s in [x["id"] for x in net["subnets"] if x["tier"] == "data"] for s in bn["ClientSubnets"]), "MSK brokers in data subnets")
    note(f"MSK {c['State']}: Kafka {inv['msk']['kafka_version']}, {inv['msk']['brokers']} × {inv['msk']['instance_type']}")

# ---- S3
inv["s3"] = []
for b in [f"{P}-attachments-{inv['account']}-{REGION}", f"{P}-web-{inv['account']}-{REGION}"]:
    pab = aws("s3api", "get-public-access-block", "--bucket", b)["PublicAccessBlockConfiguration"]
    enc = aws("s3api", "get-bucket-encryption", "--bucket", b)["ServerSideEncryptionConfiguration"]["Rules"][0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"]
    own = aws("s3api", "get-bucket-ownership-controls", "--bucket", b)["OwnershipControls"]["Rules"][0]["ObjectOwnership"]
    pol = json.loads(aws("s3api", "get-bucket-policy", "--bucket", b)["Policy"])
    cors = aws("s3api", "get-bucket-cors", "--bucket", b, default={}).get("CORSRules")
    ver = aws("s3api", "get-bucket-versioning", "--bucket", b).get("Status", "Disabled")
    lc = aws("s3api", "get-bucket-lifecycle-configuration", "--bucket", b, default={}).get("Rules", [])
    status = aws("s3api", "get-bucket-policy-status", "--bucket", b)["PolicyStatus"]["IsPublic"]
    inv["s3"].append({"bucket": b, "public_access_block": pab, "encryption": enc, "ownership": own, "policy_statements": [s_["Sid"] for s_ in pol["Statement"]],
                      "policy_is_public": status, "cors": cors, "versioning": ver, "lifecycle_rules": [r_["ID"] for r_ in lc]})
    check(all(pab.values()) and not status, f"s3://{b}: all public access blocked, policy not public")
    check(enc in ("AES256", "aws:kms") and own == "BucketOwnerEnforced", f"s3://{b}: {enc} encryption, ACLs disabled")

# ---- ECR
repos = aws("ecr", "describe-repositories")["repositories"]
mine = [r for r in repos if r["repositoryName"].startswith(P + "/")]
inv["ecr"] = []
for r in mine:
    imgs = aws("ecr", "list-images", "--repository-name", r["repositoryName"])["imageIds"]
    lcp = aws("ecr", "get-lifecycle-policy", "--repository-name", r["repositoryName"], default={}).get("lifecyclePolicyText")
    rpol = aws("ecr", "get-repository-policy", "--repository-name", r["repositoryName"], default={}).get("policyText")
    inv["ecr"].append({"name": r["repositoryName"], "scan_on_push": r["imageScanningConfiguration"]["scanOnPush"],
                       "tag_mutability": r["imageTagMutability"], "encryption": r["encryptionConfiguration"]["encryptionType"],
                       "lifecycle_policy": bool(lcp), "repository_policy": bool(rpol), "images": len(imgs)})
check(sorted(x["name"] for x in inv["ecr"]) == sorted(f"{P}/{n}" for n in ["api-gateway", "kafka-tools", "outbox-publisher", "project-service"]),
      f"ECR: exactly the 4 deployable images ({', '.join(x['name'].split('/')[1] for x in inv['ecr'])})")
check(all(x["scan_on_push"] and x["tag_mutability"] == "IMMUTABLE" and x["lifecycle_policy"] and not x["repository_policy"] for x in inv["ecr"]),
      "ECR: scan on push, immutable tags, lifecycle policy, no repository policy (account-only access)")

# ---- ECS
cl = aws("ecs", "describe-clusters", "--clusters", P, "--include", "SETTINGS")["clusters"][0]
svcs = aws("ecs", "describe-services", "--cluster", P, "--services", "project-service", "api-gateway", "outbox-publisher")["services"]
inv["ecs"] = {"cluster": cl["clusterName"], "status": cl["status"], "capacity_providers": cl["capacityProviders"],
              "container_insights": [s_["value"] for s_ in cl["settings"] if s_["name"] == "containerInsights"],
              "services": [{"name": s_["serviceName"], "desired": s_["desiredCount"], "running": s_["runningCount"],
                            "exec": s_["enableExecuteCommand"], "task_definition": s_["taskDefinition"].split("/")[-1],
                            "circuit_breaker": s_["deploymentConfiguration"]["deploymentCircuitBreaker"],
                            "public_ip": s_["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"]} for s_ in svcs]}
check(cl["status"] == "ACTIVE", f"ECS cluster {P} ACTIVE; capacity providers {cl['capacityProviders']}")
check(all(s_["exec"] and s_["circuit_breaker"]["enable"] and s_["circuit_breaker"]["rollback"] for s_ in inv["ecs"]["services"]),
      "ECS services: ECS Exec enabled, circuit breaker with rollback")
note("ECS services " + ", ".join(f"{s_['name']} desired={s_['desired']} running={s_['running']}" for s_ in inv["ecs"]["services"]))

# ---- IAM
roles = [r for r in aws("iam", "list-roles")["Roles"] if r["RoleName"].startswith(P)]
inv["iam"] = []
bad = []
for r in roles:
    att = [p_["PolicyName"] for p_ in aws("iam", "list-attached-role-policies", "--role-name", r["RoleName"])["AttachedPolicies"]]
    inline = aws("iam", "list-role-policies", "--role-name", r["RoleName"])["PolicyNames"]
    stars = []
    for name in inline:
        doc = aws("iam", "get-role-policy", "--role-name", r["RoleName"], "--policy-name", name)["PolicyDocument"]
        for st in doc["Statement"]:
            resources = st["Resource"] if isinstance(st["Resource"], list) else [st["Resource"]]
            if "*" in resources:
                stars.append({"sid": st.get("Sid"), "actions": st["Action"], "condition": bool(st.get("Condition"))})
    inv["iam"].append({"role": r["RoleName"], "managed": att, "inline": inline, "resource_star_statements": stars})
    if any(a in ("AdministratorAccess", "PowerUserAccess", "IAMFullAccess") for a in att): bad.append(r["RoleName"])
check(not bad, "no role has AdministratorAccess/PowerUserAccess/IAMFullAccess")
star_notes = [f"{x['role'].replace(P+'-','')}:{s['sid'] or s['actions']}" + (" (cluster-conditioned)" if s["condition"] else "") for x in inv["iam"] for s in x["resource_star_statements"]]
note("Resource='*' statements (APIs without resource-level permissions): " + "; ".join(star_notes))
gh = next(r for r in roles if r["RoleName"] == f"{P}-github-deploy")
trust = gh["AssumeRolePolicyDocument"]["Statement"][0]
cond = trust["Condition"]["StringEquals"]
inv["github_oidc"] = {"provider": trust["Principal"]["Federated"].split("/")[-1], "aud": cond.get("token.actions.githubusercontent.com:aud"),
                      "sub": cond.get("token.actions.githubusercontent.com:sub")}
check(cond.get("token.actions.githubusercontent.com:sub") == "repo:The-RealOG@168302805/distributed-events-platform@1388724647:ref:refs/heads/main"
      and cond.get("token.actions.githubusercontent.com:aud") == "sts.amazonaws.com", "GitHub OIDC trust: this repo (immutable owner/repo IDs), main branch only, audience sts.amazonaws.com")
keys = aws("iam", "list-access-keys", "--user-name", "mycli")["AccessKeyMetadata"]
note(f"IAM user mycli (developer CLI) has {len(keys)} access key(s); no keys were created by this phase")

# ---- Secrets (metadata only)
secs = aws("secretsmanager", "list-secrets")["SecretList"]
mine_s = [s_ for s_ in secs if s_["Name"].startswith(P) or "rds!db" in s_["Name"]]
inv["secrets"] = [{"name": s_["Name"], "kms": s_.get("KmsKeyId", "aws/secretsmanager (default)"), "rotation": s_.get("RotationEnabled", False),
                   "owning_service": s_.get("OwningService")} for s_ in mine_s]
check(len([s_ for s_ in mine_s if s_["Name"].startswith(P)]) == 2 and any(s_.get("OwningService") == "rds" for s_ in mine_s),
      "Secrets: jwt-signing-key, app-db-user, and the RDS-managed master secret (values not read)")

# ---- CloudWatch Logs
lgs = aws("logs", "describe-log-groups", "--log-group-name-prefix", f"/ecs/{P}/")["logGroups"]
inv["log_groups"] = [{"name": g["logGroupName"], "retention_days": g.get("retentionInDays"), "stored_bytes": g.get("storedBytes", 0)} for g in lgs]
check(len(lgs) == 5 and all(g.get("retentionInDays") == 7 for g in lgs), f"{len(lgs)} ECS log groups, all with 7-day retention")

# ---- Budget
bud = aws("budgets", "describe-budgets", "--account-id", inv["account"], default={}).get("Budgets", [])
b = next((x for x in bud if x["BudgetName"] == f"{P}-monthly"), None)
if b:
    notes = aws("budgets", "describe-notifications-for-budget", "--account-id", inv["account"], "--budget-name", b["BudgetName"])["Notifications"]
    subs = []
    for n in notes:
        s_ = aws("budgets", "describe-subscribers-for-notification", "--account-id", inv["account"], "--budget-name", b["BudgetName"], "--notification", json.dumps(n))["Subscribers"]
        subs.append(f"{n['NotificationType'].lower()}>{n['Threshold']:g}% → {len(s_)} email subscriber(s)")
    inv["budget"] = {"name": b["BudgetName"], "limit_usd": b["BudgetLimit"]["Amount"], "notifications": subs}
    check(float(b["BudgetLimit"]["Amount"]) == 50, f"budget {b['BudgetName']}: ${float(b['BudgetLimit']['Amount']):g}/month; " + "; ".join(sorted(subs)))

json.dump(inv, open(args.out, "w"), indent=2, default=str)
for level, text in FINDINGS:
    color = {"PASS": "32", "FAIL": "31", "NOTE": "36"}[level]
    print(f"  \033[{color}m{level}\033[0m {text}")
print(f"\ninventory: {args.out}")
sys.exit(1 if any(l == "FAIL" for l, _ in FINDINGS) else 0)
