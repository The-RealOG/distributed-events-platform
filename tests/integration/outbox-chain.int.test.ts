import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@dpp/contracts';
import { createDatabase, runMigrations } from '@dpp/database';
import { createKafkaClient, DomainEventConsumer, ensureTopics, TOPICS } from '@dpp/kafka';
import {
  startKafka,
  startPostgres,
  waitFor,
  type StartedKafka,
  type StartedPostgres,
} from '@dpp/test-utils';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startService, type ServiceProcess } from './processes.js';

/**
 * The full event path with real processes:
 *   HTTP → api-gateway → project-service → PostgreSQL (change + outbox, one transaction)
 *   outbox-publisher → Kafka → consumer
 */
let postgres: StartedPostgres;
let kafka: StartedKafka;
let projectService: ServiceProcess;
let gateway: ServiceProcess;
let publisher: ServiceProcess;
const received: DomainEvent[] = [];
let stopConsumer: () => Promise<void>;
let database: ReturnType<typeof createDatabase>;

const publisherEnv = () => ({
  DATABASE_URL: postgres.url,
  KAFKA_BROKERS: kafka.brokers.join(','),
  KAFKA_CLIENT_ID: 'outbox-publisher',
  OUTBOX_POLL_INTERVAL_MS: '100',
  OUTBOX_BACKOFF_BASE_MS: '200',
  OUTBOX_BACKOFF_MAX_MS: '2000',
});

beforeAll(async () => {
  [postgres, kafka] = await Promise.all([startPostgres(), startKafka()]);
  await runMigrations(postgres.url);
  database = createDatabase({
    connectionString: postgres.url,
    applicationName: 'chain-test',
    maxConnections: 2,
  });

  const logger = pino({ level: 'silent' });
  const client = createKafkaClient({ clientId: 'chain-test', brokers: kafka.brokers, logger });
  const admin = client.admin();
  await admin.connect();
  await ensureTopics(admin, [TOPICS.domainEvents, TOPICS.domainEventsDlq]);
  await admin.disconnect();
  const consumer = new DomainEventConsumer({
    kafka: client,
    logger,
    groupId: `chain-${randomUUID()}`,
    topics: [TOPICS.domainEvents.name],
    handler: async (event) => void received.push(event),
  });
  const joined = consumer.nextGroupJoin();
  await consumer.start();
  await joined;
  stopConsumer = () => consumer.stop();

  projectService = await startService('project-service', {
    DATABASE_URL: postgres.url,
    JWT_SECRET: 'chain-test-secret-chain-test-secret!!',
    AUTH_DEV_LOGIN_ENABLED: 'true',
    DEPLOYMENT_ENVIRONMENT: 'test',
  });
  gateway = await startService('api-gateway', { PROJECT_SERVICE_URL: projectService.url });
  publisher = await startService('outbox-publisher', publisherEnv());
});

afterAll(async () => {
  await stopConsumer?.();
  for (const svc of [publisher, gateway, projectService]) await svc?.stop();
  await database?.close();
  await kafka?.stop();
  await postgres?.stop();
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

async function newProject() {
  const login = await call('POST', '/auth/dev-login', {
    body: { email: `chain-${randomUUID()}@example.com`, displayName: 'Chain' },
  });
  const token = login.body.token as string;
  const ws = await call('POST', '/workspaces', { token, body: { name: 'Chain' } });
  const project = await call('POST', '/projects', {
    token,
    body: { workspaceId: ws.body.id, name: 'Chain' },
  });
  const board = await call('GET', `/projects/${project.body.id}/board`, { token });
  return {
    token,
    userId: login.body.user.id as string,
    projectId: project.body.id as string,
    columns: board.body.columns,
  };
}

describe('HTTP → PostgreSQL → outbox → publisher → Kafka', () => {
  it('Invariant 8 + 9: the event in Kafka carries the request’s correlation ID and the committed version', async () => {
    const p = await newProject();
    const created = await call('POST', '/tasks', {
      token: p.token,
      correlationId: 'chain-corr-create',
      body: { projectId: p.projectId, columnId: p.columns[0].id, title: 'Chain task' },
    });
    const updated = await call('PATCH', `/tasks/${created.body.id}`, {
      token: p.token,
      correlationId: 'chain-corr-update',
      body: { expectedVersion: 1, title: 'Chain task v2' },
    });
    expect(updated.body.version).toBe(2);

    const events = await waitFor(
      () => {
        const mine = received.filter((e) => e.aggregateId === created.body.id);
        return mine.length >= 2 ? mine : undefined;
      },
      { timeoutMs: 60_000, description: 'both events in Kafka' },
    );
    expect(
      events.map((e) => [e.eventType, e.aggregateVersion, e.correlationId, e.payload.actorId]),
    ).toEqual([
      ['task.created', 1, 'chain-corr-create', p.userId],
      ['task.updated', 2, 'chain-corr-update', p.userId],
    ]);

    // The same correlation ID appears in all three services' logs; each hop has its own requestId.
    await new Promise((r) => setTimeout(r, 300));
    const inLogs = (svc: ServiceProcess) =>
      svc.logs.filter((l) => l['correlationId'] === 'chain-corr-update');
    expect(inLogs(gateway).length).toBeGreaterThan(0);
    expect(inLogs(projectService).length).toBeGreaterThan(0);
    expect(inLogs(publisher).find((l) => l['message'] === 'outbox event published')).toMatchObject({
      eventId: events[1]!.eventId,
      eventType: 'task.updated',
    });
    for (const svc of [gateway, projectService, publisher]) {
      expect(svc.rawOutput()).not.toContain(p.token);
    }
  });

  it('Invariant 3 + 4: with the publisher process down, mutations still commit; the events wait and are delivered on restart', async () => {
    const p = await newProject();
    const { code } = await publisher.stop();
    expect(code).toBe(0);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await call('POST', '/tasks', {
        token: p.token,
        correlationId: `publisher-down-${i}`,
        body: {
          projectId: p.projectId,
          columnId: p.columns[0].id,
          title: `While publisher is down ${i}`,
        },
      });
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    const pending = await database.pool.query(
      'SELECT count(*)::int AS n FROM outbox_events WHERE partition_key = $1 AND published_at IS NULL',
      [p.projectId],
    );
    expect(pending.rows[0].n).toBe(3);
    expect(received.filter((e) => ids.includes(e.aggregateId))).toEqual([]);

    publisher = await startService('outbox-publisher', publisherEnv());
    const delivered = await waitFor(
      () => {
        const mine = received.filter((e) => ids.includes(e.aggregateId));
        return mine.length >= 3 ? mine : undefined;
      },
      { timeoutMs: 60_000, description: 'events delivered after the publisher restarted' },
    );
    expect(delivered.map((e) => e.correlationId)).toEqual([
      'publisher-down-0',
      'publisher-down-1',
      'publisher-down-2',
    ]);
  });
});
