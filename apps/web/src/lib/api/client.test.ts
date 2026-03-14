import { taskDto } from '@dpp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { errorBody, urlOf } from '../../test/fakeBackend';
import { ApiClient } from './client';
import { ApiError } from './errors';

function clientWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const onUnauthenticated = vi.fn();
  const client = new ApiClient({
    baseUrl: 'http://gateway.test/api',
    getToken: () => 'tok',
    onUnauthenticated,
    fetchImpl: async (input, init) => {
      calls.push({ url: urlOf(input), init: init ?? {} });
      return respond(urlOf(input), init ?? {});
    },
  });
  return { client, calls, onUnauthenticated };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ApiClient', () => {
  it('sends the bearer token, a fresh correlation ID per call, and JSON only with a body', async () => {
    const { client, calls } = clientWith(() => new Response(null, { status: 204 }));
    await client.request('GET', '/me');
    await client.request('POST', '/tasks', { body: { title: 'x' } });

    const [get, post] = calls.map((c) => c.init.headers as Record<string, string>);
    expect(calls[0]!.url).toBe('http://gateway.test/api/me');
    expect(get!['authorization']).toBe('Bearer tok');
    expect(get!['content-type']).toBeUndefined();
    expect(post!['content-type']).toBe('application/json');
    expect(get!['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(post!['x-correlation-id']).not.toBe(get!['x-correlation-id']);
    expect(calls[1]!.init.body).toBe('{"title":"x"}');
  });

  it('returns undefined for 204 and validates JSON responses against the schema', async () => {
    const { client } = clientWith(() => json(200, { id: 'not-a-task' }));
    const err = await client
      .request('GET', '/tasks/1', { schema: taskDto })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('unexpected');

    const empty = clientWith(() => new Response(null, { status: 204 }));
    await expect(empty.client.request('DELETE', '/tasks/1')).resolves.toBeUndefined();
  });

  it('turns a failed fetch into a network error', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.request('GET', '/me')).rejects.toMatchObject({
      kind: 'network',
      status: null,
    });
  });

  it('reports 401 to the session handler and still throws', async () => {
    const { client, onUnauthenticated } = clientWith(() =>
      json(401, errorBody('TOKEN_EXPIRED', 'Token expired')),
    );
    await expect(client.request('GET', '/me')).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does not end the session on other errors', async () => {
    const { client, onUnauthenticated } = clientWith(() => json(403, errorBody('FORBIDDEN', 'no')));
    await expect(client.request('GET', '/me')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
