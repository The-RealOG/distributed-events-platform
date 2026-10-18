// HTTP workload. One script, five scenarios (SCENARIO=read-heavy|balanced|write-heavy|hot-project|
// multi-project); see docs/performance.md.   k6 run -e BASE_URL=https://… -e SCENARIO=balanced tests/load/http.js
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';
import { call } from './lib/api.js';
import {
  DURATION,
  MAX_OWN_TASKS,
  RAMP,
  RUN_ID,
  SCENARIO,
  THINK_MS,
  VUS,
  WRITE_OPS,
  mixFor,
} from './lib/config.js';
import { seed } from './lib/seed.js';

const MIX = mixFor(SCENARIO);
const OPS = Object.keys(MIX);

const conflicts = new Counter('version_conflicts'); // 409: expected under contention
const boardCache = new Counter('board_cache'); // tagged by x-board-cache value (client-side view)
const writesOk = new Counter('writes_ok');
// Board latency split by what the server did: HIT (warm) vs MISS (cold: PostgreSQL + write-back).
const boardByCache = new Trend('board_ms_by_cache', true);

// Success criteria, fixed BEFORE any run: errors < 1 %, p95 < 500 ms, p99 < 1500 ms, every
// operation p95 < 1000 ms. A run that breaks them is reported as such; they are not tuned afterwards.
const thresholds = {
  http_req_failed: ['rate<0.01'],
  'http_req_duration{kind:api}': ['p(95)<500', 'p(99)<1500'],
};
for (const op of OPS) thresholds[`http_req_duration{op:${op}}`] = ['p(95)<1000'];
// Expose the client-side cache view per result (hit/miss/…) in the summary.
for (const result of ['hit', 'miss', 'bypass'])
  thresholds[`board_ms_by_cache{result:${result}}`] = ['max>=0'];
for (const result of ['hit', 'miss', 'refresh', 'none'])
  thresholds[`board_cache{result:${result}}`] = ['count>=0'];

// LADDER="10,50,100" runs one constant-VU step per level, back to back (STEP each), in one run
// with one seeded tenant; every sample is tagged level=<VUs>. Without LADDER: one ramped level.
const LADDER = (__ENV.LADDER || '')
  .split(',')
  .filter(Boolean)
  .map((v) => parseInt(v, 10));
const STEP = __ENV.STEP || '3m';
const WARMUP = __ENV.WARMUP || '';
function seconds(d) {
  const m = /^(\d+)(s|m)$/.exec(d);
  if (!m) throw new Error(`duration ${d}: use <n>s or <n>m`);
  return parseInt(m[1], 10) * (m[2] === 'm' ? 60 : 1);
}
const stepSeconds = seconds(STEP);
function scenarios() {
  if (LADDER.length === 0) {
    return {
      [SCENARIO]: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: RAMP, target: VUS },
          { duration: DURATION, target: VUS },
          { duration: '10s', target: 0 },
        ],
        gracefulRampDown: '10s',
        tags: { kind: 'api', level: String(VUS) },
      },
    };
  }
  const out = {};
  // WARMUP="1m" adds a first phase at the lowest ladder level, tagged level=warmup and kept out of
  // every per-level result: it warms connections, JIT and (when enabled) the board cache, so the
  // first measured level is steady state. Cold behaviour is in the warmup phase's own samples.
  const warmupSeconds = WARMUP ? seconds(WARMUP) : 0;
  if (warmupSeconds) {
    out.warmup = {
      executor: 'constant-vus',
      vus: Math.min(...LADDER),
      duration: WARMUP,
      gracefulStop: '5s',
      tags: { kind: 'warmup', level: 'warmup' },
    };
    thresholds['http_reqs{level:warmup}'] = ['count>=0'];
    thresholds['http_req_duration{level:warmup}'] = ['max>=0'];
    for (const result of ['hit', 'miss'])
      thresholds[`board_cache{level:warmup,result:${result}}`] = ['count>=0'];
  }
  const offset = warmupSeconds ? warmupSeconds + 5 : 0;
  LADDER.forEach((vus, i) => {
    out[`L${vus}`] = {
      executor: 'constant-vus',
      vus,
      duration: STEP,
      startTime: `${offset + i * (stepSeconds + 5)}s`,
      gracefulStop: '5s',
      tags: { kind: 'api', level: String(vus) },
    };
    thresholds[`http_req_duration{level:${vus}}`] = ['p(95)<500', 'p(99)<1500'];
    thresholds[`http_req_failed{level:${vus}}`] = ['rate<0.01'];
    thresholds[`http_reqs{level:${vus}}`] = ['count>=0'];
    thresholds[`writes_ok{level:${vus}}`] = ['count>=0'];
    thresholds[`version_conflicts{level:${vus}}`] = ['count>=0'];
    thresholds[`http_req_duration{level:${vus},op:board}`] = ['p(95)<1000'];
    thresholds[`http_req_duration{level:${vus},op:create}`] = ['p(95)<1000'];
    thresholds[`http_req_duration{level:${vus},op:move}`] = ['p(95)<1000'];
    for (const result of ['hit', 'miss'])
      thresholds[`board_cache{level:${vus},result:${result}}`] = ['count>=0'];
  });
  return out;
}

export const options = {
  scenarios: scenarios(),
  setupTimeout: '15m',
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  // Load-test users only; one run's data is namespaced by RUN_ID.
  tags: { run: RUN_ID, scenario: SCENARIO },
};

export function setup() {
  const data = seed();
  // Scenario start times are offsets from the end of setup: this marker lets the evidence tooling
  // slice per-minute CloudWatch series by ladder level (scripts/load/compare.py).
  console.log(`MEASURE_T0=${new Date().toISOString()}`);
  return data;
}

function pick() {
  let x = Math.random() * 100;
  for (const op of OPS) {
    x -= MIX[op];
    if (x <= 0) return op;
  }
  return OPS[OPS.length - 1];
}

// Per-VU state: the VU's own tasks and their last known versions.
const own = [];
const versions = {};

function remember(task) {
  if (task && task.id) versions[task.id] = task.version;
}

function refresh(user, taskId) {
  const r = call('task', 'GET', `/tasks/${taskId}`, { token: user.token });
  if (r.status === 200) remember(r.body);
  return r.status === 200;
}

function write(op, r) {
  if (r.status === 409) {
    conflicts.add(1, { op });
    return false;
  }
  const ok = check(r, { [`${op} ok`]: (x) => x.status >= 200 && x.status < 300 });
  if (ok) writesOk.add(1, { op });
  return ok;
}

export default function (data) {
  const vu = exec.vu.idInTest;
  const user = data.users[vu % data.users.length];
  const project = data.projects[vu % data.projects.length];
  let op = pick();
  if (op === 'create' && own.length >= MAX_OWN_TASKS) op = 'delete';
  if (WRITE_OPS.includes(op) && op !== 'create' && own.length === 0) op = 'create';
  // Contention only where intended: hot-project writes also hit the shared seed tasks.
  const target =
    SCENARIO === 'hot-project' && Math.random() < 0.5 && project.tasks.length
      ? project.tasks[Math.floor(Math.random() * project.tasks.length)]
      : own[Math.floor(Math.random() * own.length)];

  switch (op) {
    case 'board': {
      const r = call('board', 'GET', `/projects/${project.id}/board`, { token: user.token });
      check(r, { 'board ok': (x) => x.status === 200 });
      const result = (r.res.headers['X-Board-Cache'] || 'none').toLowerCase();
      boardCache.add(1, { result });
      if (r.status === 200) boardByCache.add(r.res.timings.duration, { result });
      break;
    }
    case 'task': {
      const id = target || project.tasks[0];
      check(call('task', 'GET', `/tasks/${id}`, { token: user.token }), {
        'task ok': (x) => x.status === 200,
      });
      break;
    }
    case 'activity':
      check(
        call('activity', 'GET', `/projects/${project.id}/activity?limit=25`, { token: user.token }),
        {
          'activity ok': (x) => x.status === 200,
        },
      );
      break;
    case 'projects': {
      const ws = call('workspaces', 'GET', '/workspaces', { token: user.token });
      const first = ws.body && ws.body[0];
      if (first) {
        check(call('projects', 'GET', `/workspaces/${first.id}/projects`, { token: user.token }), {
          'projects ok': (x) => x.status === 200,
        });
      }
      break;
    }
    case 'workspaces':
      check(call('workspaces', 'GET', '/workspaces', { token: user.token }), {
        'workspaces ok': (x) => x.status === 200,
      });
      break;
    case 'create': {
      const r = call('create', 'POST', '/tasks', {
        token: user.token,
        body: {
          projectId: project.id,
          columnId: project.columns[Math.floor(Math.random() * project.columns.length)],
          title: `Load task ${vu}`,
        },
      });
      if (write('create', r)) {
        own.push(r.body.id);
        remember(r.body);
      }
      break;
    }
    case 'update': {
      if (versions[target] === undefined && !refresh(user, target)) break;
      const r = call('update', 'PATCH', `/tasks/${target}`, {
        token: user.token,
        body: { expectedVersion: versions[target], title: `Edited ${Date.now() % 100000}` },
      });
      if (write('update', r)) remember(r.body);
      else if (r.status === 409) refresh(user, target);
      break;
    }
    case 'move': {
      if (versions[target] === undefined && !refresh(user, target)) break;
      const r = call('move', 'POST', `/tasks/${target}/move`, {
        token: user.token,
        body: {
          expectedVersion: versions[target],
          columnId: project.columns[Math.floor(Math.random() * project.columns.length)],
          afterTaskId: null,
        },
      });
      if (write('move', r)) remember(r.body);
      else if (r.status === 409) refresh(user, target);
      break;
    }
    case 'assign': {
      const r = call('assign', 'POST', `/tasks/${target}/assignees`, {
        token: user.token,
        body: { userId: user.id },
      });
      if (write('assign', r)) remember(r.body);
      break;
    }
    case 'unassign': {
      const r = call('unassign', 'DELETE', `/tasks/${target}/assignees/${user.id}`, {
        token: user.token,
      });
      if (write('unassign', r) && r.body) remember(r.body);
      break;
    }
    case 'comment':
      write(
        'comment',
        call('comment', 'POST', `/tasks/${target}/comments`, {
          token: user.token,
          body: { body: 'Load comment' },
        }),
      );
      break;
    case 'delete': {
      const id = own.shift();
      if (versions[id] === undefined && !refresh(user, id)) break;
      const r = call('delete', 'DELETE', `/tasks/${id}?expectedVersion=${versions[id]}`, {
        token: user.token,
      });
      if (!write('delete', r)) own.push(id);
      else delete versions[id];
      break;
    }
  }
  if (THINK_MS > 0) sleep((Math.random() * 2 * THINK_MS) / 1000);
}

export { handleSummary } from './lib/summary.js';
