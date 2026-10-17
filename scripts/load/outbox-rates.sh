#!/usr/bin/env bash
# Outbox arrival vs publication over one window, measured by PostgreSQL itself (read-only):
# events created per bucket (created_at), events published per bucket (published_at), the backlog at
# each bucket end, and lag (published_at − created_at) percentiles for events created in the window.
#   scripts/load/outbox-rates.sh <start ISO> <end ISO> [bucket seconds=30] > outbox-rates.txt
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
start="${1:?start}"; end="${2:?end}"; bucket="${3:-30}"
port="${OUTBOX_TUNNEL_PORT:-15434}"
DB_TUNNEL_PORT="$port" "$(dirname "$0")/../aws/db-tunnel.sh" >/dev/null 2>&1 &
tunnel=$!
trap 'kill $tunnel 2>/dev/null; pkill -f "localPortNumber.*${port}" 2>/dev/null' EXIT
for _ in $(seq 1 30); do nc -z localhost "$port" 2>/dev/null && break; sleep 1; done
nc -z localhost "$port" || die "tunnel did not open"
password="$(aws secretsmanager get-secret-value --secret-id "${NAME_PREFIX}/app-db-user" --query SecretString --output text |
  python3 -c 'import json,sys,urllib.parse;print(urllib.parse.quote(json.load(sys.stdin)["password"], safe=""))')"
cd "$REPO_ROOT"
DATABASE_URL="postgresql://dpp_app:${password}@localhost:${port}/dpp" START="$start" END="$end" BUCKET="$bucket" node --input-type=module -e '
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
const p = [process.env.START, process.env.END, Number(process.env.BUCKET)];
const { rows } = await c.query(`
  WITH b AS (SELECT generate_series($1::timestamptz, $2::timestamptz - make_interval(secs => $3), make_interval(secs => $3)) AS t)
  SELECT to_char(b.t AT TIME ZONE $$UTC$$, $$HH24:MI:SS$$) AS t,
    (SELECT count(*) FROM outbox_events WHERE created_at >= b.t AND created_at < b.t + make_interval(secs => $3)) AS created,
    (SELECT count(*) FROM outbox_events WHERE published_at >= b.t AND published_at < b.t + make_interval(secs => $3)) AS published,
    (SELECT count(*) FROM outbox_events WHERE created_at < b.t + make_interval(secs => $3)
       AND (published_at IS NULL OR published_at >= b.t + make_interval(secs => $3))) AS backlog_at_end
  FROM b ORDER BY b.t`, p);
console.log(`bucket ${p[2]} s; rates per second`);
console.log("t(UTC)    created/s  published/s  backlog");
for (const r of rows) console.log(`${r.t}  ${(r.created / p[2]).toFixed(1).padStart(9)}  ${(r.published / p[2]).toFixed(1).padStart(11)}  ${String(r.backlog_at_end).padStart(7)}`);
const lag = (await c.query(`
  SELECT count(*) AS n, count(published_at) AS published,
    percentile_cont(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (ORDER BY extract(epoch FROM published_at - created_at)) AS pct,
    max(extract(epoch FROM published_at - created_at)) AS max
  FROM outbox_events WHERE created_at >= $1 AND created_at < $2`, p.slice(0, 2))).rows[0];
const f = (v) => (v == null ? "-" : Number(v).toFixed(2));
console.log(`events created in window ${lag.n}, published ${lag.published}; lag created→published p50 ${f(lag.pct?.[0])} s, p95 ${f(lag.pct?.[1])} s, p99 ${f(lag.pct?.[2])} s, max ${f(lag.max)} s`);
await c.query("ROLLBACK");
await c.end();
'
