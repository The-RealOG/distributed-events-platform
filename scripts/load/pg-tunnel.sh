#!/usr/bin/env bash
# Sourced by the PostgreSQL samplers: opens a temporary SSM tunnel to RDS on $port and sets
# DATABASE_URL for the given role (app: the services' least-privilege user; owner: the RDS master,
# needed only to create an extension). The tunnel closes when the sourcing script exits.
#   port=15434; role=app; source scripts/load/pg-tunnel.sh
DB_TUNNEL_PORT="$port" "$(dirname "${BASH_SOURCE[0]}")/../aws/db-tunnel.sh" >/dev/null 2>&1 &
tunnel=$!
trap 'kill $tunnel 2>/dev/null; pkill -f "localPortNumber.*${port}" 2>/dev/null' EXIT
for _ in $(seq 1 30); do nc -z localhost "$port" 2>/dev/null && break; sleep 1; done
nc -z localhost "$port" || die "tunnel did not open"
if [[ "${role:-app}" == owner ]]; then
  secret="$(aws rds describe-db-instances --db-instance-identifier "$(cfg 'c["rds"]["identifier"]')" \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)"
else
  secret="${NAME_PREFIX}/app-db-user"
fi
creds="$(aws secretsmanager get-secret-value --secret-id "$secret" --query SecretString --output text |
  python3 -c 'import json,sys,urllib.parse;d=json.load(sys.stdin);print(urllib.parse.quote(d["username"],safe=""), urllib.parse.quote(d["password"],safe=""))')"
export DATABASE_URL="postgresql://${creds% *}:${creds#* }@localhost:${port}/dpp"
cd "$REPO_ROOT" # bare "pg" import resolves from the repository's node_modules
