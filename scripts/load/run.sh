#!/usr/bin/env bash
# One measured load run, end to end, with its evidence kept in the repository:
#   metrics + PostgreSQL stats snapshot → k6 on a GitHub runner (load.yml) → download results →
#   metrics + PostgreSQL stats snapshot → CloudWatch window → report.md.
#   scripts/load/run.sh <label> <http|realtime> <scenario> "<k6 env, e.g. VUS=100 DURATION=5m>"
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
label="${1:?label}"; script="${2:?script}"; scenario="${3:-balanced}"; extra="${4:-}"
dir="$REPO_ROOT/tests/load/results/$label"
mkdir -p "$dir"
# What was measured, recorded with the evidence: deployed SHA, service task counts and sizes, the
# project-service cache flag, and the exact k6 parameters.
cluster="$(cfg 'c["cluster"]')"
{
  echo "label=$label script=$script scenario=$scenario"
  echo "k6_env=$extra"
  echo "deployed_sha=$(aws ssm get-parameter --name "/${NAME_PREFIX}/image-tag" --query Parameter.Value --output text)"
  echo "harness_sha=$(git -C "$REPO_ROOT" rev-parse --short origin/main)"
  python3 "$(dirname "$0")/meta.py" "$cluster" $(cfg '" ".join(c["services"])')
} >"$dir/meta.txt"
"$(dirname "$0")/snapshot.sh" "$dir/before"
"$(dirname "$0")/pgstats.sh" "$dir/before/pgstats.json" || warn "no PostgreSQL stats (before)"
start="$(date -u +%FT%TZ)"
# Time series during the run (gauges are only meaningful over time).
"$(dirname "$0")/poll.sh" "$dir/timeline.txt" >/dev/null 2>&1 &
poller=$!
trap 'kill $poller 2>/dev/null' EXIT
gh workflow run load.yml --ref main -f script="$script" -f scenario="$scenario" -f label="$label" -f env="$extra" >/dev/null
sleep 8
run="$(gh run list --workflow load.yml -L 1 --json databaseId -q '.[0].databaseId')"
info "k6 run $run ($label): $script $scenario $extra"
gh run watch "$run" --interval 20 >/dev/null 2>&1 || true
end="$(date -u +%FT%TZ)"
kill "$poller" 2>/dev/null || true
echo "$start $end" >"$dir/window.txt"
gh run download "$run" -n "$label" -D "$dir" || warn "no artifact"
"$(dirname "$0")/snapshot.sh" "$dir/after"
"$(dirname "$0")/pgstats.sh" "$dir/after/pgstats.json" || warn "no PostgreSQL stats (after)"
python3 "$(dirname "$0")/report.py" "$dir" >/dev/null
info "report: tests/load/results/$label/report.md"
