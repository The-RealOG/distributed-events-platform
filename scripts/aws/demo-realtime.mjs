#!/usr/bin/env node
// Phases 8–9 demonstrations against the deployed environment, through the public URL only
// (browser path: CloudFront → ALB → gateway → realtime-service / project-service; attachment
// bytes go straight to S3). The realtime replica restart is a real ECS redeployment.
//   npm run aws:demo:realtime      (scripts/aws/demo-realtime.sh passes the app URL and cluster)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const [appUrl, cluster] = process.argv.slice(2);
const api = `${appUrl}/api`;
const wsUrl = `${appUrl.replace(/^http/, 'ws')}/api/realtime`;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`  ${msg}`);
const aws = (...args) =>
  JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8' }) || 'null');
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(
    `${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`,
  );
}

async function call(method, path, { token, body, correlationId } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}
async function login(name) {
  const res = await call('POST', '/auth/dev-login', {
    body: { email: `${name}-${randomUUID()}@example.com`, displayName: name },
  });
  return { token: res.body.token, id: res.body.user.id, email: res.body.user.email };
}
async function until(what, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** A browser-like client: Origin = the app, JWT as the first message, then subscribe. */
function client(token, projectId, origin = appUrl) {
  const socket = new WebSocket(wsUrl, { origin });
  const c = {
    socket,
    messages: [],
    arrivals: new Map(),
    closeCode: undefined,
    httpStatus: undefined,
  };
  socket.on('unexpected-response', (_req, res) => (c.httpStatus = res.statusCode));
  socket.on('error', () => undefined);
  socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
  socket.on('close', (code) => (c.closeCode = code));
  socket.on('message', (d) => {
    const m = JSON.parse(d.toString('utf8'));
    c.messages.push(m);
    if (m.type === 'ready') socket.send(JSON.stringify({ type: 'subscribe', projectId }));
    if (m.type === 'event')
      c.arrivals.set(m.event.eventId ?? randomUUID(), { at: Date.now(), event: m.event });
  });
  c.subscribed = () => c.messages.some((m) => m.type === 'subscribed');
  c.eventFor = (taskId, type) =>
    [...c.arrivals.values()].find((a) => a.event.taskId === taskId && a.event.type === type);
  return c;
}

async function sharedProject() {
  const [a, b] = [await login('ada'), await login('bob')];
  const ws = await call('POST', '/workspaces', { token: a.token, body: { name: 'Realtime demo' } });
  await call('POST', `/workspaces/${ws.body.id}/members`, {
    token: a.token,
    body: { email: b.email, role: 'MEMBER' },
  });
  const project = await call('POST', '/projects', {
    token: a.token,
    body: { workspaceId: ws.body.id, name: 'Board' },
  });
  const board = await call('GET', `/projects/${project.body.id}/board`, { token: a.token });
  return { a, b, projectId: project.body.id, columns: board.body.columns.map((c) => c.id) };
}

async function demo(name, fn) {
  try {
    await fn();
  } catch (err) {
    record(name, false, err.message);
  }
}

console.log(`Phases 8–9 demo against ${appUrl}\n`);

await demo('realtime: B sees A’s create and move live, with A’s correlation ID', async () => {
  const p = await sharedProject();
  const bob = client(p.b.token, p.projectId);
  await until('bob subscribed', () => bob.subscribed());
  const corr = `demo-rt-${randomUUID()}`;
  const t0 = Date.now();
  const created = await call('POST', '/tasks', {
    token: p.a.token,
    correlationId: corr,
    body: { projectId: p.projectId, columnId: p.columns[0], title: 'Live task' },
  });
  const tCommitted = Date.now();
  const got = await until('create notification', () =>
    bob.eventFor(created.body.id, 'task.created'),
  );
  const moved = await call('POST', `/tasks/${created.body.id}/move`, {
    token: p.a.token,
    body: { expectedVersion: created.body.version, columnId: p.columns[1], afterTaskId: null },
  });
  const tMoved = Date.now();
  const gotMove = await until('move notification', () =>
    bob.eventFor(created.body.id, 'task.moved'),
  );
  // The notification is a hint; B's state comes from HTTP.
  const fresh = await call('GET', `/tasks/${created.body.id}`, { token: p.b.token });
  bob.socket.close();
  record(
    'realtime: B sees A’s create and move live, with A’s correlation ID',
    got.event.correlationId === corr &&
      moved.status === 200 &&
      fresh.body.columnId === p.columns[1] &&
      !JSON.stringify(bob.messages).match(/partition|offset/),
    `create→B ${got.at - tCommitted} ms after A's 201 (request ${tCommitted - t0} ms); move→B ${gotMove.at - tMoved} ms after A's 200`,
  );
});

await demo('realtime: outsider and foreign origin refused', async () => {
  const p = await sharedProject();
  const eve = await login('eve');
  const outsider = client(eve.token, p.projectId);
  await until('refusal', () => outsider.messages.find((m) => m.type === 'error'));
  const foreign = client(p.b.token, p.projectId, 'https://evil.example');
  await until('origin refusal', () => foreign.httpStatus ?? foreign.closeCode);
  const bad = client('not-a-jwt', p.projectId);
  await until('auth refusal', () => bad.closeCode);
  outsider.socket.close();
  const refusal = outsider.messages.find((m) => m.type === 'error');
  record(
    'realtime: outsider and foreign origin refused',
    refusal.code === 'FORBIDDEN' && foreign.httpStatus === 403 && bad.closeCode === 4401,
    `outsider → ${refusal.code}; Origin evil.example → HTTP ${foreign.httpStatus}; bad token → close ${bad.closeCode}`,
  );
});

await demo(
  'realtime: missed while disconnected → reconciled by refetch after reconnect',
  async () => {
    const p = await sharedProject();
    const first = client(p.b.token, p.projectId);
    await until('subscribed', () => first.subscribed());
    first.socket.close();
    await until('closed', () => first.closeCode);
    const missed = await call('POST', '/tasks', {
      token: p.a.token,
      body: { projectId: p.projectId, columnId: p.columns[0], title: 'Missed while away' },
    });
    const second = client(p.b.token, p.projectId);
    await until('resubscribed', () => second.subscribed());
    // What the web client does on (re)subscribe: refetch the board. Board reads come from the
    // shared cache, which Kafka invalidates asynchronously, so measure the time to converge.
    const tSubscribed = Date.now();
    let reads = 0;
    await until('board includes the missed task', async () => {
      reads++;
      const board = await call('GET', `/projects/${p.projectId}/board`, { token: p.b.token });
      return board.body.columns.flatMap((c) => c.tasks.map((t) => t.id)).includes(missed.body.id);
    });
    const converged = Date.now() - tSubscribed;
    second.socket.close();
    record(
      'realtime: missed while disconnected → reconciled by refetch after reconnect',
      true,
      `board had the missed task ${converged} ms after resubscribing (${reads} read${reads > 1 ? 's' : ''}); ` +
        `its notification ${second.eventFor(missed.body.id, 'task.created') ? 'also arrived (was still in flight)' : 'was not replayed'}`,
    );
  },
);

await demo(
  'realtime: replica replaced (ECS redeploy) → going-away close, reconnect, live again',
  async () => {
    const p = await sharedProject();
    const bob = client(p.b.token, p.projectId);
    await until('subscribed', () => bob.subscribed());
    const t0 = Date.now();
    aws(
      'ecs',
      'update-service',
      '--cluster',
      cluster,
      '--service',
      'realtime-service',
      '--force-new-deployment',
    );
    log('realtime-service redeploying (ECS replaces the task)');
    await until('old replica closes the socket', () => bob.closeCode, 600_000);
    const closedAfter = Date.now() - t0;
    // What the web client does: back off, reconnect, resubscribe, refetch.
    let again;
    const reconnected = await until(
      'reconnect',
      async () => {
        again = client(p.b.token, p.projectId);
        await until(
          'attempt',
          () => again.subscribed() || again.closeCode || again.httpStatus,
          15_000,
        ).catch(() => undefined);
        if (again.subscribed()) return Date.now();
        again.socket.terminate();
        await sleep(2_000);
        return undefined;
      },
      300_000,
    );
    const created = await call('POST', '/tasks', {
      token: p.a.token,
      body: { projectId: p.projectId, columnId: p.columns[0], title: 'After failover' },
    });
    await until(
      'notification after reconnect',
      () => again.eventFor(created.body.id, 'task.created'),
      60_000,
    );
    again.socket.close();
    record(
      'realtime: replica replaced (ECS redeploy) → going-away close, reconnect, live again',
      bob.closeCode === 1001 || bob.closeCode === 1006,
      `old socket closed with ${bob.closeCode} after ${Math.round(closedAfter / 1000)} s; resubscribed ${Math.round((reconnected - t0) / 1000)} s after the redeploy began; live events resumed`,
    );
  },
);

await demo(
  'attachments: direct S3 upload (CORS), HEAD-verified finalize, authorized download',
  async () => {
    const p = await sharedProject();
    const task = await call('POST', '/tasks', {
      token: p.a.token,
      body: { projectId: p.projectId, columnId: p.columns[0], title: 'With file' },
    });
    const bytes = Buffer.from(`hello from the demo ${randomUUID()}\n`);
    const t0 = performance.now();
    const req = await call('POST', `/tasks/${task.body.id}/attachments`, {
      token: p.a.token,
      body: { filename: 'notes.txt', contentType: 'text/plain', sizeBytes: bytes.length },
    });
    const tSigned = performance.now();
    const s3Host = new URL(req.body.upload.url).host;
    // The browser's CORS preflight for the upload.
    const preflight = await fetch(req.body.upload.url, {
      method: 'OPTIONS',
      headers: { origin: appUrl, 'access-control-request-method': 'POST' },
    });
    const form = new FormData();
    for (const [k, v] of Object.entries(req.body.upload.fields)) form.append(k, v);
    form.append('file', new Blob([bytes], { type: 'text/plain' }));
    const up = await fetch(req.body.upload.url, {
      method: 'POST',
      body: form,
      headers: { origin: appUrl },
    });
    const tUploaded = performance.now();
    const done = await call('POST', `/attachments/${req.body.attachment.id}/complete`, {
      token: p.a.token,
    });
    const dl = await call('GET', `/attachments/${req.body.attachment.id}/download`, {
      token: p.b.token,
    });
    const file = await fetch(dl.body.url);
    const text = await file.text();
    const eve = await login('eve');
    const denied = await call('GET', `/attachments/${req.body.attachment.id}/download`, {
      token: eve.token,
    });
    const tooBig = await (async () => {
      const r = await call('POST', `/tasks/${task.body.id}/attachments`, {
        token: p.a.token,
        body: { filename: 'x.txt', contentType: 'text/plain', sizeBytes: 3 },
      });
      const f = new FormData();
      for (const [k, v] of Object.entries(r.body.upload.fields)) f.append(k, v);
      f.append('file', new Blob(['much more than three bytes']));
      return (await fetch(r.body.upload.url, { method: 'POST', body: f })).status;
    })();
    const anonymous = (await fetch(`https://${s3Host}/${req.body.upload.fields.key}`)).status;
    record(
      'attachments: direct S3 upload (CORS), HEAD-verified finalize, authorized download',
      req.status === 201 &&
        s3Host.endsWith('.amazonaws.com') &&
        preflight.headers.get('access-control-allow-origin') === appUrl &&
        up.status < 300 &&
        done.body.status === 'ready' &&
        text === bytes.toString() &&
        /attachment/.test(file.headers.get('content-disposition') ?? '') &&
        denied.status === 403 &&
        tooBig === 400 &&
        anonymous === 403,
      `upload to ${s3Host} (not the API); control plane ${Math.round(tSigned - t0)} ms, S3 transfer ${Math.round(tUploaded - tSigned)} ms; CORS allows ${preflight.headers.get('access-control-allow-origin')}; outsider → ${denied.status}; oversize body → S3 ${tooBig}; unsigned GET → ${anonymous}`,
    );
  },
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
