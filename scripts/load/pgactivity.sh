#!/usr/bin/env bash
# Samples what every app connection is doing, every 5 s, until stopped, through a temporary SSM
# tunnel (read-only): connection counts by state and wait event, how many are blocked by another
# session's lock, and the longest-running active statement (truncated; pg_stat_activity shows
# statement text with placeholders, not parameter values).
#   scripts/load/pgactivity.sh tests/load/results/<label>/pgactivity.txt
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
out="${1:?usage: pgactivity.sh <file>}"
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
# Plain assignments (not a prefix on `source`), so the tunnel helper's EXIT trap still sees them.
port="${PGACTIVITY_TUNNEL_PORT:-15434}"
role=app
source "$(dirname "$0")/pg-tunnel.sh"
node scripts/load/pgactivity.mjs "$out"
