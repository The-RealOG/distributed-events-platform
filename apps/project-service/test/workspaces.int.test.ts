import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('identity', () => {
  it('dev login upserts by email and returns a working token', async () => {
    const first = await h.call('POST', '/auth/dev-login', {
      body: { email: 'Grace@Example.com', displayName: 'Grace' },
    });
    const second = await h.call('POST', '/auth/dev-login', {
      body: { email: 'grace@example.com', displayName: 'Grace H' },
    });
    expect(first.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);

    const me = await h.call('GET', '/me', {
      headers: { authorization: `Bearer ${second.body.token}` },
    });
    expect(me.body).toEqual({
      id: first.body.user.id,
      email: 'grace@example.com',
      displayName: 'Grace H',
    });
  });

  it('rejects missing and forged tokens with 401', async () => {
    expect((await h.call('GET', '/me')).body.error.code).toBe('UNAUTHENTICATED');
    const forged = await h.call('GET', '/workspaces', {
      headers: { authorization: 'Bearer abc.def.ghi' },
    });
    expect(forged.status).toBe(401);
  });

  it('authenticates before validating, so anonymous callers get 401 not 400', async () => {
    const res = await h.call('POST', '/workspaces', { body: { wrong: true } });
    expect(res.status).toBe(401);
  });
});

describe('workspaces and membership', () => {
  it('makes the creator OWNER and lists only the caller’s workspaces', async () => {
    const alice = await h.login('alice');
    const bob = await h.login('bob');
    const created = await h.call('POST', '/workspaces', { as: alice, body: { name: 'Alpha' } });

    expect(created.status).toBe(201);
    expect(created.body.role).toBe('OWNER');
    expect(
      (await h.call('GET', '/workspaces', { as: alice })).body.map((w: { id: string }) => w.id),
    ).toEqual([created.body.id]);
    expect((await h.call('GET', '/workspaces', { as: bob })).body).toEqual([]);
  });

  it('returns 404 for a missing workspace and 403 for a non-member', async () => {
    const alice = await h.login('alice');
    const bob = await h.login('bob');
    const ws = await h.call('POST', '/workspaces', { as: alice, body: { name: 'Private' } });

    expect((await h.call('GET', `/workspaces/${ws.body.id}`, { as: bob })).status).toBe(403);
    expect(
      (await h.call('GET', '/workspaces/00000000-0000-4000-8000-000000000000', { as: bob })).status,
    ).toBe(404);
  });

  it('enforces who may grant which role', async () => {
    const owner = await h.login('owner');
    const admin = await h.login('admin');
    const member = await h.login('member');
    const outsider = await h.login('outsider');
    const ws = (await h.call('POST', '/workspaces', { as: owner, body: { name: 'Roles' } })).body;
    const add = (as: typeof owner, email: string, role: string) =>
      h.call('POST', `/workspaces/${ws.id}/members`, { as, body: { email, role } });

    expect((await add(owner, admin.email, 'ADMIN')).status).toBe(201);
    expect((await add(admin, member.email, 'MEMBER')).status).toBe(201);
    // Admins cannot mint admins; members cannot add anyone; OWNER is never grantable.
    expect((await add(admin, outsider.email, 'ADMIN')).status).toBe(403);
    expect((await add(member, outsider.email, 'MEMBER')).status).toBe(403);
    expect((await add(owner, outsider.email, 'OWNER')).status).toBe(400);

    expect((await add(owner, member.email, 'MEMBER')).body.error.code).toBe('CONFLICT');
    expect((await add(owner, 'nobody@example.com', 'MEMBER')).status).toBe(404);

    const members = await h.call('GET', `/workspaces/${ws.id}/members`, { as: member });
    expect(members.body.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
  });
});
