// Writes the raw k6 summary (all metrics, per-op submetrics) to SUMMARY_FILE and prints a compact
// per-operation table: count, rate, p50/p95/p99, failures. Percentiles are k6's own over all
// samples of the run; they are never averaged across runs.
const f = (v) => (v === undefined ? '-' : v.toFixed(v < 10 ? 1 : 0));

export function handleSummary(data) {
  const m = data.metrics;
  const dur = data.state.testRunDurationMs / 1000;
  const lines = [];
  const row = (label, t) =>
    lines.push(
      `${label.padEnd(26)} n=${String(t.count).padStart(7)}  p50=${f(t.med).padStart(6)}  p95=${f(t['p(95)']).padStart(6)}  p99=${f(t['p(99)']).padStart(6)}  max=${f(t.max).padStart(6)} ms`,
    );
  const api = m['http_req_duration{kind:api}'];
  if (api) row('ALL (steady scenario)', api.values);
  for (const [name, metric] of Object.entries(m)) {
    const op = /^http_req_duration\{op:(\w+)\}$/.exec(name);
    if (op) row(`  ${op[1]}`, metric.values);
  }
  const reqs = m.http_reqs ? m.http_reqs.values : { count: 0, rate: 0 };
  const failed = m.http_req_failed ? m.http_req_failed.values.rate : 0;
  lines.push(
    `requests ${reqs.count} (${reqs.rate.toFixed(1)}/s over ${dur.toFixed(0)} s incl. setup), failed ${(failed * 100).toFixed(2)} %`,
  );
  if (m.writes_ok)
    lines.push(
      `successful writes ${m.writes_ok.values.count} (${m.writes_ok.values.rate.toFixed(1)}/s)`,
    );
  if (m.version_conflicts)
    lines.push(`version conflicts (409) ${m.version_conflicts.values.count}`);
  const hits = m['board_cache{result:hit}'] ? m['board_cache{result:hit}'].values.count : 0;
  const misses = m['board_cache{result:miss}'] ? m['board_cache{result:miss}'].values.count : 0;
  if (hits + misses > 0)
    lines.push(
      `board cache (client view, x-board-cache) hit ${hits} / miss ${misses} = ${((100 * hits) / (hits + misses)).toFixed(1)} % hits`,
    );
  const out = { stdout: `\n${lines.join('\n')}\n` };
  if (__ENV.SUMMARY_FILE) out[__ENV.SUMMARY_FILE] = JSON.stringify(data, null, 1);
  return out;
}
