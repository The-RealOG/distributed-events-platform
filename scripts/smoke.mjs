#!/usr/bin/env node
// End-to-end smoke test against a running stack: node scripts/smoke.mjs [baseUrl]
// Exercises the core transactional path over real HTTP and exits non-zero on any mismatch.
import { randomUUID } from 'node:crypto';

const base = process.argv[2] ?? 'http://localhost:3000/api';
const correlationId = `smoke-${randomUUID()}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'x-correlation-id': correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

function expectStatus(label, res, status) {
  if (res.status !== status) {
    process.stderr.write(
      `FAIL ${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`ok   ${label} (${status})\n`);
  return res.body;
}

const login = expectStatus(
  'dev login',
  await call('POST', '/auth/dev-login', {
    body: { email: `smoke-${randomUUID()}@example.com`, displayName: 'Smoke' },
  }),
  200,
);
const token = login.token;

const ws = expectStatus(
  'create workspace',
  await call('POST', '/workspaces', { token, body: { name: 'Smoke' } }),
  201,
);
const project = expectStatus(
  'create project',
  await call('POST', '/projects', { token, body: { workspaceId: ws.id, name: 'Smoke project' } }),
  201,
);
const board = expectStatus(
  'read board',
  await call('GET', `/projects/${project.id}/board`, { token }),
  200,
);
const [todo, doing] = board.columns;

const task = expectStatus(
  'create task',
  await call('POST', '/tasks', {
    token,
    body: { projectId: project.id, columnId: todo.id, title: 'Smoke task' },
  }),
  201,
);
expectStatus(
  'update task at v1',
  await call('PATCH', `/tasks/${task.id}`, {
    token,
    body: { expectedVersion: 1, title: 'Renamed' },
  }),
  200,
);
expectStatus(
  'stale update rejected',
  await call('PATCH', `/tasks/${task.id}`, { token, body: { expectedVersion: 1, title: 'Stale' } }),
  409,
);
expectStatus(
  'move task at v2',
  await call('POST', `/tasks/${task.id}/move`, {
    token,
    body: { expectedVersion: 2, columnId: doing.id, afterTaskId: null },
  }),
  200,
);
expectStatus(
  'comment',
  await call('POST', `/tasks/${task.id}/comments`, { token, body: { body: 'hello' } }),
  201,
);

const after = expectStatus(
  'read board again',
  await call('GET', `/projects/${project.id}/board`, { token }),
  200,
);
if (after.columns[1].tasks[0]?.title !== 'Renamed') {
  process.stderr.write('FAIL board does not reflect the move and rename\n');
  process.exit(1);
}
process.stdout.write(`\nall checks passed; correlationId=${correlationId}\n`);
