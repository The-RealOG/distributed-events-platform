import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { DomainEvent } from '@dpp/contracts';
import { createDatabase } from '@dpp/database';
import { createKafkaClient, DomainEventConsumer, TOPICS } from '@dpp/kafka';
import { waitFor, waitForKafka } from '@dpp/test-utils';
import { Kafka, logLevel } from 'kafkajs';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The outbox demonstration, on the real Compose stack:
 *   Kafka down → real mutations through gateway → project-service → PostgreSQL succeed →
 *   their events wait in the outbox → Kafka back → the running outbox-publisher drains the
 *   backlog on its own → a probe consumer sees every event with its original identity.
 * Run: npm run demo:kafka-outage   (stack must be up)
 */
const API = process.env['API_URL'] ?? 'http://localhost:3000/api';
const BROKERS = [process.env['KAFKA_HOST_BROKER'] ?? 'localhost:9094'];
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://dpp:dpp_local_only@localhost:5432/dpp';
const repoRoot = resolve(import.meta.dirname, '../..');

const step = (text: string) => process.stdout.write(`\n▶ ${text}\n`);
const note = (text: string) => process.stdout.write(`  ${text}\n`);
const compose = (args: string) =>
  execSync(`docker compose ${args}`, { cwd: repoRoot, stdio: 'pipe', timeout: 180_000 });

const database = createDatabase({
  connectionString: DATABASE_URL,
  applicationName: 'stack-test',
  maxConnections: 2,
});
afterAll(async () => {
  compose('start kafka outbox-publisher');
  await database.close();
});

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; correlationId?: string } = {},
) {
  const res = await fetch(`${API}${path}`, {
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

async function kafkaReachable(): Promise<boolean> {
  const admin = new Kafka({
    clientId: 'probe',
    brokers: BROKERS,
    logLevel: logLevel.NOTHING,
    connectionTimeout: 1_000,
    retry: { retries: 0 },
  }).admin();
  try {
    await admin.connect();
    await admin.listTopics();
    return true;
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

interface OutboxRow {
  event_id: string;
  event_type: string;
  correlation_id: string;
  aggregate_version: number;
  published_at: Date | null;
  attempt_count: number;
  last_error: string | null;
}
const outboxFor = async (projectId: string) =>
  (
    await database.pool.query<OutboxRow>(
      'SELECT event_id, event_type, correlation_id, aggregate_version, published_at, attempt_count, last_error FROM outbox_events WHERE partition_key = $1 ORDER BY sequence_id',
      [projectId],
    )
  ).rows;

/** Real mutations through the gateway: create, update, move, assign, comment. */
async function mutate(tag: string) {
  const login = await call('POST', '/auth/dev-login', {
    body: { email: `${tag}-${randomUUID()}@example.com`, displayName: 'Demo' },
  });
  const token = login.body.token as string;
  const member = await call('POST', '/auth/dev-login', {
    body: { email: `${tag}-m-${randomUUID()}@example.com`, displayName: 'Member' },
  });
  const ws = await call('POST', '/workspaces', { token, body: { name: 'Outage demo' } });
  await call('POST', `/workspaces/${ws.body.id}/members`, {
    token,
    body: { email: member.body.user.email, role: 'MEMBER' },
  });
  const project = await call('POST', '/projects', {
    token,
    body: { workspaceId: ws.body.id, name: 'Outage demo' },
  });
  const board = await call('GET', `/projects/${project.body.id}/board`, { token });
  const [todo, doing] = board.body.columns;

  const results = [];
  const created = await call('POST', '/tasks', {
    token,
    correlationId: `${tag}-create`,
    body: { projectId: project.body.id, columnId: todo.id, title: 'Written while Kafka is down' },
  });
  results.push(created);
  const id = created.body.id;
  results.push(
    await call('PATCH', `/tasks/${id}`, {
      token,
      correlationId: `${tag}-update`,
      body: { expectedVersion: 1, title: 'Edited while Kafka is down' },
    }),
  );
  results.push(
    await call('POST', `/tasks/${id}/move`, {
      token,
      correlationId: `${tag}-move`,
      body: { expectedVersion: 2, columnId: doing.id, afterTaskId: null },
    }),
  );
  results.push(
    await call('POST', `/tasks/${id}/assignees`, {
      token,
      correlationId: `${tag}-assign`,
      body: { userId: member.body.user.id },
    }),
  );
  results.push(
    await call('POST', `/tasks/${id}/comments`, {
      token,
      correlationId: `${tag}-comment`,
      body: { body: 'Commented while Kafka is down' },
    }),
  );
  return {
    token,
    projectId: project.body.id as string,
    taskId: id as string,
    statuses: results.map((r) => r.status),
  };
}

async function consumeUntil(eventIds: string[]): Promise<DomainEvent[]> {
  const seen: DomainEvent[] = [];
  const logger = pino({ level: 'silent' });
  const consumer = new DomainEventConsumer({
    kafka: createKafkaClient({ clientId: 'stack-probe', brokers: BROKERS, logger }),
    logger,
    groupId: `stack-probe-${randomUUID()}`,
    topics: [TOPICS.domainEvents.name],
    fromBeginning: true,
    handler: async (event) => void (eventIds.includes(event.eventId) && seen.push(event)),
  });
  await consumer.start();
  try {
    await waitFor(() => new Set(seen.map((e) => e.eventId)).size >= eventIds.length, {
      timeoutMs: 120_000,
      description: 'the probe consumer to see every event',
    });
  } finally {
    await consumer.stop();
  }
  return seen;
}

beforeAll(async () => {
  expect(await kafkaReachable()).toBe(true);
});

describe('outbox demonstration on the Compose stack', () => {
  it('Invariant 3: Kafka down → mutations commit, events wait in the outbox, then drain automatically', async () => {
    step('Kafka is healthy. Stopping it.');
    compose('stop kafka');
    expect(await kafkaReachable()).toBe(false);
    note('verified: the broker refuses connections');

    step('Mutating through the real API (gateway → project-service → PostgreSQL)');
    const run = await mutate('outage');
    note(`HTTP statuses: ${run.statuses.join(', ')}`);
    expect(run.statuses).toEqual([201, 200, 200, 200, 201]);
    const task = await call('GET', `/tasks/${run.taskId}`, { token: run.token });
    expect(task.body).toMatchObject({ title: 'Edited while Kafka is down', version: 4 });
    note(`PostgreSQL has the new state: title "${task.body.title}", version ${task.body.version}`);

    const pending = await outboxFor(run.projectId);
    expect(pending.map((r) => r.event_type)).toEqual([
      'task.created',
      'task.updated',
      'task.moved',
      'task.assigned',
      'comment.created',
    ]);
    expect(pending.every((r) => r.published_at === null)).toBe(true);
    note(`${pending.length} outbox rows, all published_at IS NULL`);

    step('Waiting for the running publisher to try (and fail) to deliver');
    const attempted = await waitFor(
      async () => (await outboxFor(run.projectId)).find((r) => r.attempt_count > 0),
      {
        timeoutMs: 120_000,
        description: 'a recorded publish attempt',
      },
    );
    note(
      `attempt recorded: attempts=${attempted.attempt_count}, last_error="${attempted.last_error?.slice(0, 90)}…"`,
    );

    step('Starting Kafka again');
    compose('start kafka');
    await waitForKafka(BROKERS, 180_000);
    note('broker serving metadata');

    step('Waiting for the publisher to drain the backlog on its own');
    const started = Date.now();
    await waitFor(
      async () => (await outboxFor(run.projectId)).every((r) => r.published_at !== null),
      {
        timeoutMs: 180_000,
        description: 'all rows published',
      },
    );
    note(
      `all ${pending.length} rows published ${Date.now() - started} ms after the broker was back`,
    );

    step('A probe consumer reads them from Kafka');
    const consumed = await consumeUntil(pending.map((r) => r.event_id));
    for (const row of pending) {
      const event = consumed.find((e) => e.eventId === row.event_id)!;
      expect(event.correlationId).toBe(row.correlation_id);
      expect(event.aggregateVersion).toBe(row.aggregate_version);
    }
    note(`all ${pending.length} events received with unchanged eventId and correlationId`);
    const taskVersions = consumed
      .filter((e) => e.aggregateType === 'task')
      .map((e) => e.aggregateVersion);
    expect([...new Set(taskVersions)]).toEqual([1, 2, 3, 4]);
  });

  it('Kafka AND the publisher down → mutations still commit; both back → events delivered', async () => {
    step('Stopping kafka and outbox-publisher');
    compose('stop kafka outbox-publisher');
    const run = await mutate('both-down');
    expect(run.statuses).toEqual([201, 200, 200, 200, 201]);
    const pending = await outboxFor(run.projectId);
    expect(pending.every((r) => r.published_at === null && r.attempt_count === 0)).toBe(true);
    note(`${pending.length} events pending, never attempted (no publisher running)`);

    step('Starting both');
    compose('start kafka');
    await waitForKafka(BROKERS, 180_000);
    compose('start outbox-publisher');
    await waitFor(
      async () => (await outboxFor(run.projectId)).every((r) => r.published_at !== null),
      {
        timeoutMs: 180_000,
        description: 'all rows published',
      },
    );
    const consumed = await consumeUntil(pending.map((r) => r.event_id));
    expect(new Set(consumed.map((e) => e.eventId)).size).toBe(pending.length);
    note(`all ${pending.length} events delivered after recovery`);
  });
});
