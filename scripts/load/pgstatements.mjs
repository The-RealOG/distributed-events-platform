// Saves pg_stat_statements (per normalized statement: calls, total/mean/max time, rows) as JSON,
// so a load run's delta shows which statements its time went to (see pgstatements.sh).
//   DATABASE_URL=… node scripts/load/pgstatements.mjs <file.json> [--create-extension]
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const [out, flag] = process.argv.slice(2);
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
if (flag === '--create-extension') {
  // RDS preloads the library; the extension object is created once, by the database owner.
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
}
const { rows } = await client.query(`
  SELECT queryid::text, calls, total_exec_time, mean_exec_time, max_exec_time, rows,
         left(regexp_replace(query, '\\s+', ' ', 'g'), 200) AS query
  FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`);
await client.end();
writeFileSync(
  out,
  `${JSON.stringify({ at: new Date().toISOString(), statements: rows }, null, 1)}\n`,
);
console.log(`pgstatements: ${rows.length} statements`);
