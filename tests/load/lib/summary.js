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
  // Ladder: one row per level (percentiles over that level's samples only).
  const levels = Object.keys(m)
    .map((k) => /^http_req_duration\{level:(\d+)\}$/.exec(k))
    .filter(Boolean)
    .map((x) => parseInt(x[1], 10))
    .sort((a, b) => a - b);
  if (levels.length > 1) {
    const sm = /^(\d+)(s|m)$/.exec(__ENV.STEP || '3m');
    const step = sm ? parseInt(sm[1], 10) * (sm[2] === 'm' ? 60 : 1) : 0;
    lines.push(
      '',
      'level  req/s   writes/s  err%    p50    p95    p99   board p95  create p95  move p95  cache hit%  409s',
    );
    for (const l of levels) {
      const d = m[`http_req_duration{level:${l}}`].values;
      const n = m[`http_reqs{level:${l}}`] ? m[`http_reqs{level:${l}}`].values.count : 0;
      const w = m[`writes_ok{level:${l}}`] ? m[`writes_ok{level:${l}}`].values.count : 0;
      const e = m[`http_req_failed{level:${l}}`] ? m[`http_req_failed{level:${l}}`].values.rate : 0;
      const p = (op) =>
        m[`http_req_duration{level:${l},op:${op}}`]
          ? m[`http_req_duration{level:${l},op:${op}}`].values['p(95)']
          : undefined;
      const h = m[`board_cache{level:${l},result:hit}`]
        ? m[`board_cache{level:${l},result:hit}`].values.count
        : 0;
      const mi = m[`board_cache{level:${l},result:miss}`]
        ? m[`board_cache{level:${l},result:miss}`].values.count
        : 0;
      const c = m[`version_conflicts{level:${l}}`]
        ? m[`version_conflicts{level:${l}}`].values.count
        : 0;
      lines.push(
        `${String(l).padEnd(6)} ${(step ? n / step : 0).toFixed(1).padStart(6)} ${(step ? w / step : 0).toFixed(1).padStart(9)} ${(e * 100).toFixed(2).padStart(5)} ${f(d.med).padStart(6)} ${f(d['p(95)']).padStart(6)} ${f(d['p(99)']).padStart(6)} ${f(p('board')).padStart(10)} ${f(p('create')).padStart(11)} ${f(p('move')).padStart(9)} ${(h + mi ? (100 * h) / (h + mi) : 0).toFixed(1).padStart(11)} ${String(c).padStart(5)}`,
      );
    }
  }
  for (const result of ['hit', 'miss', 'bypass']) {
    const t = m[`board_ms_by_cache{result:${result}}`];
    if (t && t.values.count) row(`  board (${result})`, t.values);
  }
  const out = { stdout: `\n${lines.join('\n')}\n` };
  // setup_data holds the load users' tokens: never written to disk.
  if (__ENV.SUMMARY_FILE)
    out[__ENV.SUMMARY_FILE] = JSON.stringify({ ...data, setup_data: undefined }, null, 1);
  return out;
}
