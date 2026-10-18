import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadGatewayConfig } from '../src/config.js';

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A real upstream HTTP server that records what the gateway sent it. */
async function startUpstream(
  handler?: (req: Recorded) => { status: number; body: unknown; delayMs?: number },
) {
  const received: Recorded[] = [];
  const upstream = Fastify();
  upstream.removeAllContentTypeParsers();
  upstream.addContentTypeParser('*', { parseAs: 'string' }, (_r, body, done) => done(null, body));
  upstream.all('/*', async (request, reply) => {
    const rec: Recorded = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: typeof request.body === 'string' ? request.body : '',
    };
    received.push(rec);
    const out = handler?.(rec) ?? { status: 200, body: { ok: true, path: request.url } };
    if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
    return reply
      .code(out.status)
      .header('x-request-id', 'upstream-request-id')
      .header('x-correlation-id', rec.headers['x-correlation-id'])
      .send(out.body);
  });
  const address = await upstream.listen({ port: 0, host: '127.0.0.1' });
  return { url: address, received, close: () => upstream.close() };
}

async function unusedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function gatewayFor(upstreamUrl: string, overrides: Record<string, string> = {}) {
  const config = loadGatewayConfig({
    PORT: '3000',
    LOG_LEVEL: 'silent',
    PROJECT_SERVICE_URL: upstreamUrl,
    CORS_ORIGINS: 'http://localhost:8080',
    UPSTREAM_CONNECT_TIMEOUT_MS: '500',
    UPSTREAM_REQUEST_TIMEOUT_MS: '1000',
    ...overrides,
  });
  const state = { ready: true };
  const app: FastifyInstance = await buildApp(config, state);
  closers.push(() => app.close());
  return { app, state };
}

async function withUpstream(handler?: Parameters<typeof startUpstream>[0]) {
  const upstream = await startUpstream(handler);
  closers.push(upstream.close);
  return upstream;
}

describe('routing', () => {
  it('forwards allowlisted /api prefixes with the prefix stripped and the query kept', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);

    for (const path of [
      '/me',
      '/workspaces',
      '/projects/abc/board',
      '/tasks/1?expectedVersion=3',
      '/auth/dev-login',
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api${path}` });
      expect(res.statusCode, path).toBe(200);
    }
    expect(upstream.received.map((r) => r.url)).toEqual([
      '/me',
      '/workspaces',
      '/projects/abc/board',
      '/tasks/1?expectedVersion=3',
      '/auth/dev-login',
    ]);
  });

  it('does not expose upstream internals or unknown paths', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);

    for (const path of [
      '/api/health',
      '/api/ready',
      '/api/admin',
      '/api/meh',
      '/workspaces',
      '/api/',
    ]) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode, path).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(upstream.received).toHaveLength(0);
  });

  it('passes upstream statuses and error bodies through unchanged', async () => {
    const conflict = {
      error: {
        code: 'VERSION_CONFLICT',
        message: 'changed',
        details: { currentVersion: 5 },
        requestId: 'x',
      },
    };
    const upstream = await withUpstream(() => ({ status: 409, body: conflict }));
    const { app } = await gatewayFor(upstream.url);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/1',
      payload: { expectedVersion: 4 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflict);
  });

  it('forwards JSON bodies byte-for-byte without parsing them', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);
    const raw = '{"title":"héllo","n":1.50}';

    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(upstream.received[0]!.body).toBe(raw);
    expect(upstream.received[0]!.method).toBe('POST');
  });
});

describe('headers and identifiers', () => {
  it('forwards auth, generates a correlation ID, and drops non-allowlisted headers', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        authorization: 'Bearer token-value',
        cookie: 'session=secret',
        'x-forwarded-for': '6.6.6.6',
        'x-internal-admin': 'true',
      },
    });

    const sent = upstream.received[0]!.headers;
    expect(sent['authorization']).toBe('Bearer token-value');
    expect(sent['cookie']).toBeUndefined();
    expect(sent['x-internal-admin']).toBeUndefined();
    expect(sent['x-forwarded-for']).not.toContain('6.6.6.6');
    // Request IDs are per hop: the upstream must mint its own.
    expect(sent['x-request-id']).toBeUndefined();

    const correlationId = res.headers['x-correlation-id'];
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent['x-correlation-id']).toBe(correlationId);
    // The response carries the gateway's own request ID, not the upstream's.
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).not.toBe('upstream-request-id');
  });

  it('forwards Cache-Control (read-your-writes across the board cache)', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);
    await app.inject({
      method: 'GET',
      url: '/api/projects/abc/board',
      headers: { 'cache-control': 'no-cache' },
    });
    expect(upstream.received[0]!.headers['cache-control']).toBe('no-cache');
  });

  it('never forwards a client-supplied request ID upstream', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { 'x-request-id': 'client-request-1' },
    });
    expect(res.headers['x-request-id']).toBe('client-request-1');
    expect(upstream.received[0]!.headers['x-request-id']).toBeUndefined();
  });

  it('propagates a valid inbound correlation ID and replaces a malformed one', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);

    await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-correlation-id': 'op-42' } });
    await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { 'x-correlation-id': 'x'.repeat(500) },
    });
    expect(upstream.received[0]!.headers['x-correlation-id']).toBe('op-42');
    expect(upstream.received[1]!.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('upstream failures', () => {
  it('returns a safe 503 quickly when the upstream is unreachable', async () => {
    const port = await unusedPort();
    const { app } = await gatewayFor(`http://127.0.0.1:${port}`);

    const started = performance.now();
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    const elapsed = performance.now() - started;

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE', details: { reason: 'upstream_unreachable' } },
    });
    expect(res.body).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|socket|stack/i);
    // Refused connections fail immediately; the bound only has to beat the 500 ms connect
    // timeout by a margin that survives a loaded machine.
    expect(elapsed).toBeLessThan(3_000);
  });

  it('bounds the wait for a slow upstream and says the outcome is unknown', async () => {
    // The upstream would take 6 s; the gateway gives up at 300 ms. Anything clearly below 6 s
    // proves the timeout, without depending on how fast this machine is.
    const upstream = await withUpstream(() => ({ status: 200, body: {}, delayMs: 6_000 }));
    const { app } = await gatewayFor(upstream.url, { UPSTREAM_REQUEST_TIMEOUT_MS: '300' });

    const started = performance.now();
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/1', payload: { a: 1 } });
    const elapsed = performance.now() - started;

    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({
      error: { code: 'OUTCOME_UNKNOWN', details: { reason: 'upstream_timeout' } },
    });
    expect(res.json().error.message).toMatch(/may or may not have been applied/);
    expect(elapsed).toBeLessThan(4_000);
  });

  it('answers a timed-out read with 503: nothing can have changed, so retrying is safe', async () => {
    const upstream = await withUpstream(() => ({ status: 200, body: {}, delayMs: 6_000 }));
    const { app } = await gatewayFor(upstream.url, { UPSTREAM_REQUEST_TIMEOUT_MS: '300' });

    const res = await app.inject({ method: 'GET', url: '/api/tasks/1' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE', details: { reason: 'upstream_timeout' } },
    });
  });

  it('answers a mutation whose connection dropped after sending with 504 OUTCOME_UNKNOWN', async () => {
    // The upstream receives the request and then drops the connection: it may have committed.
    const dropping = createHttpServer((req) => req.socket.destroy());
    await new Promise<void>((resolve) => dropping.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise((resolve) => dropping.close(resolve)));
    const { port } = dropping.address() as { port: number };
    const { app } = await gatewayFor(`http://127.0.0.1:${port}`);

    const mutation = await app.inject({ method: 'POST', url: '/api/tasks', payload: { t: 1 } });
    expect(mutation.statusCode).toBe(504);
    expect(mutation.json()).toMatchObject({
      error: { code: 'OUTCOME_UNKNOWN', details: { reason: 'upstream_connection_lost' } },
    });

    const read = await app.inject({ method: 'GET', url: '/api/tasks/1' });
    expect(read.statusCode).toBe(503);
    expect(read.json()).toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE', details: { reason: 'upstream_connection_lost' } },
    });
  });

  it('answers a mutation that was never sent (connection refused) with 503: retrying is safe', async () => {
    const port = await unusedPort();
    const { app } = await gatewayFor(`http://127.0.0.1:${port}`);

    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { t: 1 } });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE', details: { reason: 'upstream_unreachable' } },
    });
  });

  it('never retries: one upstream call per request for GET 503s and timed-out mutations', async () => {
    const unavailable = await withUpstream(() => ({
      status: 503,
      body: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'db down', requestId: 'u' } },
    }));
    const a = await gatewayFor(unavailable.url);
    const getRes = await a.app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(getRes.statusCode).toBe(503);
    await new Promise((r) => setTimeout(r, 300)); // leave room for any delayed retry
    expect(unavailable.received).toHaveLength(1);

    const slow = await withUpstream(() => ({ status: 200, body: {}, delayMs: 800 }));
    const b = await gatewayFor(slow.url, { UPSTREAM_REQUEST_TIMEOUT_MS: '200' });
    await b.app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 't' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(slow.received).toHaveLength(1);
  });
});

describe('browser boundary', () => {
  it('rejects oversized bodies before contacting the upstream', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url, { BODY_LIMIT_BYTES: '1024' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'x'.repeat(2048) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(upstream.received).toHaveLength(0);
  });

  it('limits each user separately and answers 429 RATE_LIMITED with Retry-After', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url, { RATE_LIMIT_MAX: '2' });
    const asUser = (token: string) =>
      app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });

    const statuses = [(await asUser('alice')).statusCode, (await asUser('alice')).statusCode];
    const limited = await asUser('alice');
    const otherUser = await asUser('bob');

    expect(statuses).toEqual([200, 200]);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(otherUser.statusCode).toBe(200);
    // The limited request never reached the project service.
    expect(upstream.received).toHaveLength(3);
  });

  it('does not count probes, preflights or the WebSocket path against the limit', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url, { RATE_LIMIT_MAX: '1' });

    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/tasks',
        headers: { origin: 'http://localhost:8080', 'access-control-request-method': 'POST' },
      });
      expect(preflight.statusCode).toBe(204);
      const realtime = await app.inject({ method: 'GET', url: '/api/realtime' });
      expect(realtime.statusCode).not.toBe(429);
    }
  });

  it('lets the browser send the headers the web client uses (preflight)', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);

    const preflight = (method: string, requestHeaders: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/tasks',
        headers: {
          origin: 'http://localhost:8080',
          'access-control-request-method': method,
          'access-control-request-headers': requestHeaders,
        },
      });

    // Read-your-writes GETs carry cache-control; retry-safe creates carry idempotency-key.
    const read = await preflight('GET', 'authorization,cache-control,x-correlation-id');
    const create = await preflight('POST', 'authorization,content-type,idempotency-key');
    expect(read.headers['access-control-allow-headers']).toContain('cache-control');
    expect(create.headers['access-control-allow-headers']).toContain('idempotency-key');
  });

  it('forwards the Idempotency-Key header to the project service', async () => {
    const upstream = await withUpstream(() => ({ status: 201, body: {} }));
    const { app } = await gatewayFor(upstream.url);

    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k-123' },
      payload: '{}',
    });

    expect(upstream.received[0]!.headers['idempotency-key']).toBe('k-123');
  });

  it('allows CORS only for configured origins and exposes tracing headers', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/tasks/1',
      headers: {
        origin: 'http://localhost:8080',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type,x-correlation-id',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization');

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { origin: 'http://localhost:8080' },
    });
    expect(allowed.headers['access-control-expose-headers']).toContain('x-correlation-id');

    const evil = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers', async () => {
    const upstream = await withUpstream();
    const { app } = await gatewayFor(upstream.url);
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('probes and shutdown', () => {
  it('is ready independently of the upstream, and not ready while draining', async () => {
    const port = await unusedPort();
    const { app, state } = await gatewayFor(`http://127.0.0.1:${port}`);
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    state.ready = false;
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('lets an in-flight proxied request finish when closing', async () => {
    const upstream = await withUpstream(() => ({
      status: 200,
      body: { done: true },
      delayMs: 300,
    }));
    const config = loadGatewayConfig({
      PORT: '3000',
      LOG_LEVEL: 'silent',
      PROJECT_SERVICE_URL: upstream.url,
    });
    const app = await buildApp(config, { ready: true });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const inFlight = fetch(`${address}/api/me`);
    // Close only once the request is really in flight (reached the upstream). A fixed sleep raced
    // on slow runners: the request then arrived while draining and was refused with 503.
    while (upstream.received.length === 0) await new Promise((r) => setTimeout(r, 5));
    const closing = app.close();

    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });
    await closing;
  });
});
