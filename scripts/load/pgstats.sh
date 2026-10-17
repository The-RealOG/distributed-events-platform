#!/usr/bin/env bash
# Saves PostgreSQL's own cumulative counters for the app database (pg_stat_database: transactions,
# tuples read/written, block reads/hits) to <file> as JSON, through a temporary SSM tunnel.
# Taken before and after a load run, the delta is the run's database work, measured by the database
# rather than by the services (RDS CloudWatch has no query counter).
#   scripts/load/pgstats.sh tests/load/results/<label>/before/pgstats.json
# Nearly every request-path statement runs in autocommit, so xact_commit approximates statements;
# multi-statement transactions count once. Reported as "DB transactions", never as "queries".
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
out="${1:?usage: pgstats.sh <file.json>}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
port="${PGSTATS_TUNNEL_PORT:-15433}"
DB_TUNNEL_PORT="$port" "$(dirname "$0")/../aws/db-tunnel.sh" >/dev/null 2>&1 &
tunnel=$!
trap 'kill $tunnel 2>/dev/null; pkill -f "localPortNumber.*${port}" 2>/dev/null' EXIT
for _ in $(seq 1 30); do nc -z localhost "$port" 2>/dev/null && break; sleep 1; done
nc -z localhost "$port" || die "tunnel did not open"
password="$(aws secretsmanager get-secret-value --secret-id "${NAME_PREFIX}/app-db-user" --query SecretString --output text |
  python3 -c 'import json,sys,urllib.parse;print(urllib.parse.quote(json.load(sys.stdin)["password"], safe=""))')"
cd "$REPO_ROOT" # bare "pg" import resolves from the repository's node_modules
DATABASE_URL="postgresql://dpp_app:${password}@localhost:${port}/dpp" OUT="$out" node --input-type=module -e '
import pg from "pg";
import { writeFileSync } from "node:fs";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`SELECT now() AS at, xact_commit, xact_rollback, tup_returned, tup_fetched,
  tup_inserted, tup_updated, tup_deleted, blks_read, blks_hit, numbackends
  FROM pg_stat_database WHERE datname = current_database()`);
await client.end();
const r = rows[0];
const json = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "at" ? v.toISOString() : Number(v)]));
writeFileSync(process.env.OUT, JSON.stringify(json, null, 1) + "\n");
console.log(`pgstats: ${json.xact_commit} commits at ${json.at}`);
'
