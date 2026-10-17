import { randomUUID } from 'node:crypto';
import type { RealtimeServerMessage } from '@dpp/contracts';
import { runMigrations } from '@dpp/database';
import { createKafkaClient, ensureTopics, TOPICS } from '@dpp/kafka';
import {
  startKafka,
  startPostgres,
  waitFor,
  type StartedKafka,
  type StartedPostgres,
} from '@dpp/test-utils';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startService, type ServiceProcess } from './processes.js';

/**
 * Phase 8 end to end with real processes:
 *   user A: HTTP → gateway → project-service → PostgreSQL (change + outbox)
 *   outbox-publisher → Kafka → realtime-service → gateway /api/realtime → user B's WebSocket
 */
let postgres: StartedPostgres;
let kafka: StartedKafka;
let projectService: ServiceProcess;
let realtime: ServiceProcess;
let gateway: ServiceProcess;
let publisher: ServiceProcess;
const JWT_SECRET = 'realtime-chain-secret-realtime-chain-secret';
const APP_ORIGIN = 'https://app.example';

beforeAll(async () => {
  [postgres, kafka] = await Promise.all([startPostgres(), startKafka()]);
  await runMigrations(postgres.url);
  const client = createKafkaClient({
    clientId: 'rt-chain',
    brokers: kafka.brokers,
    logger: pino({ level: 'silent' }),
  });
  const admin = client.admin();
  await admin.connect();
  await ensureTopics(admin, [TOPICS.domainEvents, TOPICS.domainEventsDlq]);
  await admin.disconnect();
  const kafkaEnv = (id: string) => ({
    KAFKA_BROKERS: kafka.brokers.join(','),
    KAFKA_CLIENT_ID: id,
  });
  [projectService, realtime, publisher] = await Promise.all([
    startService('project-service', {
      DATABASE_URL: postgres.url,
      JWT_SECRET,
      AUTH_DEV_LOGIN_ENABLED: 'true',
      DEPLOYMENT_ENVIRONMENT: 'test',
    }),
    startService('realtime-service', {
      DATABASE_URL: postgres.url,
      JWT_SECRET,
      ...kafkaEnv('realtime-service'),
    }),
    startService('outbox-publisher', {
      DATABASE_URL: postgres.url,
      ...kafkaEnv('outbox-publisher'),
      OUTBOX_POLL_INTERVAL_MS: '100',
    }),
  ]);
  gateway = await startService('api-gateway', {
    PROJECT_SERVICE_URL: projectService.url,
    REALTIME_SERVICE_URL: realtime.url,
    CORS_ORIGINS: APP_ORIGIN,
  });
}, 300_000);

afterAll(async () => {
  for (const svc of [gateway, publisher, realtime, projectService]) await svc?.stop();
  await Promise.all([kafka?.stop(), postgres?.stop()]);
});

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; correlationId?: string } = {},
) {
  const res = await fetch(`${gateway.url}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.correlationId ? { 'x-correlation-id': opts.correlationId } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}
async function login(name: string) {
  const res = await call('POST', '/auth/dev-login', {
    body: { email: `${name}-${randomUUID()}@example.com`, displayName: name },
  });
  return {
    token: res.body.token as string,
    id: res.body.user.id as string,
    email: res.body.user.email as string,
  };
}

function connect(token: string, projectId: string) {
  const socket = new WebSocket(`${gateway.url.replace('http', 'ws')}/api/realtime`, {
    origin: APP_ORIGIN,
  });
  const messages: RealtimeServerMessage[] = [];
  const closed = new Promise<number>((r) => socket.on('close', (code) => r(code)));
  socket.on('message', (d) =>
    messages.push(JSON.parse((d as Buffer).toString('utf8')) as RealtimeServerMessage),
  );
  socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
  socket.on('message', () => {
    const last = messages.at(-1);
    if (last?.type === 'ready') socket.send(JSON.stringify({ type: 'subscribe', projectId }));
  });
  return {
    socket,
    messages,
    closed,
    events: () => messages.flatMap((m) => (m.type === 'event' ? [m.event] : [])),
  };
}

describe('realtime through the gateway (real processes)', () => {
  it('user B sees user A’s change without refreshing; the notification carries A’s correlation ID', async () => {
    const [a, b] = [await login('ada'), await login('bob')];
    const ws = await call('POST', '/workspaces', { token: a.token, body: { name: 'W' } });
    await call('POST', `/workspaces/${ws.body.id}/members`, {
      token: a.token,
      body: { email: b.email, role: 'MEMBER' },
    });
    const project = await call('POST', '/projects', {
      token: a.token,
      body: { workspaceId: ws.body.id, name: 'P' },
    });
    const board = await call('GET', `/projects/${project.body.id}/board`, { token: b.token });

    const bob = connect(b.token, project.body.id);
    await waitFor(() => bob.messages.some((m) => m.type === 'subscribed'), {
      description: 'bob subscribed',
    });

    const created = await call('POST', '/tasks', {
      token: a.token,
      correlationId: 'corr-live-1',
      body: { projectId: project.body.id, columnId: board.body.columns[0].id, title: 'Live' },
    });
    expect(created.status).toBe(201);
    await waitFor(() => bob.events().length >= 1, {
      timeoutMs: 30_000,
      description: 'bob notified',
    });
    expect(bob.events()[0]).toMatchObject({
      type: 'task.created',
      taskId: created.body.id,
      correlationId: 'corr-live-1',
    });
    // The notification is a hint; the state comes from HTTP.
    const fresh = await call('GET', `/tasks/${created.body.id}`, { token: b.token });
    expect(fresh.body.title).toBe('Live');
    // The log line is written after the send, so it may trail the notification slightly.
    await waitFor(
      () =>
        realtime.logs.some(
          (l) =>
            l['correlationId'] === 'corr-live-1' &&
            l['message'] === 'realtime notification broadcast',
        ),
      { description: 'correlated realtime log line' },
    );
    bob.socket.close();
  });

  it('an outsider cannot subscribe to the project, and receives nothing from it', async () => {
    const [a, outsider] = [await login('ada'), await login('eve')];
    const ws = await call('POST', '/workspaces', { token: a.token, body: { name: 'W' } });
    const project = await call('POST', '/projects', {
      token: a.token,
      body: { workspaceId: ws.body.id, name: 'P' },
    });
    const board = await call('GET', `/projects/${project.body.id}/board`, { token: a.token });
    const eve = connect(outsider.token, project.body.id);
    await waitFor(() => eve.messages.some((m) => m.type === 'error'), { description: 'refused' });
    expect(eve.messages.find((m) => m.type === 'error')).toMatchObject({ code: 'FORBIDDEN' });
    await call('POST', '/tasks', {
      token: a.token,
      body: { projectId: project.body.id, columnId: board.body.columns[0].id, title: 'Secret' },
    });
    await new Promise((r) => setTimeout(r, 2_000));
    expect(eve.events()).toEqual([]);
    eve.socket.close();
  });

  it('the gateway refuses the WebSocket upgrade from a page on another origin', async () => {
    // Browsers send Origin on WebSocket handshakes and CORS does not apply to them, so the
    // gateway checks it itself (cross-site WebSocket hijacking).
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${gateway.url.replace('http', 'ws')}/api/realtime`, {
        origin: 'https://evil.example',
      });
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.on('open', () => {
        socket.close();
        resolve(101);
      });
      socket.on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('events missed while disconnected are recovered by refetching after reconnect', async () => {
    const [a, b] = [await login('ada'), await login('bob')];
    const ws = await call('POST', '/workspaces', { token: a.token, body: { name: 'W' } });
    await call('POST', `/workspaces/${ws.body.id}/members`, {
      token: a.token,
      body: { email: b.email, role: 'MEMBER' },
    });
    const project = await call('POST', '/projects', {
      token: a.token,
      body: { workspaceId: ws.body.id, name: 'P' },
    });
    const columnId = (await call('GET', `/projects/${project.body.id}/board`, { token: a.token }))
      .body.columns[0].id;

    const first = connect(b.token, project.body.id);
    await waitFor(() => first.messages.some((m) => m.type === 'subscribed'), {
      description: 'subscribed',
    });
    first.socket.close();
    await first.closed;
    // While B is away:
    await call('POST', '/tasks', {
      token: a.token,
      body: { projectId: project.body.id, columnId, title: 'Missed' },
    });

    const second = connect(b.token, project.body.id);
    await waitFor(() => second.messages.some((m) => m.type === 'subscribed'), {
      description: 'resubscribed',
    });
    // The realtime channel does not replay; reconciliation is the HTTP refetch on (re)subscribe.
    const board = await call('GET', `/projects/${project.body.id}/board`, { token: b.token });
    expect(board.body.columns[0].tasks.map((t: { title: string }) => t.title)).toContain('Missed');
    second.socket.close();
  });
});
