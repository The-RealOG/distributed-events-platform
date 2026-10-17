import { randomUUID } from 'node:crypto';
import { LocalJwtAuthProvider } from '@dpp/auth';
import { createDatabase, type DatabaseHandle } from '@dpp/database';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp, type AppDependencies } from '../src/app.js';
import { loadProjectServiceConfig } from '../src/config.js';

export const JWT_SECRET = 'integration-test-secret-integration-test';

export interface User {
  token: string;
  id: string;
  email: string;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface Harness {
  app: FastifyInstance;
  database: DatabaseHandle;
  login(name?: string): Promise<User>;
  call<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    options?: { as?: User; body?: unknown; headers?: Record<string, string> },
  ): Promise<ApiResponse<T>>;
  close(): Promise<void>;
}

/** Builds the real application wired to the Testcontainers PostgreSQL. */
export async function createHarness(
  databaseUrl = inject('databaseUrl'),
  extra: Partial<AppDependencies> = {},
): Promise<Harness> {
  const config = loadProjectServiceConfig({
    PORT: '3001',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_SECRET,
    AUTH_DEV_LOGIN_ENABLED: 'true',
    DEPLOYMENT_ENVIRONMENT: 'test',
  });
  const database = createDatabase({
    connectionString: databaseUrl,
    applicationName: 'integration-test',
    maxConnections: 20,
    connectionTimeoutMs: 2_000,
  });
  const authProvider = new LocalJwtAuthProvider({
    secret: JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    ttlSeconds: 300,
  });
  const app = buildApp(
    { config, database, authProvider, devTokenIssuer: authProvider, ...extra },
    { ready: true },
  );
  await app.ready();

  const call: Harness['call'] = async (method, url, options = {}) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.as) headers['authorization'] = `Bearer ${options.as.token}`;
    const res = await app.inject({
      method,
      url,
      headers,
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
    return {
      status: res.statusCode,
      body: res.body ? res.json() : (undefined as never),
    };
  };

  return {
    app,
    database,
    call,
    async login(name = 'user') {
      const email = `${name}-${randomUUID()}@example.com`;
      const res = await call('POST', '/auth/dev-login', { body: { email, displayName: name } });
      if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
      return { token: res.body.token, id: res.body.user.id, email };
    },
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export interface ProjectFixture {
  owner: User;
  workspaceId: string;
  projectId: string;
  columns: { id: string; name: string }[];
}

/** Owner + workspace + project with its default board. */
export async function createProjectFixture(h: Harness): Promise<ProjectFixture> {
  const owner = await h.login('owner');
  const ws = await h.call('POST', '/workspaces', { as: owner, body: { name: 'Acme' } });
  const project = await h.call('POST', '/projects', {
    as: owner,
    body: { workspaceId: ws.body.id, name: 'Launch' },
  });
  const board = await h.call('GET', `/projects/${project.body.id}/board`, { as: owner });
  return {
    owner,
    workspaceId: ws.body.id,
    projectId: project.body.id,
    columns: board.body.columns.map((c: { id: string; name: string }) => ({
      id: c.id,
      name: c.name,
    })),
  };
}

export async function addMember(
  h: Harness,
  fixture: ProjectFixture,
  role: 'ADMIN' | 'MEMBER' = 'MEMBER',
): Promise<User> {
  const user = await h.login(role.toLowerCase());
  const res = await h.call('POST', `/workspaces/${fixture.workspaceId}/members`, {
    as: fixture.owner,
    body: { email: user.email, role },
  });
  if (res.status !== 201) throw new Error(`addMember failed: ${res.status}`);
  return user;
}

export async function createTask(
  h: Harness,
  fixture: ProjectFixture,
  title: string,
  columnIndex = 0,
  as: User = fixture.owner,
) {
  const res = await h.call('POST', '/tasks', {
    as,
    body: { projectId: fixture.projectId, columnId: fixture.columns[columnIndex]!.id, title },
  });
  if (res.status !== 201)
    throw new Error(`createTask failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; version: number; columnId: string; position: string };
}
