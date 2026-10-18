import http from 'k6/http';
import { sleep } from 'k6';
import {
  API,
  PROJECT_COUNT,
  RUN_ID,
  SEED_TASKS,
  TEST_USER_COUNT,
  WORKSPACE_COUNT,
} from './config.js';
import { call, login } from './api.js';

/**
 * Creates the test tenant for one run: TEST_USER_COUNT users, WORKSPACE_COUNT workspaces (every
 * user a MEMBER of every workspace), PROJECT_COUNT projects spread over them, SEED_TASKS tasks per
 * project. Everything is namespaced by RUN_ID so runs never share data.
 */
/**
 * http.batch, resending any request the gateway rate-limited (429). The seed sends ~1,450
 * requests with the owner's token, more than one token's per-minute budget (RATE_LIMIT_MAX). A
 * 429 is decided before the request reaches the Project Service, so resending it is safe.
 */
function batchRespectingRateLimit(requests) {
  const responses = new Array(requests.length);
  let pending = requests.map((_, i) => i);
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt === 30) throw new Error('seed: still rate-limited after 30 attempts');
    const results = http.batch(pending.map((i) => requests[i]));
    const limited = [];
    let waitSeconds = 1;
    results.forEach((r, k) => {
      if (r.status === 429) {
        limited.push(pending[k]);
        waitSeconds = Math.max(waitSeconds, parseInt(r.headers['Retry-After'] || '5', 10));
      } else {
        responses[pending[k]] = r;
      }
    });
    pending = limited;
    if (pending.length > 0) sleep(waitSeconds);
  }
  return responses;
}

/** call() for the seed's single requests, with the same 429 handling as the batches. */
function seedCall(method, path, options) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = call('seed', method, path, options);
    if (r.status !== 429) return r;
    sleep(parseInt(r.res.headers['Retry-After'] || '5', 10));
  }
  throw new Error(`seed: ${method} ${path} still rate-limited after 30 attempts`);
}

export function seed() {
  const owner = login(`owner-${RUN_ID}`);
  const users = [];
  for (let i = 0; i < TEST_USER_COUNT; i++) users.push(login(`user-${RUN_ID}-${i}`));

  const workspaces = [];
  for (let w = 0; w < WORKSPACE_COUNT; w++) {
    const ws = seedCall('POST', '/workspaces', {
      token: owner.token,
      body: { name: `Load ${RUN_ID} ${w}` },
    });
    if (ws.status !== 201) throw new Error(`workspace: HTTP ${ws.status}`);
    const adds = users.map((u) => [
      'POST',
      `${API}/workspaces/${ws.body.id}/members`,
      JSON.stringify({ email: u.email, role: 'MEMBER' }),
      {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
        tags: { op: 'seed' },
      },
    ]);
    for (let i = 0; i < adds.length; i += 20) {
      for (const r of batchRespectingRateLimit(adds.slice(i, i + 20))) {
        if (r.status >= 300) throw new Error(`member: HTTP ${r.status}`);
      }
    }
    workspaces.push(ws.body.id);
  }

  const projects = [];
  for (let p = 0; p < PROJECT_COUNT; p++) {
    const pr = seedCall('POST', '/projects', {
      token: owner.token,
      body: { workspaceId: workspaces[p % workspaces.length], name: `P${p}` },
    });
    if (pr.status !== 201) throw new Error(`project: HTTP ${pr.status}`);
    const board = seedCall('GET', `/projects/${pr.body.id}/board`, { token: owner.token });
    const columns = board.body.columns.map((c) => c.id);
    const creates = [];
    for (let t = 0; t < SEED_TASKS; t++) {
      creates.push([
        'POST',
        `${API}/tasks`,
        JSON.stringify({
          projectId: pr.body.id,
          columnId: columns[t % columns.length],
          title: `Seed ${t}`,
        }),
        {
          headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` },
          tags: { op: 'seed' },
        },
      ]);
    }
    const tasks = [];
    for (let i = 0; i < creates.length; i += 20) {
      for (const r of batchRespectingRateLimit(creates.slice(i, i + 20))) {
        if (r.status !== 201) throw new Error(`seed task: HTTP ${r.status}`);
        tasks.push(r.json().id);
      }
    }
    projects.push({ id: pr.body.id, columns, tasks });
  }
  return { users, projects };
}
