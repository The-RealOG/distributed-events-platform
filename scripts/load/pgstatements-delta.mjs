// The statements a load run spent its database time on: the delta between two pgstatements.sh
// snapshots, top 15 by total execution time.
//   node scripts/load/pgstatements-delta.mjs <before.json> <after.json>
import { readFileSync } from 'node:fs';

const [before, after] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const base = new Map(before.statements.map((s) => [s.queryid, s]));
const rows = after.statements
  .map((s) => {
    const b = base.get(s.queryid);
    return {
      calls: s.calls - (b?.calls ?? 0),
      totalMs: s.total_exec_time - (b?.total_exec_time ?? 0),
      maxMs: s.max_exec_time, // cumulative maximum; pg_stat_statements keeps no per-interval max
      query: s.query,
    };
  })
  .filter((r) => r.calls > 0)
  .sort((a, b) => b.totalMs - a.totalMs);
const total = rows.reduce((sum, r) => sum + r.totalMs, 0);
console.log(`statements by database time, ${before.at} → ${after.at}`);
for (const r of rows.slice(0, 15)) {
  const share = ((100 * r.totalMs) / total).toFixed(1).padStart(5);
  const mean = (r.totalMs / r.calls).toFixed(2).padStart(8);
  console.log(
    `${share} %  calls ${String(r.calls).padStart(7)}  mean ${mean} ms  max ${r.maxMs.toFixed(0).padStart(6)} ms  ${r.query}`,
  );
}
