import { runMigrations } from '@dpp/database';
import { startPostgres, type StartedPostgres } from '@dpp/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startService, type LogLine, type ServiceProcess } from './processes.js';

/**
 * Browser-facing gateway → Project Service → PostgreSQL, as three real processes/containers.
 * Assertions read the services' actual stdout logs.
 */
let postgres: StartedPostgres;
let projectService: ServiceProcess;
let gateway: ServiceProcess;

beforeAll(async () => {
  postgres = await startPostgres();
  await runMigrations(postgres.url);
  projectService = await startService('project-service', {
    DATABASE_URL: postgres.url,
    JWT_SECRET: 'system-test-secret-system-test-secret',
    AUTH_DEV_LOGIN_ENABLED: 'true',
    DEPLOYMENT_ENVIRONMENT: 'test',
    SHUTDOWN_TIMEOUT_MS: '8000',
  });
  gateway = await startService('api-gateway', {
    PROJECT_SERVICE_URL: projectService.url,
    CORS_ORIGINS: 'http://localhost:8080',
    UPSTREAM_CONNECT_TIMEOUT_MS: '1000',
    UPSTREAM_REQUEST_TIMEOUT_MS: '5000',
  });
});

afterAll(async () => {
  await gateway?.stop();
  await projectService?.stop();
  await postgres?.stop();
});

const withCorrelation = (logs: LogLine[], id: string) =>
  logs.filter((l) => l['correlationId'] === id && l['message'] === 'request completed');

async function login(correlationId: string): Promise<string> {
  const res = await fetch(`${gateway.url}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ email: `chain-${Date.now()}@example.com`, displayName: 'Chain' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe('gateway → project-service → PostgreSQL', () => {
  it('correlates one request across both services while keeping request IDs per hop', async () => {
    const token = await login('chain-login');
    const correlationId = `chain-${crypto.randomUUID()}`;

    const res = await fetch(`${gateway.url}/api/workspaces`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify({ name: 'Correlated' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-correlation-id')).toBe(correlationId);
    await new Promise((r) => setTimeout(r, 200)); // let both processes flush logs

    const [gatewayLine] = withCorrelation(gateway.logs, correlationId);
    const [serviceLine] = withCorrelation(projectService.logs, correlationId);
    expect(gatewayLine).toMatchObject({ service: 'api-gateway', route: '/api/*', statusCode: 201 });
    expect(serviceLine).toMatchObject({
      service: 'project-service',
      route: '/workspaces',
      statusCode: 201,
    });
    expect(serviceLine!['userId']).toEqual(expect.any(String));
    // Request IDs identify each hop; the gateway's is the one returned to the client.
    expect(gatewayLine!['requestId']).not.toBe(serviceLine!['requestId']);
    expect(res.headers.get('x-request-id')).toBe(gatewayLine!['requestId']);

    // Credentials never reach logs in either service.
    for (const svc of [gateway, projectService]) {
      expect(svc.rawOutput()).not.toContain(token);
      expect(svc.rawOutput()).not.toMatch(/Bearer\s/);
    }
  });

  it('passes a JSON body through the gateway intact', async () => {
    const token = await login('chain-body');
    const name = 'Ünïcode & "quotes" — 1.50';
    const res = await fetch(`${gateway.url}/api/workspaces`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { name: string }).name).toBe(name);
  });

  it('translates a PostgreSQL outage into a safe 503 through the gateway', async () => {
    const token = await login('chain-before-db-outage');
    await postgres.stop();

    const started = performance.now();
    const res = await fetch(`${gateway.url}/api/workspaces`, {
      headers: { authorization: `Bearer ${token}`, 'x-correlation-id': 'chain-db-down' },
    });
    const elapsed = performance.now() - started;
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(503);
    expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|postgres|5432|stack/i);
    expect(elapsed).toBeLessThan(8_000);
    // Gateway stays ready: it is healthy and answering; the dependency is what's down.
    expect((await fetch(`${gateway.url}/ready`)).status).toBe(200);
    expect((await fetch(`${projectService.url}/ready`)).status).toBe(503);
  });

  // Covers idle keep-alive connections from the gateway's pool. The harder case (a request in
  // flight at SIGTERM on a keep-alive connection) is timing-dependent here and is proven
  // deterministically in packages/runtime/src/draining.test.ts.
  it('shuts the project service down gracefully (exit 0) while the gateway holds idle keep-alive connections', async () => {
    const { code, ms } = await projectService.stop();
    expect(code).toBe(0);
    expect(ms).toBeLessThan(5_000);
  });

  it('answers quickly with a safe 503 when the project service is gone', async () => {
    const started = performance.now();
    const res = await fetch(`${gateway.url}/api/workspaces`, {
      headers: { 'x-correlation-id': 'chain-upstream-down' },
    });
    const elapsed = performance.now() - started;
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE', details: { reason: 'upstream_unreachable' } },
    });
    expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|socket/i);
    expect(elapsed).toBeLessThan(2_000);

    await new Promise((r) => setTimeout(r, 100));
    const failure = gateway.logs.find(
      (l) =>
        l['correlationId'] === 'chain-upstream-down' && l['message'] === 'upstream request failed',
    );
    expect(failure).toMatchObject({ upstream: 'project-service', reason: 'upstream_unreachable' });
  });
});
