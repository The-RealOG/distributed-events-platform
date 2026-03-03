import { LocalJwtAuthProvider } from '@dpp/auth';
import type { Database, DatabaseHandle } from '@dpp/database';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type AppState } from './app.js';
import { loadProjectServiceConfig } from './config.js';

const config = loadProjectServiceConfig({
  PORT: '3001',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
  JWT_SECRET: 'x'.repeat(32),
});
const authProvider = new LocalJwtAuthProvider({
  secret: config.JWT_SECRET,
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  ttlSeconds: 60,
});

// These tests never reach a query; the database is only probed by /ready.
function fakeDatabase(ping: () => Promise<void>): DatabaseHandle {
  return { db: {} as Database, pool: {} as pg.Pool, ping, close: async () => {} };
}

describe('project-service HTTP shell', () => {
  let app: ReturnType<typeof buildApp> | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const build = (state: AppState, ping: () => Promise<void> = async () => {}) =>
    (app = buildApp({ config, database: fakeDatabase(ping), authProvider }, state));

  it('reports liveness even while not ready', async () => {
    const res = await build({ ready: false }).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('is ready only when started and the database answers', async () => {
    const state: AppState = { ready: false };
    let dbUp = true;
    build(state, async () => {
      if (!dbUp) throw new Error('down');
    });
    const ready = async () => (await app!.inject({ method: 'GET', url: '/ready' })).statusCode;

    expect(await ready()).toBe(503);
    state.ready = true;
    expect(await ready()).toBe(200);
    dbUp = false;
    expect(await ready()).toBe(503);
  });

  it('does not expose dev login unless enabled', async () => {
    const res = await build({ ready: true }).inject({
      method: 'POST',
      url: '/auth/dev-login',
      payload: { email: 'a@example.com', displayName: 'A' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns the public error shape with request and correlation IDs', async () => {
    const res = await build({ ready: true }).inject({
      method: 'GET',
      url: '/workspaces',
      headers: { 'x-correlation-id': 'corr-1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-correlation-id']).toBe('corr-1');
    expect(res.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('distinguishes expired tokens', async () => {
    const expired = new LocalJwtAuthProvider({
      secret: config.JWT_SECRET,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      ttlSeconds: -10,
    });
    const token = await expired.issue({
      userId: '6f1c1f0e-2a53-4d7e-9a7b-0f4b1a1d2c3e',
      email: 'a@example.com',
    });
    const res = await build({ ready: true }).inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 404 in the same shape for unknown routes and 400 for malformed JSON', async () => {
    const a = build({ ready: true });
    const missing = await a.inject({ method: 'GET', url: '/nope' });
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');

    const token = await authProvider.issue({
      userId: '6f1c1f0e-2a53-4d7e-9a7b-0f4b1a1d2c3e',
      email: 'a@example.com',
    });
    const malformed = await a.inject({
      method: 'POST',
      url: '/workspaces',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toMatch(/stack|SyntaxError/);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await build({ ready: true }).inject({
      method: 'POST',
      url: '/auth/dev-login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.statusCode).toBe(413);
  });
});
