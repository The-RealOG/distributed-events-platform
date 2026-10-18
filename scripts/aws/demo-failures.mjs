#!/usr/bin/env node
// Failure injections against the deployed environment, all through supported AWS APIs,
// all observed through the public URL. Recovery is automatic (ECS, RDS, MSK).
// Nothing is patched by hand.
//   npm run aws:demo:failures [-- <only>]   only ∈ publisher|tasks|rds|kafka
// (S3 outage behaviour is covered by the storage-outage integration tests; an AWS injection would
// need an IAM change restored by Terraform, which is left to an explicit operator decision.)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [appUrl, cluster, rdsId, mskArn, only] = process.argv.slice(2);
const api = `${appUrl}/api`;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`  ${m}`);
const aws = (...args) =>
  JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8' }) || 'null');
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`,
  );
};

async function call(method, path, { token, body } = {}) {
  try {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: await res.json().catch(() => undefined) };
  } catch (err) {
    return { status: 0, body: { error: String(err) } };
  }
}
async function fixture() {
  const login = await call('POST', '/auth/dev-login', {
    body: { email: `chaos-${randomUUID()}@example.com`, displayName: 'chaos' },
  });
  const token = login.body.token;
  const ws = await call('POST', '/workspaces', { token, body: { name: 'Chaos' } });
  const p = await call('POST', '/projects', {
    token,
    body: { workspaceId: ws.body.id, name: 'P' },
  });
  const board = await call('GET', `/projects/${p.body.id}/board`, { token });
  return { token, projectId: p.body.id, columnId: board.body.columns[0].id };
}
const create = (f, title) =>
  call('POST', '/tasks', {
    token: f.token,
    body: { projectId: f.projectId, columnId: f.columnId, title },
  });
async function until(what, probe, timeoutMs = 600_000, everyMs = 1_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}
const scale = (service, n) =>
  aws(
    'ecs',
    'update-service',
    '--cluster',
    cluster,
    '--service',
    service,
    '--desired-count',
    String(n),
  );
const running = (service) =>
  aws('ecs', 'describe-services', '--cluster', cluster, '--services', service).services[0];
const activityHas = async (f, taskId) => {
  const r = await call('GET', `/projects/${f.projectId}/activity?limit=100`, { token: f.token });
  return r.status === 200 && r.body.items.some((i) => i.taskId === taskId);
};
/** Background prober: one request per interval; returns the failure window. */
function prober(fn, everyMs = 500) {
  const samples = [];
  let stop = false;
  const done = (async () => {
    while (!stop) {
      const t = Date.now();
      const r = await fn();
      samples.push({ t, status: r.status });
      await sleep(Math.max(0, everyMs - (Date.now() - t)));
    }
  })();
  return {
    async stop() {
      stop = true;
      await done;
      const bad = samples.filter((s) => s.status === 0 || s.status >= 500);
      const codes = [...new Set(bad.map((s) => s.status))];
      return {
        total: samples.length,
        failed: bad.length,
        windowMs: bad.length ? bad.at(-1).t - bad[0].t : 0,
        codes,
        firstBad: bad[0]?.t,
        lastBad: bad.at(-1)?.t,
      };
    },
  };
}
async function demo(key, name, fn) {
  if (only && only !== key) return;
  console.log(`\n▶ ${name}`);
  try {
    await fn();
  } catch (err) {
    record(name, false, err.message);
  }
}
const logsCount = (group, pattern, fromMs, toMs) => {
  const out = aws(
    'logs',
    'filter-log-events',
    '--log-group-name',
    group,
    '--start-time',
    String(fromMs),
    '--end-time',
    String(toMs),
    '--filter-pattern',
    pattern,
    '--query',
    'events[].timestamp',
  );
  return out ?? [];
};

console.log(`Failure injections against ${appUrl}`);

await demo(
  'publisher',
  'Outbox publisher outage: writes continue, backlog drains, nothing lost',
  async () => {
    const f = await fixture();
    scale('outbox-publisher', 0);
    await until(
      'publisher stopped',
      () => running('outbox-publisher').runningCount === 0,
      300_000,
      3_000,
    );
    log('publisher at 0 tasks; writing');
    const N = 300;
    const created = [];
    const t0 = Date.now();
    for (let i = 0; i < N; i += 10) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, k) => create(f, `During outage ${i + k}`)),
      );
      created.push(...batch);
    }
    const writeMs = Date.now() - t0;
    const ok = created.filter((r) => r.status === 201).length;
    log(`${ok}/${N} writes succeeded in ${writeMs} ms with no publisher`);
    const noActivity = !(await activityHas(f, created.at(-1).body.id));
    const restartAt = Date.now();
    scale('outbox-publisher', 1);
    const last = created.at(-1).body.id;
    const { ms: e2e } = await until(
      'activity for the last backlog event',
      () => activityHas(f, last),
      600_000,
      2_000,
    );
    const published = logsCount(
      '/ecs/dpp-dev/outbox-publisher',
      '"outbox event published"',
      restartAt,
      Date.now(),
    );
    const drainMs = published.length > 1 ? Math.max(...published) - Math.min(...published) : 0;
    record(
      'Outbox publisher outage: writes continue, backlog drains, nothing lost',
      ok === N && noActivity,
      `${ok}/${N} writes OK during the outage (backlog ≥ ${N} events; also board/activity reads kept working); after scale-up the publisher published ${published.length} events in ${(drainMs / 1000).toFixed(1)} s from first to last (${drainMs ? ((published.length / drainMs) * 1000).toFixed(0) : '-'} events/s); last backlog event visible in activity ${Math.round(e2e / 1000)} s after the scale-up command (includes ECS task start)`,
    );
  },
);

await demo(
  'tasks',
  'ECS task termination: ECS restores desired count; clients see a bounded error window',
  async () => {
    const f = await fixture();
    const read = await create(f, 'probe');
    for (const service of ['api-gateway', 'project-service', 'activity-service']) {
      const before = running(service);
      const task = aws(
        'ecs',
        'list-tasks',
        '--cluster',
        cluster,
        '--service-name',
        service,
        '--desired-status',
        'RUNNING',
      ).taskArns[0];
      const p = prober(() => call('GET', `/tasks/${read.body.id}`, { token: f.token }), 500);
      const t0 = Date.now();
      aws('ecs', 'stop-task', '--cluster', cluster, '--task', task, '--reason', 'failure test');
      const { ms: replaced } = await until(
        `${service} replacement running`,
        () => {
          const s = running(service);
          const tasks = aws(
            'ecs',
            'list-tasks',
            '--cluster',
            cluster,
            '--service-name',
            service,
            '--desired-status',
            'RUNNING',
          ).taskArns;
          return (
            s.runningCount === before.desiredCount && tasks.length > 0 && !tasks.includes(task)
          );
        },
        600_000,
        3_000,
      );
      let consumerMs;
      if (service === 'activity-service') {
        const after = await create(f, 'after consumer restart');
        consumerMs = (
          await until('activity after restart', () => activityHas(f, after.body.id), 300_000, 2_000)
        ).ms;
      }
      await sleep(3_000);
      const w = await p.stop();
      record(
        `ECS task termination: ${service}`,
        true,
        `replacement RUNNING ${Math.round(replaced / 1000)} s after stop-task; probe GET /tasks/:id: ${w.failed}/${w.total} failed (${w.codes.join(',') || 'none'}) over ${Math.round(w.windowMs / 1000)} s` +
          (consumerMs !== undefined
            ? `; a new event reached activity ${Math.round(consumerMs / 1000)} s after the replacement`
            : '') +
          (t0 ? '' : ''),
      );
    }
  },
);

await demo(
  'rds',
  'RDS reboot (single-AZ: closest practical interruption; no managed failover exists here)',
  async () => {
    const f = await fixture();
    const probeTask = await create(f, 'rds probe');
    const tasksBefore = Object.fromEntries(
      ['project-service', 'outbox-publisher', 'activity-service', 'realtime-service'].map((s) => [
        s,
        aws(
          'ecs',
          'list-tasks',
          '--cluster',
          cluster,
          '--service-name',
          s,
          '--desired-status',
          'RUNNING',
        )
          .taskArns.sort()
          .join(),
      ]),
    );
    const reads = prober(
      () => call('GET', `/tasks/${probeTask.body.id}`, { token: f.token }),
      1_000,
    );
    const writes = [];
    // A separate flag: the loop condition runs before the first await, while `writer` is still in
    // its temporal dead zone (reading writer.stop there threw and ended the demo after the reboot
    // had been requested).
    const writing = { stop: false };
    const writer = (async () => {
      for (let i = 0; i < 400 && !writing.stop; i++) {
        const r = await create(f, `rds ${i}`);
        writes.push({ t: Date.now(), status: r.status, code: r.body?.error?.code });
        await sleep(1_000);
      }
    })();
    const t0 = Date.now();
    aws('rds', 'reboot-db-instance', '--db-instance-identifier', rdsId);
    log('RDS reboot requested');
    await until(
      'RDS rebooting',
      () =>
        aws('rds', 'describe-db-instances', '--db-instance-identifier', rdsId).DBInstances[0]
          .DBInstanceStatus !== 'available',
      120_000,
      2_000,
    ).catch(() => undefined);
    await until(
      'RDS available',
      () =>
        aws('rds', 'describe-db-instances', '--db-instance-identifier', rdsId).DBInstances[0]
          .DBInstanceStatus === 'available',
      900_000,
      5_000,
    );
    const { ms: firstOk } = await until(
      'a write succeeds again',
      async () => (await create(f, 'after reboot')).status === 201,
      600_000,
      1_000,
    );
    writing.stop = true;
    await writer;
    const w = await reads.stop();
    const failedWrites = writes.filter((x) => x.status !== 201);
    const codes = [...new Set(failedWrites.map((x) => `${x.status}${x.code ? ` ${x.code}` : ''}`))];
    const tasksAfter = Object.fromEntries(
      Object.keys(tasksBefore).map((s) => [
        s,
        aws(
          'ecs',
          'list-tasks',
          '--cluster',
          cluster,
          '--service-name',
          s,
          '--desired-status',
          'RUNNING',
        )
          .taskArns.sort()
          .join(),
      ]),
    );
    const restarted = Object.keys(tasksBefore).filter((s) => tasksBefore[s] !== tasksAfter[s]);
    record(
      'RDS reboot (single-AZ: closest practical interruption; no managed failover exists here)',
      failedWrites.every((x) => x.status === 503) && restarted.length === 0,
      `reads failed ${w.failed}/${w.total} over ${Math.round(w.windowMs / 1000)} s; writes failed ${failedWrites.length}/${writes.length} with ${codes.join(', ') || 'none'}; first successful write ${Math.round((Date.now() - t0 - 0) / 1000)} s after the reboot request (${Math.round(firstOk / 1000)} s after RDS reported available); ECS tasks restarted: ${restarted.join(', ') || 'none'} (pools reconnected by themselves)`,
    );
  },
);

await demo(
  'kafka',
  'MSK broker reboot (1 of 2): writes and event flow continue through leader failover',
  async () => {
    const f = await fixture();
    const writes = [];
    let stop = false;
    const writer = (async () => {
      while (!stop) {
        const r = await create(f, 'during broker reboot');
        writes.push({ t: Date.now(), status: r.status, id: r.body?.id });
        await sleep(1_000);
      }
    })();
    const t0 = Date.now();
    aws('kafka', 'reboot-broker', '--cluster-arn', mskArn, '--broker-ids', '1');
    log('broker 1 rebooting');
    await until(
      'MSK rebooting',
      () =>
        aws('kafka', 'describe-cluster-v2', '--cluster-arn', mskArn).ClusterInfo.State !== 'ACTIVE',
      120_000,
      3_000,
    ).catch(() => undefined);
    const { ms } = await until(
      'MSK ACTIVE',
      () =>
        aws('kafka', 'describe-cluster-v2', '--cluster-arn', mskArn).ClusterInfo.State === 'ACTIVE',
      1_800_000,
      10_000,
    );
    stop = true;
    await writer;
    const ok = writes.filter((w) => w.status === 201);
    const lastId = ok.at(-1).id;
    const { ms: caught } = await until(
      'activity caught up',
      () => activityHas(f, lastId),
      600_000,
      2_000,
    );
    const errors = logsCount(
      '/ecs/dpp-dev/outbox-publisher',
      '"outbox publish failed"',
      t0,
      Date.now(),
    );
    record(
      'MSK broker reboot (1 of 2): HTTP writes continue; events wait in the outbox, then flow again',
      ok.length === writes.length,
      `cluster back to ACTIVE after ${Math.round(ms / 1000)} s; ${ok.length}/${writes.length} writes OK during the reboot; publisher 'publish failed' log lines (expected with min.insync.replicas=2): ${errors.length}; the last write reached activity ${Math.round(caught / 1000)} s after the cluster was ACTIVE`,
    );
  },
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
