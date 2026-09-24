#!/usr/bin/env node
// Data-invariant audit (read-only) against PostgreSQL, run after load and failure tests.
//   npm run aws:invariants     (scripts/aws/invariants.sh opens the tunnel and supplies credentials)
// Every check prints PASS/FAIL with the counts it is based on. "Tool-injected" events (kafka-tools
// produce-sample / produce-malformed in demos) never went through the outbox and are reported
// separately, not as violations.
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // through the local SSM tunnel; RDS itself requires TLS
});
await client.connect();
await client.query('SET default_transaction_read_only = on');
const q = async (sql) => (await client.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];
let failed = 0;
const check = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(
    `${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${label}${detail ? ` — ${detail}` : ''}`,
  );
};

// Consistent snapshot for all reads.
await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

const outbox = await one(`SELECT count(*)::int AS total,
  count(*) FILTER (WHERE published_at IS NULL)::int AS unpublished,
  count(*) FILTER (WHERE published_at IS NULL AND created_at < now() - interval '1 minute')::int AS stuck,
  count(*) FILTER (WHERE claimed_until > now())::int AS claimed
  FROM outbox_events`);
check(
  outbox.stuck === 0,
  'no committed event left unpublished for over a minute (no lost events)',
  `${outbox.total} events; ${outbox.unpublished} unpublished now (${outbox.claimed} claimed), ${outbox.stuck} older than 1 min`,
);

const versions = await one(`WITH ev AS (
    SELECT aggregate_id, max(aggregate_version) AS maxv, count(*) AS n, count(DISTINCT aggregate_version) AS nd, min(aggregate_version) AS minv
    FROM outbox_events WHERE aggregate_type = 'task' GROUP BY aggregate_id)
  SELECT count(*)::int AS tasks,
    count(*) FILTER (WHERE ev.aggregate_id IS NULL)::int AS without_events,
    count(*) FILTER (WHERE ev.maxv <> t.version)::int AS version_mismatch,
    count(*) FILTER (WHERE ev.n <> ev.nd OR ev.minv <> 1 OR ev.maxv <> ev.n)::int AS gaps_or_repeats
  FROM tasks t LEFT JOIN ev ON ev.aggregate_id = t.id`);
check(
  versions.without_events === 0 &&
    versions.version_mismatch === 0 &&
    versions.gaps_or_repeats === 0,
  'every task version is explained by exactly one event per version (1..n, no gaps, no repeats)',
  `${versions.tasks} tasks; ${versions.without_events} without events; ${versions.version_mismatch} version ≠ last event; ${versions.gaps_or_repeats} with gaps/repeats`,
);

const act = await one(
  `SELECT count(*)::int AS rows, count(DISTINCT event_id)::int AS distinct_events FROM activity_events`,
);
check(
  act.rows === act.distinct_events,
  'no duplicate activity rows',
  `${act.rows} rows, ${act.distinct_events} distinct events`,
);

const missing = await one(`SELECT count(*)::int AS n FROM outbox_events o
  WHERE o.published_at IS NOT NULL AND o.published_at < now() - interval '1 minute'
    AND NOT EXISTS (SELECT 1 FROM activity_events a WHERE a.event_id = o.event_id)`);
check(
  missing.n === 0,
  'every event published over a minute ago has its activity row (activity caught up)',
  `${missing.n} missing`,
);

const markers = await one(`SELECT
  (SELECT count(*) FROM activity_events a WHERE NOT EXISTS (SELECT 1 FROM processed_events p WHERE p.consumer_name = 'activity-service' AND p.event_id = a.event_id))::int AS rows_without_marker,
  (SELECT count(*) FROM processed_events p WHERE p.consumer_name = 'activity-service' AND NOT EXISTS (SELECT 1 FROM activity_events a WHERE a.event_id = p.event_id))::int AS markers_without_row,
  (SELECT count(*) FROM processed_events)::int AS markers`);
check(
  markers.rows_without_marker === 0 && markers.markers_without_row === 0,
  'processed_events and activity rows correspond 1:1 (side effect and marker committed together)',
  `${markers.markers} markers; ${markers.rows_without_marker} rows without marker; ${markers.markers_without_row} markers without row`,
);

const injected = await one(
  `SELECT count(*)::int AS n FROM activity_events a WHERE NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.event_id = a.event_id)`,
);
console.log(
  `NOTE activity rows for tool-injected events (kafka-tools demos, no outbox row): ${injected.n}`,
);

const orphans = await one(`SELECT
  count(*) FILTER (WHERE t.id IS NULL)::int AS assignee_orphans FROM task_assignees ta LEFT JOIN tasks t ON t.id = ta.task_id`);
check(
  orphans.assignee_orphans === 0,
  'no assignments on missing tasks',
  `${orphans.assignee_orphans}`,
);

const att = await one(`SELECT count(*)::int AS total,
  count(*) FILTER (WHERE status = 'ready')::int AS ready,
  count(*) FILTER (WHERE status = 'pending' AND created_at < now() - interval '1 hour')::int AS stale_pending,
  count(*) FILTER (WHERE status = 'deleted' AND object_deleted_at IS NULL)::int AS delete_pending,
  count(*) FILTER (WHERE status = 'ready' AND ready_at IS NULL)::int AS ready_without_time
  FROM attachments`);
check(
  att.ready_without_time === 0,
  'attachments: every ready row was finalized',
  `${att.total} rows, ${att.ready} ready; ${att.stale_pending} stale pending and ${att.delete_pending} object deletes awaiting the sweep (converged by the sweep, ADR-022)`,
);

await client.query('COMMIT');
await client.end();
console.log(`\n${failed === 0 ? 'all invariants hold' : `${failed} invariant(s) violated`}`);
process.exit(failed ? 1 : 0);
