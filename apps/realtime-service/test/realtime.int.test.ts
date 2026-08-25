import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { LocalJwtAuthProvider } from '@dpp/auth';
import {
  commentEvents,
  REALTIME_CLOSE,
  taskEvents,
  toRealtimeEnvelope,
  type DomainEvent,
  type RealtimeServerMessage,
} from '@dpp/contracts';
import { createDatabase, runMigrations, type DatabaseHandle } from '@dpp/database';
import { createKafkaClient, DomainEventProducer, ensureTopics } from '@dpp/kafka';
import { createIsolatedDatabase, waitFor } from '@dpp/test-utils';
import type { FastifyInstance } from 'fastify';
import type { Kafka } from 'kafkajs';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { Hub } from '../src/hub.js';
import { createRealtimeWorker } from '../src/worker.js';

/**
 * The realtime service against real PostgreSQL (membership) and Kafka (events). Each test gets
 * its own topic; replicas are separate in-process instances with their own consumer groups.
 */
const SECRET = 'realtime-test-secret-realtime-test-secret';
const auth = new LocalJwtAuthProvider({
  secret: SECRET,
  issuer: 'dpp-local',
  audience: 'dpp-api',
  ttlSeconds: 600,
});
let database: DatabaseHandle;
let kafka: Kafka;
const lines: Record<string, unknown>[] = [];
const logger = pino(
  { level: 'info' },
  { write: (l: string) => void lines.push(JSON.parse(l) as Record<string, unknown>) },
);

beforeAll(async () => {
  const url = await createIsolatedDatabase(inject('postgresUrl'));
  await runMigrations(url);
  database = createDatabase({
    connectionString: url,
    applicationName: 'realtime-test',
    maxConnections: 10,
  });
  kafka = createKafkaClient({ clientId: 'realtime-test', brokers: inject('kafkaBrokers'), logger });
});
afterAll(() => database?.close());

async function createTopic(): Promise<string> {
  const name = `test.realtime.${randomUUID()}`;
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopics(admin, [{ name, numPartitions: 3, replicationFactor: 1, config: {} }]);
  await admin.disconnect();
  return name;
}

/** A user who is a member of a new workspace with one project. */
async function member() {
  const userId = randomUUID();
  const [workspaceId, projectId] = [randomUUID(), randomUUID()];
  await database.pool.query('INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)', [
    userId,
    `${userId}@example.com`,
    'U',
  ]);
  await database.pool.query('INSERT INTO workspaces (id, name, created_by) VALUES ($1, $2, $3)', [
    workspaceId,
    'W',
    userId,
  ]);
  await database.pool.query(
    "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'MEMBER')",
    [workspaceId, userId],
  );
  await database.pool.query(
    'INSERT INTO projects (id, workspace_id, name, created_by) VALUES ($1, $2, $3, $4)',
    [projectId, workspaceId, 'P', userId],
  );
  const token = await auth.issue({ userId, email: `${userId}@example.com` });
  return { userId, workspaceId, projectId, token };
}

interface Replica {
  app: FastifyInstance;
  hub: Hub;
  url: string;
  stop(): Promise<void>;
}
async function startReplica(
  topic: string,
  opts: { maxBufferedBytes?: number; heartbeatMs?: number } = {},
): Promise<Replica> {
  const hub = new Hub({
    logger,
    maxBufferedBytes: opts.maxBufferedBytes ?? 1024 * 1024,
    heartbeatMs: opts.heartbeatMs ?? 15_000,
  });
  const consumer = createRealtimeWorker({
    kafka,
    hub,
    logger,
    instanceId: randomUUID(),
    topics: [topic],
  });
  const app = await buildApp({
    logger,
    database,
    authProvider: auth,
    hub,
    consumer,
    authTimeoutMs: 1_000,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  hub.startHeartbeat();
  const joined = consumer.nextGroupJoin();
  await consumer.start();
  await joined;
  const { port } = app.server.address() as AddressInfo;
  return {
    app,
    hub,
    url: `ws://127.0.0.1:${port}/realtime`,
    stop: async () => {
      hub.closeAll(REALTIME_CLOSE.goingAway, 'test stop');
      await app.close();
      await consumer.stop();
    },
  };
}

interface TestClient {
  socket: WebSocket;
  messages: RealtimeServerMessage[];
  closed: Promise<{ code: number }>;
  send(value: unknown): void;
  events(): string[];
}
function connect(
  url: string,
  options: ConstructorParameters<typeof WebSocket>[2] = {},
): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const messages: RealtimeServerMessage[] = [];
    const closed = new Promise<{ code: number }>((r) => socket.on('close', (code) => r({ code })));
    socket.on('message', (data) =>
      messages.push(JSON.parse((data as Buffer).toString('utf8')) as RealtimeServerMessage),
    );
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        socket,
        messages,
        closed,
        send: (value) => socket.send(typeof value === 'string' ? value : JSON.stringify(value)),
        events: () => messages.flatMap((m) => (m.type === 'event' ? [m.event.eventId] : [])),
      }),
    );
  });
}
async function subscribed(
  url: string,
  user: { token: string },
  projectId: string,
): Promise<TestClient> {
  const client = await connect(url);
  client.send({ type: 'auth', token: user.token });
  client.send({ type: 'subscribe', projectId });
  await waitFor(
    () => client.messages.some((m) => m.type === 'subscribed' && m.projectId === projectId),
    {
      description: 'subscribed',
    },
  );
  return client;
}
async function publish(topic: string, ...events: DomainEvent[]) {
  const producer = new DomainEventProducer({ kafka, logger, topic });
  await producer.connect();
  for (const e of events) await producer.publish(e);
  await producer.close();
}
function allEventTypes(projectId: string, correlationId = `corr-${randomUUID()}`): DomainEvent[] {
  const ctx = { producer: 'project-service', correlationId };
  const actor = randomUUID();
  const [todo, done] = [randomUUID(), randomUUID()];
  const task = (version: number, columnId = todo) => ({
    id: randomUUID(),
    projectId,
    columnId,
    title: 'T',
    position: '1',
    version,
  });
  const t = task(1);
  const at = (version: number, columnId = todo) => ({ ...t, version, columnId });
  return [
    taskEvents.created(ctx, actor, at(1)),
    taskEvents.updated(
      ctx,
      actor,
      { title: 'T', description: '' },
      { ...at(2), title: 'T2', description: '' },
    ),
    taskEvents.moved(ctx, actor, todo, at(3, done)),
    taskEvents.assigned(ctx, actor, at(4, done), actor),
    taskEvents.unassigned(ctx, actor, at(5, done), actor),
    commentEvents.created(
      ctx,
      { id: randomUUID(), taskId: t.id, authorId: actor, body: 'hi' },
      { projectId, title: 'T' },
    ),
    taskEvents.deleted(ctx, actor, at(6, done)),
  ];
}

describe('authentication', () => {
  it('accepts a valid token and rejects missing, invalid, expired and malformed credentials', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic);
    const user = await member();

    const ok = await connect(r.url);
    ok.send({ type: 'auth', token: user.token });
    await waitFor(() => ok.messages.some((m) => m.type === 'ready' && m.userId === user.userId), {
      description: 'ready',
    });
    ok.socket.close();

    const expired = await new LocalJwtAuthProvider({
      secret: SECRET,
      issuer: 'dpp-local',
      audience: 'dpp-api',
      ttlSeconds: -10,
    }).issue({ userId: user.userId, email: 'x@example.com' });
    const forged = await new LocalJwtAuthProvider({
      secret: 'x'.repeat(40),
      issuer: 'dpp-local',
      audience: 'dpp-api',
      ttlSeconds: 600,
    }).issue({ userId: user.userId, email: 'x@example.com' });
    for (const [label, first] of [
      ['invalid', { type: 'auth', token: forged }],
      ['expired', { type: 'auth', token: expired }],
      ['malformed', 'not json at all'],
      ['subscribe-before-auth', { type: 'subscribe', projectId: user.projectId }],
    ] as const) {
      const c = await connect(r.url);
      c.send(first);
      expect((await c.closed).code, label).toBe(REALTIME_CLOSE.unauthenticated);
      expect(
        c.messages.some((m) => m.type === 'ready'),
        label,
      ).toBe(false);
    }
    const silent = await connect(r.url);
    expect((await silent.closed).code).toBe(REALTIME_CLOSE.authTimeout);
    await r.stop();
  });
});

describe('authorization and rooms', () => {
  it('refuses subscriptions to projects the user is not a member of, and to unknown projects', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic);
    const [a, b] = [await member(), await member()];
    const client = await connect(r.url);
    client.send({ type: 'auth', token: a.token });
    client.send({ type: 'subscribe', projectId: b.projectId });
    client.send({ type: 'subscribe', projectId: randomUUID() });
    await waitFor(() => client.messages.filter((m) => m.type === 'error').length === 2, {
      description: 'two refusals',
    });
    expect(
      client.messages
        .filter((m) => m.type === 'error')
        .map((m) => (m as { code: string }).code)
        .sort(),
    ).toEqual(['FORBIDDEN', 'NOT_FOUND']);
    expect(r.hub.membersOf(b.projectId)).toBe(0);

    // And nothing from project B reaches A.
    await publish(topic, ...allEventTypes(b.projectId).slice(0, 1));
    await new Promise((res) => setTimeout(res, 1_500));
    expect(client.events()).toEqual([]);
    client.socket.close();
    await r.stop();
  });

  it('delivers every event type to the project’s room only, with the correlation ID and no infrastructure metadata', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic);
    const [a, b] = [await member(), await member()];
    const [a1, a2, bClient] = [
      await subscribed(r.url, a, a.projectId),
      await subscribed(r.url, a, a.projectId),
      await subscribed(r.url, b, b.projectId),
    ];
    const events = allEventTypes(a.projectId, 'corr-realtime-1');
    await publish(topic, ...events);
    await waitFor(() => a1.events().length === 7 && a2.events().length === 7, {
      timeoutMs: 30_000,
      description: 'all 7 to both A clients',
    });
    expect(a1.events()).toEqual(events.map((e) => e.eventId));
    const first = a1.messages.find((m) => m.type === 'event') as Extract<
      RealtimeServerMessage,
      { type: 'event' }
    >;
    expect(first.event).toEqual({
      type: 'task.created',
      eventId: events[0]!.eventId,
      projectId: a.projectId,
      aggregateId: events[0]!.aggregateId,
      aggregateVersion: 1,
      taskId: events[0]!.aggregateId,
      actorId: expect.any(String),
      correlationId: 'corr-realtime-1',
      occurredAt: events[0]!.occurredAt,
    });
    expect(JSON.stringify(a1.messages)).not.toMatch(/partition|offset|consumerGroup/);
    expect(bClient.events()).toEqual([]);
    expect(
      lines.some(
        (l) =>
          l['msg'] === 'realtime notification broadcast' &&
          l['correlationId'] === 'corr-realtime-1',
      ),
    ).toBe(true);
    for (const c of [a1, a2, bClient]) c.socket.close();
    await r.stop();
  });

  it('suppresses a duplicate delivery of the same event (at-least-once from Kafka)', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic);
    const a = await member();
    const client = await subscribed(r.url, a, a.projectId);
    const [event, next] = allEventTypes(a.projectId);
    await publish(topic, event!, event!, next!);
    await waitFor(() => client.events().length >= 2, { timeoutMs: 30_000, description: 'events' });
    await new Promise((res) => setTimeout(res, 500));
    expect(client.events()).toEqual([event!.eventId, next!.eventId]);
    expect(r.hub.counters.duplicatesSuppressed).toBe(1);
    client.socket.close();
    await r.stop();
  });

  it('cleans up membership when clients disconnect (no leaked rooms)', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic);
    const a = await member();
    const clients = [
      await subscribed(r.url, a, a.projectId),
      await subscribed(r.url, a, a.projectId),
    ];
    expect(r.hub.membersOf(a.projectId)).toBe(2);
    for (const c of clients) c.socket.close();
    await waitFor(() => r.hub.connections === 0 && r.hub.rooms === 0, {
      description: 'cleaned up',
    });
    await r.stop();
  });
});

describe('multiple replicas', () => {
  it('clients on different replicas all receive the event (each replica consumes every event)', async () => {
    const topic = await createTopic();
    const [r1, r2] = [await startReplica(topic), await startReplica(topic)];
    const a = await member();
    const [c1, c2] = [
      await subscribed(r1.url, a, a.projectId),
      await subscribed(r2.url, a, a.projectId),
    ];
    const events = allEventTypes(a.projectId).slice(0, 3);
    await publish(topic, ...events);
    await waitFor(() => c1.events().length === 3 && c2.events().length === 3, {
      timeoutMs: 30_000,
      description: 'both replicas deliver all events',
    });
    for (const c of [c1, c2]) c.socket.close();
    await Promise.all([r1.stop(), r2.stop()]);
  });
});

describe('connection health', () => {
  it('disconnects a client that does not read (bounded buffering), with the slow-client code', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic, { maxBufferedBytes: 4 * 1024 });
    const a = await member();
    const client = await subscribed(r.url, a, a.projectId);
    // Stop reading from the socket: the server's send buffer fills up.
    (client.socket as unknown as { _socket: { pause(): void } })._socket.pause();
    // Enough data to fill the kernel's TCP buffers too (several MB on Linux), so the server's
    // own send buffer starts to grow; broadcast straight into this replica's hub.
    for (let i = 0; i < 40_000 && r.hub.counters.slowClientDisconnects === 0; i++) {
      r.hub.broadcast({
        ...toRealtimeEnvelope(allEventTypes(a.projectId)[0]!),
        eventId: randomUUID(),
      });
      if (i % 500 === 0) await new Promise((res) => setImmediate(res));
    }
    await waitFor(() => r.hub.counters.slowClientDisconnects === 1, {
      timeoutMs: 30_000,
      description: 'slow client closed',
    });
    expect(r.hub.membersOf(a.projectId)).toBe(0);
    await r.stop();
  });

  it('terminates a connection that stops answering pings and removes it from its rooms', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic, { heartbeatMs: 1_000 });
    const a = await member();
    const client = await subscribed(r.url, a, a.projectId);
    // Simulate a dead peer: it no longer answers pings.
    client.socket.pong = () => undefined;
    (
      client.socket as unknown as { _receiver: { removeAllListeners(e: string): void } }
    )._receiver.removeAllListeners('ping');
    await waitFor(() => r.hub.counters.heartbeatTerminations === 1, {
      timeoutMs: 10_000,
      description: 'terminated',
    });
    expect(r.hub.membersOf(a.projectId)).toBe(0);
    await r.stop();
  });

  it('graceful shutdown closes every client with "going away" so they reconnect elsewhere', async () => {
    const topic = await createTopic();
    const r = await startReplica(topic);
    const a = await member();
    const client = await subscribed(r.url, a, a.projectId);
    await r.stop();
    expect((await client.closed).code).toBe(REALTIME_CLOSE.goingAway);
  });
});
