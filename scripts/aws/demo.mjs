#!/usr/bin/env node
// Phases 6–7 demonstrations against the deployed environment, through the public URL only
// (CloudFront → ALB → gateway → project-service). Workers are stopped/started by scaling their
// ECS services; the Redis outage is a real ElastiCache node reboot. Nothing is repaired by hand.
//   npm run aws:demo        (scripts/aws/demo.sh passes the app URL and cluster)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [appUrl, cluster, replicationGroup] = process.argv.slice(2);
const api = `${appUrl}/api`;
const results = [];

const aws = (...args) =>
  JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8' }) || 'null');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`  ${msg}`);
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(
    `${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`,
  );
}

async function call(method, path, { token, body, correlationId } = {}) {
  const started = performance.now();
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => undefined);
  return {
    status: res.status,
    body: json,
    cache: res.headers.get('x-cache'),
    ms: Math.round(performance.now() - started),
  };
}

async function until(what, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const started = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return { value: v, ms: Date.now() - started };
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1_000);
  }
}

async function scale(service, count) {
  aws(
    'ecs',
    'update-service',
    '--cluster',
    cluster,
    '--service',
    service,
    '--desired-count',
    String(count),
  );
  execFileSync('aws', [
    'ecs',
    'wait',
    'services-stable',
    '--cluster',
    cluster,
    '--services',
    service,
  ]);
}

async function newProject() {
  const login = await call('POST', '/auth/dev-login', {
    body: { email: `demo-${randomUUID()}@example.com`, displayName: 'Demo' },
  });
  const token = login.body.token;
  const ws = await call('POST', '/workspaces', { token, body: { name: 'Demo' } });
  const project = await call('POST', '/projects', {
    token,
    body: { workspaceId: ws.body.id, name: 'Demo' },
  });
  const board = await call('GET', `/projects/${project.body.id}/board`, { token });
  return { token, projectId: project.body.id, columns: board.body.columns.map((c) => c.id) };
}
const board = (p) => call('GET', `/projects/${p.projectId}/board`, { token: p.token });
const titles = (b) => b.body.columns.flatMap((c) => c.tasks.map((t) => t.title)).sort();
const activity = async (p) =>
  (await call('GET', `/projects/${p.projectId}/activity?limit=100`, { token: p.token })).body.items;
async function createTask(p, title, correlationId) {
  const r = await call('POST', '/tasks', {
    token: p.token,
    correlationId,
    body: { projectId: p.projectId, columnId: p.columns[0], title },
  });
  if (r.status !== 201) throw new Error(`create task: ${r.status}`);
  return r.body;
}

async function demo(name, fn) {
  try {
    await fn();
  } catch (err) {
    record(name, false, err.message);
  }
}

console.log(`Phase 6–7 demo against ${appUrl}\n`);

await demo('A. activity is eventually consistent', async () => {
  const p = await newProject();
  const corr = `demo-${randomUUID()}`;
  const t = await createTask(p, 'Write spec', corr);
  await call('PATCH', `/tasks/${t.id}`, {
    token: p.token,
    body: { expectedVersion: 1, title: 'Write the spec' },
  });
  const moved = await call('POST', `/tasks/${t.id}/move`, {
    token: p.token,
    body: { expectedVersion: 2, columnId: p.columns[1], afterTaskId: null },
  });
  log(`three changes returned ${moved.status} immediately`);
  const { value, ms } = await until('3 activity entries', async () => {
    const a = await activity(p);
    return a.length >= 3 ? a : undefined;
  });
  record(
    'A. activity is eventually consistent',
    value.map((i) => i.eventType).join() === 'task.moved,task.updated,task.created' &&
      value[2].correlationId === corr,
    `history caught up ${ms} ms after the last change (poll interval 1 s); correlation ${corr} preserved`,
  );
});

await demo('B. activity outage and catch-up', async () => {
  const p = await newProject();
  await createTask(p, 'before');
  await until('first activity', async () => (await activity(p)).length === 1);
  await scale('activity-service', 0);
  log('activity-service scaled to 0');
  for (const title of ['during 1', 'during 2', 'during 3']) await createTask(p, title);
  const stillOne = (await activity(p)).length === 1;
  const boardNow = titles(await board(p));
  log(
    `writes succeeded; board=${boardNow.join('|')}; activity entries still ${(await activity(p)).length}`,
  );
  await scale('activity-service', 1);
  const { value, ms } = await until('backlog applied', async () => {
    const a = await activity(p);
    return a.length >= 4 ? a : undefined;
  });
  await sleep(3_000);
  const final = await activity(p);
  record(
    'B. activity outage and catch-up',
    stillOne &&
      final.length === 4 &&
      new Set(final.map((i) => i.eventId)).size === 4 &&
      value.length === 4,
    `backlog of 3 applied ${ms} ms after restart; no duplicates`,
  );
});

await demo('C. board cache: miss then hit', async () => {
  const p = await newProject();
  await createTask(p, 'cached');
  await sleep(3_000); // let this project's own invalidation pass
  const reads = [];
  for (let i = 0; i < 6; i++) reads.push(await board(p));
  const [first, ...rest] = reads;
  record(
    'C. board cache: miss then hit',
    first.cache === 'MISS' && rest.every((r) => r.cache === 'HIT'),
    `MISS ${first.ms} ms; HITs ${rest.map((r) => r.ms).join('/')} ms (end-to-end through CloudFront)`,
  );
});

await demo('D. Kafka-driven invalidation', async () => {
  const p = await newProject();
  const t = await createTask(p, 'v1');
  await sleep(3_000);
  await board(p);
  const hit = await board(p);
  await call('PATCH', `/tasks/${t.id}`, {
    token: p.token,
    body: { expectedVersion: 1, title: 'v2' },
  });
  const { value, ms } = await until('fresh board', async () => {
    const b = await board(p);
    return titles(b).includes('v2') ? b : undefined;
  });
  const after = await board(p);
  record(
    'D. Kafka-driven invalidation',
    hit.cache === 'HIT' &&
      value.cache === 'MISS' &&
      after.cache === 'HIT' &&
      titles(after).join() === 'v2',
    `fresh ${ms} ms after the change: outbox → Kafka → invalidator → DEL; next read HIT`,
  );
});

await demo('F. invalidator outage and convergence', async () => {
  const p = await newProject();
  const t = await createTask(p, 'old');
  await sleep(3_000);
  await board(p);
  await scale('cache-invalidator', 0);
  log('cache-invalidator scaled to 0');
  await call('PATCH', `/tasks/${t.id}`, {
    token: p.token,
    body: { expectedVersion: 1, title: 'new' },
  });
  await createTask(p, 'another');
  const authoritative = (await call('GET', `/tasks/${t.id}`, { token: p.token })).body.title;
  const stale = await board(p);
  log(
    `PostgreSQL says "${authoritative}"; cached board says ${titles(stale).join('|')} (${stale.cache})`,
  );
  await scale('cache-invalidator', 1);
  const { ms } = await until(
    'converged',
    async () => titles(await board(p)).join() === 'another,new',
  );
  record(
    'F. invalidator outage and convergence',
    authoritative === 'new' && stale.cache === 'HIT' && titles(stale).join() === 'old',
    `stale while stopped (bounded by TTL); converged ${ms} ms after restart`,
  );
});

await demo('E. Redis outage', async () => {
  const p = await newProject();
  const t = await createTask(p, 'r1');
  await board(p);
  const member = aws(
    'elasticache',
    'describe-replication-groups',
    '--replication-group-id',
    replicationGroup,
  ).ReplicationGroups[0].MemberClusters[0];
  aws(
    'elasticache',
    'reboot-cache-cluster',
    '--cache-cluster-id',
    member,
    '--cache-node-ids-to-reboot',
    '0001',
  );
  log(`rebooting ElastiCache node ${member}`);
  const { value: down } = await until(
    'cache unavailable',
    async () => {
      const b = await board(p);
      return b.cache === 'BYPASS' ? b : undefined;
    },
    300_000,
  );
  const write = await call('PATCH', `/tasks/${t.id}`, {
    token: p.token,
    body: { expectedVersion: 1, title: 'r2' },
  });
  const readDuring = await board(p);
  log(
    `during outage: board ${down.status} ${down.cache} in ${down.ms} ms; write ${write.status}; read shows ${titles(readDuring).join()}`,
  );
  const { ms } = await until(
    'caching resumed',
    async () => {
      const b = await board(p);
      return b.cache === 'HIT' && titles(b).join() === 'r2';
    },
    600_000,
  );
  record(
    'E. Redis outage',
    down.status === 200 && write.status === 200 && titles(readDuring).join() === 'r2',
    `reads fell back to PostgreSQL, writes unaffected; caching resumed ${ms} ms later without repair`,
  );
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} demonstrations passed`);
process.exit(failed ? 1 : 0);
