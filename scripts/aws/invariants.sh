#!/usr/bin/env bash
# Read-only data-invariant audit through a temporary SSM tunnel to RDS (no public endpoint).
#   npm run aws:invariants
source "$(dirname "$0")/lib.sh"
require_aws_auth
port="${DB_TUNNEL_PORT:-15432}"
DB_TUNNEL_PORT="$port" "$(dirname "$0")/db-tunnel.sh" >/dev/null 2>&1 &
tunnel=$!
trap 'kill $tunnel 2>/dev/null; pkill -f "localPortNumber.*${port}" 2>/dev/null' EXIT
for _ in $(seq 1 30); do nc -z localhost "$port" 2>/dev/null && break; sleep 1; done
nc -z localhost "$port" || die "tunnel did not open"
# The app role's password goes straight into the connection string; it is never printed.
password="$(aws secretsmanager get-secret-value --secret-id "${NAME_PREFIX}/app-db-user" --query SecretString --output text |
  python3 -c 'import json,sys,urllib.parse;print(urllib.parse.quote(json.load(sys.stdin)["password"], safe=""))')"
DATABASE_URL="postgresql://dpp_app:${password}@localhost:${port}/dpp" node "$(dirname "$0")/invariants.mjs"
