import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';

// Points the real app at a port nothing listens on, to verify behaviour when PostgreSQL is down.
let h: Harness;
let token: string;
beforeAll(async () => {
  const live = await createHarness();
  token = (await live.login('user')).token;
  await live.close();
  h = await createHarness('postgres://dpp:dpp@127.0.0.1:1/dpp');
});
afterAll(() => h.close());

describe('PostgreSQL unavailable', () => {
  it('stays alive but reports not ready', async () => {
    expect((await h.call('GET', '/health')).status).toBe(200);
    const ready = await h.call('GET', '/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.reason).toBe('database_unavailable');
  });

  it('answers requests with 503 and no internal details', async () => {
    const res = await h.call('GET', '/workspaces', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|stack/);
  });
});
