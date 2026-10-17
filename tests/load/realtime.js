// Realtime (WebSocket) load: CONNECTIONS subscribers on PROJECT_COUNT project(s) hold a socket
// for the whole run, while a writer creates tasks at WRITE_RATE per second. Measures connection
// success, delivery completeness and commit → client latency.
//   k6 run -e BASE_URL=https://… -e CONNECTIONS=250 -e HOLD=3m tests/load/realtime.js
//
// Latency is measured on ONE clock (no cross-machine skew): a probe VU creates each task over
// HTTP and waits for that task's notification on its own socket.
//   notify_after_commit_ms  = notification received − HTTP 201 received (commit already done)
//   notify_after_request_ms = notification received − request sent (what a collaborator sees)
// (occurredAt vs. a remote clock was tried first and measured the clock skew instead.)
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { call } from './lib/api.js';
import { BASE_URL, PROJECT_COUNT } from './lib/config.js';
import { seed } from './lib/seed.js';

const CONNECTIONS = parseInt(__ENV.CONNECTIONS || '100', 10);
const HOLD = __ENV.HOLD || '3m';
const WRITE_RATE = parseInt(__ENV.WRITE_RATE || '2', 10);
const RAMP = __ENV.RAMP || '1m';
const holdMs = (() => {
  const m = /^(\d+)(s|m)$/.exec(HOLD);
  return m ? parseInt(m[1], 10) * (m[2] === 'm' ? 60_000 : 1000) : 180_000;
})();
const rampMs = (() => {
  const m = /^(\d+)(s|m)$/.exec(RAMP);
  return m ? parseInt(m[1], 10) * (m[2] === 'm' ? 60_000 : 1000) : 60_000;
})();

const connected = new Rate('ws_subscribed'); // subscribed successfully
const received = new Counter('ws_events_received');
const published = new Counter('events_published');
const afterCommit = new Trend('notify_after_commit_ms', true);
const afterRequest = new Trend('notify_after_request_ms', true);
const closes = new Counter('ws_closed_by_server');

export const options = {
  scenarios: {
    subscribers: {
      executor: 'per-vu-iterations',
      vus: CONNECTIONS,
      iterations: 1,
      maxDuration: `${Math.ceil((holdMs + rampMs) / 1000) + 120}s`,
      exec: 'subscriber',
    },
    // Writes start once every subscriber has had time to connect, and stop before they leave.
    probe: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: `${Math.ceil(rampMs / 1000) + 10}s`,
      maxDuration: `${Math.ceil(holdMs / 1000) + 60}s`,
      exec: 'probe',
    },
  },
  setupTimeout: '15m',
  thresholds: {
    ws_subscribed: ['rate>0.99'],
    notify_after_commit_ms: ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

export function setup() {
  return seed();
}

export function subscriber(data) {
  const vu = exec.vu.idInTest;
  const user = data.users[vu % data.users.length];
  const project = data.projects[vu % data.projects.length];
  // Spread connection attempts over RAMP (no synchronized connect storm unless RAMP=0s).
  const wait = (rampMs * (vu - 1)) / Math.max(1, CONNECTIONS);
  // k6's sleep blocks only this VU. A busy-wait here (as before) kept every waiting VU spinning:
  // at 1,000 connections the 2-vCPU runner starved, clients missed the server's 5 s auth window
  // and the run measured the load generator, not the service (bug ledger #28).
  if (wait > 0) sleep(wait / 1000);
  const url = `${BASE_URL.replace(/^http/, 'ws')}/api/realtime`;
  let subscribed = false;
  const res = ws.connect(url, { headers: { Origin: BASE_URL }, tags: { kind: 'ws' } }, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: user.token })));
    socket.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'ready')
        socket.send(JSON.stringify({ type: 'subscribe', projectId: project.id }));
      else if (m.type === 'subscribed') subscribed = true;
      else if (m.type === 'event') {
        received.add(1);
      }
    });
    socket.on('close', (code) => {
      if (code !== 1000 && code !== 1005) closes.add(1, { code: String(code) });
    });
    socket.setTimeout(() => socket.close(1000), holdMs + rampMs - wait);
  });
  connected.add(subscribed);
  check(res, { 'upgraded (101)': (r) => r && r.status === 101 });
}

export function probe(data) {
  const user = data.users[0];
  const project = data.projects[0];
  const pending = {};
  const writeFor = Math.max(10_000, holdMs - 30_000);
  const url = `${BASE_URL.replace(/^http/, 'ws')}/api/realtime`;
  ws.connect(url, { headers: { Origin: BASE_URL }, tags: { kind: 'ws-probe' } }, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: user.token })));
    socket.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'ready')
        socket.send(JSON.stringify({ type: 'subscribe', projectId: project.id }));
      else if (m.type === 'subscribed') {
        const started = Date.now();
        socket.setInterval(() => {
          if (Date.now() - started > writeFor) return;
          const sent = Date.now();
          const r = call('create', 'POST', '/tasks', {
            token: user.token,
            body: { projectId: project.id, columnId: project.columns[0], title: 'Realtime load' },
          });
          if (r.status === 201) {
            published.add(1);
            pending[r.body.id] = { sent, committed: Date.now() };
          }
        }, 1000 / WRITE_RATE);
      } else if (m.type === 'event' && pending[m.event.taskId] && m.event.type === 'task.created') {
        const t = pending[m.event.taskId];
        delete pending[m.event.taskId];
        const now = Date.now();
        afterCommit.add(now - t.committed);
        afterRequest.add(now - t.sent);
      }
    });
    socket.setTimeout(() => socket.close(1000), writeFor + 20_000);
  });
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (name, key) => (m[name] ? m[name].values[key] : 0);
  const events = v('events_published', 'count');
  const got = v('ws_events_received', 'count');
  // The probe writes to the first project; each subscriber of it should get every event (the
  // probe's own socket is not counted in ws_events_received).
  const perProject = Math.ceil(CONNECTIONS / Math.max(1, PROJECT_COUNT));
  const expected = events * perProject;
  const lines = [
    `connections ${CONNECTIONS} on ${PROJECT_COUNT} project(s); subscribed ${(v('ws_subscribed', 'rate') * 100).toFixed(2)} %`,
    `events published ${events} (${WRITE_RATE}/s); notifications received ${got} of ~${expected} expected (${expected ? ((100 * got) / expected).toFixed(2) : '-'} %)`,
    `notification after HTTP 201 (ms): p50 ${v('notify_after_commit_ms', 'med').toFixed(0)}  p95 ${v('notify_after_commit_ms', 'p(95)').toFixed(0)}  p99 ${v('notify_after_commit_ms', 'p(99)').toFixed(0)}  max ${v('notify_after_commit_ms', 'max').toFixed(0)}  (n=${v('notify_after_commit_ms', 'count')})`,
    `notification after request sent (ms): p50 ${v('notify_after_request_ms', 'med').toFixed(0)}  p95 ${v('notify_after_request_ms', 'p(95)').toFixed(0)}  p99 ${v('notify_after_request_ms', 'p(99)').toFixed(0)}`,
    `server-initiated closes ${v('ws_closed_by_server', 'count')}`,
  ];
  const out = { stdout: `\n${lines.join('\n')}\n` };
  // setup_data holds the load users' tokens: never written to disk.
  if (__ENV.SUMMARY_FILE)
    out[__ENV.SUMMARY_FILE] = JSON.stringify({ ...data, setup_data: undefined }, null, 1);
  return out;
}
