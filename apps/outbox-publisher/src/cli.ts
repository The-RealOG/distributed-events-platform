import { parseArgs } from 'node:util';
import { loadConfig } from '@dpp/config';
import { createDatabase, outboxRecent, outboxStatus } from '@dpp/database';
import { z } from 'zod';

/**
 * Outbox diagnostics for developers and operators (read-only), plus a backlog generator that
 * goes through the real API, never raw SQL.
 *
 *   status                          pending count, oldest pending age, failing rows
 *   pending  [--limit N]            unpublished events in publication order
 *   failing  [--limit N]            unpublished events with failed attempts (last_error, retry time)
 *   recent   [--limit N]            recently published events with publish latency
 *   backlog  [--tasks N]            create a project with N tasks via the gateway (N+ events)
 */
const config = loadConfig(
  z.object({
    DATABASE_URL: z.url().default('postgres://dpp:dpp_local_only@localhost:5432/dpp'),
    API_URL: z.url().default('http://localhost:3000/api'),
  }),
);
const out = (value: unknown) =>
  process.stdout.write(
    `${JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}\n`,
  );

async function withDb<T>(fn: (db: ReturnType<typeof createDatabase>) => Promise<T>): Promise<T> {
  const database = createDatabase({
    connectionString: config.DATABASE_URL,
    applicationName: 'outbox-cli',
    maxConnections: 1,
  });
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

async function api<T>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${config.API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': `outbox-cli-${Date.now()}`,
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body)}`);
  }
  return body as T;
}

const [command, ...args] = process.argv.slice(2);
const { values } = parseArgs({
  args,
  options: { limit: { type: 'string' }, tasks: { type: 'string' } },
});
const limit = Number(values.limit ?? 20);

switch (command) {
  case 'status':
    out(await withDb((d) => outboxStatus(d.db)));
    break;
  case 'pending':
  case 'failing':
  case 'recent': {
    const kind = command === 'recent' ? 'published' : command;
    for (const row of await withDb((d) => outboxRecent(d.db, { kind, limit }))) out(row);
    break;
  }
  case 'backlog': {
    const n = Number(values.tasks ?? 10);
    const { token } = await api<{ token: string }>('/auth/dev-login', {
      method: 'POST',
      body: { email: `backlog-${Date.now()}@example.com`, displayName: 'Backlog' },
    });
    const ws = await api<{ id: string }>('/workspaces', {
      method: 'POST',
      token,
      body: { name: 'Outbox backlog' },
    });
    const project = await api<{ id: string }>('/projects', {
      method: 'POST',
      token,
      body: { workspaceId: ws.id, name: 'Backlog' },
    });
    const board = await api<{ columns: { id: string }[] }>(`/projects/${project.id}/board`, {
      token,
    });
    const columnId = board.columns[0]!.id;
    for (let i = 0; i < n; i++) {
      await api('/tasks', {
        method: 'POST',
        token,
        body: { projectId: project.id, columnId, title: `Backlog ${i + 1}` },
      });
    }
    out({ message: 'created backlog through the API', projectId: project.id, tasks: n, events: n });
    break;
  }
  default:
    process.stderr.write(
      'usage: outbox <status|pending|failing|recent|backlog> [--limit N] [--tasks N]\n',
    );
    process.exit(2);
}
