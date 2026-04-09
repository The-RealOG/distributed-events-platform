import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API_URL = process.env['API_URL'] ?? 'http://localhost:3000/api';

export interface TestUser {
  email: string;
  name: string;
  token: string;
  id: string;
}

export const uniqueEmail = (name: string) =>
  `${name.toLowerCase()}-${randomUUID()}@e2e.example.com`;

/** Signs up/in through the API (used for setup; the lifecycle test signs in through the UI). */
export async function apiLogin(request: APIRequestContext, name: string): Promise<TestUser> {
  const email = uniqueEmail(name);
  const res = await request.post(`${API_URL}/auth/dev-login`, {
    data: { email, displayName: name },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { email, name, token: body.token, id: body.user.id };
}

export function api(request: APIRequestContext, user: TestUser) {
  const headers = { authorization: `Bearer ${user.token}` };
  const call = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
    const res = await request[method](`${API_URL}${path}`, { headers, ...(data ? { data } : {}) });
    return { status: res.status(), body: await res.json().catch(() => undefined) };
  };
  return {
    get: (path: string) => call('get', path),
    post: (path: string, data: unknown) => call('post', path, data),
    patch: (path: string, data: unknown) => call('patch', path, data),
  };
}

/** Owner + workspace + project (+ optional member), created through the public API. */
export async function seedProject(request: APIRequestContext, opts: { withMember?: boolean } = {}) {
  const owner = await apiLogin(request, 'Owner');
  const client = api(request, owner);
  const ws = await client.post('/workspaces', { name: 'E2E Workspace' });
  const project = await client.post('/projects', { workspaceId: ws.body.id, name: 'E2E Project' });
  const board = await client.get(`/projects/${project.body.id}/board`);
  let member: TestUser | undefined;
  if (opts.withMember) {
    member = await apiLogin(request, 'Member');
    expect(
      (
        await client.post(`/workspaces/${ws.body.id}/members`, {
          email: member.email,
          role: 'MEMBER',
        })
      ).status,
    ).toBe(201);
  }
  return {
    owner,
    member,
    client,
    workspaceId: ws.body.id as string,
    projectId: project.body.id as string,
    columns: board.body.columns as { id: string; name: string }[],
  };
}

/** Starts a browser session already holding a token, as the app would after login. */
export async function signInAs(context: BrowserContext, user: TestUser) {
  await context.addInitScript((token) => {
    window.localStorage.setItem('dpp.session.token', token);
  }, user.token);
}

export const column = (page: Page, name: string) =>
  page.getByRole('region', { name: new RegExp(`^${name}`) });
