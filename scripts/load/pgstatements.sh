#!/usr/bin/env bash
# Snapshot of pg_stat_statements through a temporary SSM tunnel, taken before and after a load run.
# The first snapshot creates the extension (as the RDS owner) if it does not exist yet.
#   scripts/load/pgstatements.sh tests/load/results/<label>/before/pgstatements.json
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
out="${1:?usage: pgstatements.sh <file.json>}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
port="${PGSTATEMENTS_TUNNEL_PORT:-15435}"
role=owner
source "$(dirname "$0")/pg-tunnel.sh"
node scripts/load/pgstatements.mjs "$out" --create-extension
