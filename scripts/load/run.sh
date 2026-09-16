#!/usr/bin/env bash
# One measured load run, end to end, with its evidence kept in the repository:
#   metrics snapshot → k6 on a GitHub runner (load.yml) → download results → metrics snapshot →
#   CloudWatch window → report.md.
#   scripts/load/run.sh <label> <http|realtime> <scenario> "<k6 env, e.g. VUS=100 DURATION=5m>"
source "$(dirname "$0")/../aws/lib.sh"
require_aws_auth
label="${1:?label}"; script="${2:?script}"; scenario="${3:-balanced}"; extra="${4:-}"
dir="$REPO_ROOT/tests/load/results/$label"
mkdir -p "$dir"
"$(dirname "$0")/snapshot.sh" "$dir/before"
start="$(date -u +%FT%TZ)"
gh workflow run load.yml --ref main -f script="$script" -f scenario="$scenario" -f label="$label" -f env="$extra" >/dev/null
sleep 8
run="$(gh run list --workflow load.yml -L 1 --json databaseId -q '.[0].databaseId')"
info "k6 run $run ($label): $script $scenario $extra"
gh run watch "$run" --interval 20 >/dev/null 2>&1 || true
end="$(date -u +%FT%TZ)"
echo "$start $end" >"$dir/window.txt"
gh run download "$run" -n "$label" -D "$dir" || warn "no artifact"
"$(dirname "$0")/snapshot.sh" "$dir/after"
python3 "$(dirname "$0")/report.py" "$dir" >/dev/null
info "report: tests/load/results/$label/report.md"
