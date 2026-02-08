import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { acceptIncomingId, registerRequestContext, requestIdOptions } from './index.js';

function buildApp() {
  const app = Fastify({ logger: false, ...requestIdOptions() });
  registerRequestContext(app);
  app.get('/', (request) => ({ requestId: request.id, correlationId: request.correlationId }));
  return app;
}

describe('request context', () => {
  it('generates IDs when none are supplied and echoes them in headers', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/' });
    const body = res.json<{ requestId: string; correlationId: string }>();

    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.correlationId).toBe(body.requestId);
    expect(res.headers['x-request-id']).toBe(body.requestId);
    expect(res.headers['x-correlation-id']).toBe(body.correlationId);
  });

  it('preserves well-formed inbound IDs', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/',
      headers: { 'x-request-id': 'req-123', 'x-correlation-id': 'corr-abc' },
    });
    expect(res.json()).toEqual({ requestId: 'req-123', correlationId: 'corr-abc' });
  });

  it('replaces malformed inbound IDs instead of propagating them', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/',
      headers: { 'x-correlation-id': 'bad id\nwith newline' },
    });
    expect(res.json<{ correlationId: string }>().correlationId).not.toContain('bad');
  });

  it('bounds accepted ID length', () => {
    expect(acceptIncomingId('a'.repeat(128))).toBeDefined();
    expect(acceptIncomingId('a'.repeat(129))).toBeUndefined();
  });
});

describe('request logging', () => {
  it('logs one completion line carrying request, correlation and route fields', async () => {
    const lines: Record<string, unknown>[] = [];
    const app = Fastify({
      logger: {
        level: 'info',
        stream: {
          write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
        },
      },
      ...requestIdOptions(),
    });
    registerRequestContext(app);
    app.get('/items/:id', () => ({ ok: true }));

    await app.inject({ method: 'GET', url: '/items/42', headers: { 'x-correlation-id': 'c-1' } });

    const completions = lines.filter((l) => l['msg'] === 'request completed');
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      correlationId: 'c-1',
      route: '/items/:id',
      statusCode: 200,
      method: 'GET',
    });
    expect(completions[0]!['requestId']).toBeDefined();
  });
});
