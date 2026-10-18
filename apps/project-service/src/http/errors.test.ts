import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { registerErrorHandling } from './errors.js';

// The shape node-postgres produces when its client-side query_timeout fires, wrapped by Drizzle.
const queryTimeout = () =>
  Object.assign(
    new Error('Failed query: update "tasks" set "title" = $1\nparams: secret-title', {
      cause: new Error('Query read timeout'),
    }),
    { name: 'DrizzleQueryError' },
  );

describe('error mapping for database timeouts', () => {
  const app = Fastify();
  registerErrorHandling(app);
  app.get('/read', async () => {
    throw queryTimeout();
  });
  app.post('/write', async () => {
    throw queryTimeout();
  });
  afterAll(() => app.close());
  it('answers a timed-out read with 503: retrying it is safe', async () => {
    const res = await app.inject({ method: 'GET', url: '/read' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('answers a timed-out mutation with 504 OUTCOME_UNKNOWN, without leaking the query', async () => {
    const res = await app.inject({ method: 'POST', url: '/write' });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe('OUTCOME_UNKNOWN');
    expect(res.body).not.toMatch(/update|secret-title|Query read timeout/i);
  });
});
