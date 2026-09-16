import http from 'k6/http';
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
export function seed() {
  const owner = login(`owner-${RUN_ID}`);
  const users = [];
  for (let i = 0; i < TEST_USER_COUNT; i++) users.push(login(`user-${RUN_ID}-${i}`));

  const workspaces = [];
  for (let w = 0; w < WORKSPACE_COUNT; w++) {
    const ws = call('seed', 'POST', '/workspaces', {
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
      for (const r of http.batch(adds.slice(i, i + 20))) {
        if (r.status >= 300) throw new Error(`member: HTTP ${r.status}`);
      }
    }
    workspaces.push(ws.body.id);
  }

  const projects = [];
  for (let p = 0; p < PROJECT_COUNT; p++) {
    const pr = call('seed', 'POST', '/projects', {
      token: owner.token,
      body: { workspaceId: workspaces[p % workspaces.length], name: `P${p}` },
    });
    if (pr.status !== 201) throw new Error(`project: HTTP ${pr.status}`);
    const board = call('seed', 'GET', `/projects/${pr.body.id}/board`, { token: owner.token });
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
      for (const r of http.batch(creates.slice(i, i + 20))) {
        if (r.status !== 201) throw new Error(`seed task: HTTP ${r.status}`);
        tasks.push(r.json().id);
      }
    }
    projects.push({ id: pr.body.id, columns, tasks });
  }
  return { users, projects };
}
