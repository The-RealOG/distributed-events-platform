// What every app connection is doing, sampled every 5 s until stopped (see pgactivity.sh).
//   DATABASE_URL=… node scripts/load/pgactivity.mjs <file>
import { appendFileSync } from 'node:fs';
import pg from 'pg';

const [out] = process.argv.slice(2);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const SAMPLE = `
  SELECT state,
         coalesce(wait_event_type || ':' || wait_event, '-') AS wait,
         cardinality(pg_blocking_pids(pid)) > 0 AS blocked,
         extract(epoch FROM now() - query_start) AS running_s,
         left(regexp_replace(query, '\\s+', ' ', 'g'), 120) AS query
  FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`;

for (;;) {
  const { rows } = await client.query(SAMPLE);
  const counts = {};
  for (const r of rows) counts[`${r.state}/${r.wait}`] = (counts[`${r.state}/${r.wait}`] ?? 0) + 1;
  const [longest] = rows
    .filter((r) => r.state === 'active')
    .sort((a, b) => b.running_s - a.running_s);
  const line = [
    new Date().toISOString().slice(11, 19),
    `conns=${rows.length}`,
    `blocked=${rows.filter((r) => r.blocked).length}`,
    ...Object.entries(counts).map(([k, v]) => `${k}=${v}`),
    longest ? `longest=${Number(longest.running_s).toFixed(2)}s "${longest.query}"` : '',
  ];
  appendFileSync(out, `${line.filter(Boolean).join(' ')}\n`);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
