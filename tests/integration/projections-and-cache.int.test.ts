import { randomUUID } from 'node:crypto';
import { createRedisClient } from '@dpp/cache';
import type { DomainEvent } from '@dpp/contracts';
import { createDatabase, runMigrations } from '@dpp/database';
import { createKafkaClient, DomainEventProducer, ensureTopics, TOPICS } from '@dpp/kafka';
import {
  startKafka,
  startPostgres,
  startRedis,
  waitFor,
  type StartedKafka,
  type StartedPostgres,
  type StartedRedis,
} from '@dpp/test-utils';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startService, type ServiceProcess } from './processes.js';

/**
 * The activity projection and the board cache with real processes and real PostgreSQL, Kafka and Valkey:
 *
 *   HTTP → gateway → project-service (A) → PostgreSQL (change + outbox)
 *   outbox-publisher → Kafka → activity-service → activity_events
 *                           → cache-invalidator → Redis DEL board:{projectId}
 *   project-service A and B share one Redis (board cache-aside reads).
 */
let postgres: StartedPostgres;
let kafka: StartedKafka;
let redis: StartedRedis;
let database: ReturnType<typeof createDatabase>;
let replicaA: ServiceProcess;
let replicaB: ServiceProcess;
let gateway: ServiceProcess;
let publisher: ServiceProcess;
let activity: ServiceProcess | undefined;
let invalidator: ServiceProcess | undefined;

const JWT_SECRET = 'cache-test-secret-cache-test-secret!!';
const kafkaEnv = (clientId: string) => ({
  KAFKA_BROKERS: kafka.brokers.join(','),
  KAFKA_CLIENT_ID: clientId,
});
const projectServiceEnv = () => ({
  DATABASE_URL: postgres.url,
  JWT_SECRET,
  AUTH_DEV_LOGIN_ENABLED: 'true',
  DEPLOYMENT_ENVIRONMENT: 'test',
  CACHE_ENABLED: 'true',
  REDIS_URL: redis.url,
  CACHE_TTL_SECONDS: '300',
  // These tests assert cache states (HIT, MISS), not latency. With the 250 ms production timeout,
  // one slow Redis reply on a loaded runner reads as BYPASS (the designed fallback) and fails an
  // assertion about invalidation. Redis outages are covered by their own suites.
  CACHE_COMMAND_TIMEOUT_MS: '2000',
});
const startActivity = async () =>
  (activity = await startService('activity-service', {
    DATABASE_URL: postgres.url,
    ...kafkaEnv('activity-service'),
  }));
const startInvalidator = async () =>
  (invalidator = await startService('cache-invalidator', {
    REDIS_URL: redis.url,
    ...kafkaEnv('cache-invalidator'),
  }));

beforeAll(async () => {
  [postgres, kafka, redis] = await Promise.all([startPostgres(), startKafka(), startRedis()]);
  await runMigrations(postgres.url);
  database = createDatabase({
    connectionString: postgres.url,
    applicationName: 'p67',
    maxConnections: 2,
  });
  const client = createKafkaClient({
    clientId: 'p67',
    brokers: kafka.brokers,
    logger: pino({ level: 'silent' }),
  });
  const admin = client.admin();
  await admin.connect();
  await ensureTopics(admin, [TOPICS.domainEvents, TOPICS.domainEventsDlq]);
  await admin.disconnect();

  [replicaA, replicaB] = await Promise.all([
    startService('project-service', projectServiceEnv()),
    startService('project-service', projectServiceEnv()),
  ]);
  gateway = await startService('api-gateway', { PROJECT_SERVICE_URL: replicaA.url, JWT_SECRET });
  publisher = await startService('outbox-publisher', {
    DATABASE_URL: postgres.url,
    ...kafkaEnv('outbox-publisher'),
    OUTBOX_POLL_INTERVAL_MS: '100',
    OUTBOX_BACKOFF_BASE_MS: '200',
    OUTBOX_BACKOFF_MAX_MS: '2000',
  });
  await Promise.all([startActivity(), startInvalidator()]);
}, 300_000);

afterAll(async () => {
  for (const svc of [activity, invalidator, publisher, gateway, replicaA, replicaB])
    await svc?.stop();
  await database?.close();
  await Promise.all([kafka?.stop(), redis?.stop(), postgres?.stop()]);
});

// ---------------------------------------------------------------------------------------------

interface Call {
  status: number;
  body: any;
  cache: string | null;
  ms: number;
}
async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; correlationId?: string | undefined; base?: string } = {},
): Promise<Call> {
  const started = performance.now();
  const res = await fetch(`${opts.base ?? `${gateway.url}/api`}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.correlationId ? { 'x-correlation-id': opts.correlationId } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const body = await res.json().catch(() => undefined);
  return {
    status: res.status,
    body,
    cache: res.headers.get('x-board-cache'),
    ms: performance.now() - started,
  };
}

async function login(name = 'user') {
  const res = await call('POST', '/auth/dev-login', {
    body: { email: `${name}-${randomUUID()}@example.com`, displayName: name },
  });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function newProject() {
  const owner = await login('owner');
  const ws = await call('POST', '/workspaces', { token: owner.token, body: { name: 'W' } });
  const project = await call('POST', '/projects', {
    token: owner.token,
    body: { workspaceId: ws.body.id, name: 'P' },
  });
  const projectId = project.body.id as string;
  const board = await call('GET', `/projects/${projectId}/board`, { token: owner.token });
  const columns = board.body.columns.map((c: { id: string }) => c.id) as string[];
  return { owner, projectId, columns, workspaceId: ws.body.id as string };
}
type Project = Awaited<ReturnType<typeof newProject>>;

async function createTask(p: Project, title: string, correlationId?: string) {
  const res = await call('POST', '/tasks', {
    token: p.owner.token,
    correlationId,
    body: { projectId: p.projectId, columnId: p.columns[0], title },
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number };
}

const board = (p: Project, base?: string) =>
  call('GET', `/projects/${p.projectId}/board`, {
    token: p.owner.token,
    ...(base ? { base } : {}),
  });
const titles = (b: Call) =>
  (b.body.columns as { tasks: { title: string }[] }[]).flatMap((c) => c.tasks.map((t) => t.title));
const activityOf = async (p: Project) =>
  (await call('GET', `/projects/${p.projectId}/activity?limit=100`, { token: p.owner.token })).body
    .items as { eventId: string; eventType: string; correlationId: string }[];

/** Waits until the invalidator has handled everything published so far (its lag is zero). */
async function invalidatorCaughtUp() {
  const probe = await newProject();
  await createTask(probe, 'probe');
  await board(probe); // fill
  await createTask(probe, 'probe-2');
  await waitFor(
    async () =>
      (await board(probe)).cache === 'MISS' && titles(await board(probe)).includes('probe-2'),
    {
      timeoutMs: 60_000,
      description: 'invalidator caught up',
    },
  );
}

// ---------------------------------------------------------------------------------------------

describe('activity is an eventually consistent projection', { timeout: 180_000 }, () => {
  it('a change succeeds at once; its activity appears later, with the request’s correlation ID, newest first', async () => {
    const p = await newProject();
    const task = await createTask(p, 'Draft', 'corr-activity-create');
    const moved = await call('POST', `/tasks/${task.id}/move`, {
      token: p.owner.token,
      correlationId: 'corr-activity-move',
      body: { expectedVersion: 1, columnId: p.columns[1], afterTaskId: null },
    });
    expect(moved.status).toBe(200);

    const items = await waitFor(
      async () => {
        const list = await activityOf(p);
        return list.length >= 2 ? list : undefined;
      },
      { timeoutMs: 60_000, description: 'activity projected' },
    );
    expect(items.map((i) => [i.eventType, i.correlationId])).toEqual([
      ['task.moved', 'corr-activity-move'],
      ['task.created', 'corr-activity-create'],
    ]);
    // The same correlation ID is in the Activity Service's own logs.
    expect(
      activity!.logs.some(
        (l) => l['correlationId'] === 'corr-activity-move' && l['consumer'] === 'activity-service',
      ),
    ).toBe(true);
  });

  it('Activity Service down: writes keep working; after restart the backlog is applied once, in order', async () => {
    const p = await newProject();
    const first = await createTask(p, 'Before outage');
    await waitFor(async () => (await activityOf(p)).length === 1, {
      timeoutMs: 60_000,
      description: 'first activity',
    });

    await activity!.stop();
    activity = undefined;
    const during = [];
    for (const title of ['During 1', 'During 2', 'During 3'])
      during.push(await createTask(p, title));
    const renamed = await call('PATCH', `/tasks/${first.id}`, {
      token: p.owner.token,
      body: { expectedVersion: 1, title: 'Renamed during outage' },
    });
    expect(renamed.status).toBe(200);
    // Domain state is current, the outbox delivered the events to Kafka, activity lags.
    expect(titles(await board(p)).sort()).toEqual([
      'During 1',
      'During 2',
      'During 3',
      'Renamed during outage',
    ]);
    await waitFor(
      async () =>
        (
          await database.pool.query(
            `SELECT count(*)::int AS n FROM outbox_events WHERE partition_key = $1 AND published_at IS NULL`,
            [p.projectId],
          )
        ).rows[0].n === 0,
      { timeoutMs: 30_000, description: 'outbox drained to Kafka' },
    );
    expect(await activityOf(p)).toHaveLength(1);

    await startActivity();
    const items = await waitFor(
      async () => {
        const list = await activityOf(p);
        return list.length >= 5 ? list : undefined;
      },
      { timeoutMs: 60_000, description: 'backlog applied' },
    );
    await new Promise((r) => setTimeout(r, 1_000));
    const final = await activityOf(p);
    expect(final).toHaveLength(5);
    expect(new Set(final.map((i) => i.eventId)).size).toBe(5);
    expect(items.map((i) => i.eventType)).toEqual([
      'task.updated',
      'task.created',
      'task.created',
      'task.created',
      'task.created',
    ]);
  });
});

describe('shared board cache with Kafka-driven invalidation', { timeout: 180_000 }, () => {
  it('miss → hit; the other replica hits the same entry; a change invalidates it for both; then hit again, fresh', async () => {
    const p = await newProject();
    await createTask(p, 'v1');
    await invalidatorCaughtUp();

    const first = await board(p);
    const second = await board(p);
    const onB = await board(p, replicaB.url);
    expect([first.cache, second.cache]).toEqual(['MISS', 'HIT']);
    expect(onB.cache).toBe('HIT'); // replica B never read this board from PostgreSQL
    expect(onB.body).toEqual(first.body);

    const [task] = first.body.columns[0].tasks;
    await call('PATCH', `/tasks/${task.id}`, {
      token: p.owner.token,
      body: { expectedVersion: task.version, title: 'v2' },
    });
    const fresh = await waitFor(
      async () => {
        const b = await board(p, replicaB.url);
        return titles(b).includes('v2') ? b : undefined;
      },
      { timeoutMs: 60_000, description: 'fresh board after invalidation' },
    );
    expect(fresh.cache).toBe('MISS');
    expect((await board(p)).cache).toBe('HIT'); // replica A reuses what B just filled
    expect(titles(await board(p))).toEqual(['v2']);

    // Prometheus view of the same behaviour (counters read from the live process).
    const metricsText = await (await fetch(`${replicaA.url}/metrics`)).text();
    expect(metricsText).toMatch(/cache_operations_total\{[^}]*result="hit"[^}]*\} [1-9]/);
    expect(metricsText).toMatch(/http_requests_total\{[^}]*route="\/projects\/:id\/board"/);
    expect(metricsText).not.toContain(p.projectId); // no per-entity labels
    const invalidatorMetrics = await (await fetch(`${invalidator!.url}/metrics`)).text();
    expect(invalidatorMetrics).toMatch(
      /kafka_consumer_messages_total\{[^}]*consumer="cache-invalidator"[^}]*result="processed"[^}]*\} [1-9]/,
    );

    const statsA = (await call('GET', '/status', { base: replicaA.url })).body.cache;
    expect(statsA.hits).toBeGreaterThan(0);
    expect(statsA.misses).toBeGreaterThan(0);
  });

  it('stale window: with the invalidator paused the cache serves the old board; after it resumes the board converges', async () => {
    const p = await newProject();
    const task = await createTask(p, 'old title');
    await invalidatorCaughtUp();
    await board(p);
    expect((await board(p)).cache).toBe('HIT');

    await invalidator!.stop();
    invalidator = undefined;
    const patched = await call('PATCH', `/tasks/${task.id}`, {
      token: p.owner.token,
      body: { expectedVersion: 1, title: 'new title' },
    });
    expect(patched.status).toBe(200);
    // PostgreSQL has the new state…
    expect((await call('GET', `/tasks/${task.id}`, { token: p.owner.token })).body.title).toBe(
      'new title',
    );
    // …while the cached board is (legitimately, temporarily) stale.
    const stale = await board(p);
    expect([stale.cache, titles(stale)]).toEqual(['HIT', ['old title']]);

    await startInvalidator();
    const fresh = await waitFor(
      async () => {
        const b = await board(p);
        return titles(b).includes('new title') ? b : undefined;
      },
      { timeoutMs: 60_000, description: 'converged after the invalidator resumed' },
    );
    expect(fresh.cache).toBe('MISS');
    const again = await board(p);
    expect([again.cache, titles(again)]).toEqual(['HIT', ['new title']]);
  });

  it('read-your-writes: the writer’s no-cache read is fresh even while invalidation lags; others see the old board until it lands', async () => {
    const p = await newProject();
    const t = await createTask(p, 'mine-old');
    await invalidatorCaughtUp();
    await board(p);
    expect((await board(p)).cache).toBe('HIT');

    await invalidator!.stop();
    invalidator = undefined;
    await call('PATCH', `/tasks/${t.id}`, {
      token: p.owner.token,
      body: { expectedVersion: 1, title: 'mine-new' },
    });
    const own = await fetch(`${gateway.url}/api/projects/${p.projectId}/board`, {
      headers: { authorization: `Bearer ${p.owner.token}`, 'cache-control': 'no-cache' },
    });
    expect(own.headers.get('x-board-cache')).toBe('REFRESH');
    const ownBody = (await own.json()) as { columns: { tasks: { title: string }[] }[] };
    expect(ownBody.columns.flatMap((c) => c.tasks.map((x) => x.title))).toEqual(['mine-new']);
    // The refresh also replaced the shared entry, so other readers are fresh now too.
    const other = await board(p, replicaB.url);
    expect([other.cache, titles(other)]).toEqual(['HIT', ['mine-new']]);

    await startInvalidator();
    await waitFor(async () => (await board(p)).cache === 'MISS', {
      timeoutMs: 60_000,
      description: 'late invalidation still applied',
    });
    expect(titles(await board(p))).toEqual(['mine-new']);
  });

  it('invalidator outage with several changes: all are applied from the backlog; reads converge', async () => {
    const p = await newProject();
    const t = await createTask(p, 'a');
    await invalidatorCaughtUp();
    await board(p);

    await invalidator!.stop();
    invalidator = undefined;
    await call('PATCH', `/tasks/${t.id}`, {
      token: p.owner.token,
      body: { expectedVersion: 1, title: 'a2' },
    });
    await createTask(p, 'b');
    await createTask(p, 'c');
    expect(titles(await board(p))).toEqual(['a']); // stale while nothing invalidates

    await startInvalidator();
    await waitFor(
      async () =>
        titles(await board(p))
          .sort()
          .join() === 'a2,b,c',
      {
        timeoutMs: 60_000,
        description: 'converged',
      },
    );
  });

  it('a change to project A never invalidates project B', async () => {
    const [a, b] = [await newProject(), await newProject()];
    await createTask(a, 'A1');
    await createTask(b, 'B1');
    await invalidatorCaughtUp();
    await board(a);
    await board(b);
    await createTask(a, 'A2');
    await waitFor(async () => titles(await board(a)).includes('A2'), {
      timeoutMs: 60_000,
      description: 'A fresh',
    });
    const bRead = await board(b);
    expect([bRead.cache, titles(bRead)]).toEqual(['HIT', ['B1']]);
    expect(titles(await board(a)).sort()).toEqual(['A1', 'A2']);
  });

  it('a failed (rolled-back) change produces no event and therefore no invalidation', async () => {
    const p = await newProject();
    const t = await createTask(p, 'keep');
    await invalidatorCaughtUp();
    await board(p);
    const conflict = await call('PATCH', `/tasks/${t.id}`, {
      token: p.owner.token,
      body: { expectedVersion: 99, title: 'never' },
    });
    expect(conflict.status).toBe(409);
    await invalidatorCaughtUp(); // everything published so far has been processed
    expect((await board(p)).cache).toBe('HIT');
  });

  it('authorization runs on every read: a cached board is not served to a non-member', async () => {
    const p = await newProject();
    await board(p);
    expect((await board(p)).cache).toBe('HIT');
    const outsider = await login('outsider');
    const denied = await call('GET', `/projects/${p.projectId}/board`, { token: outsider.token });
    expect(denied.status).toBe(403);
    expect(denied.body.columns).toBeUndefined();
  });

  it('duplicate invalidation events are harmless', async () => {
    const p = await newProject();
    const t = await createTask(p, 'dup');
    await invalidatorCaughtUp();
    const before = (await call('GET', '/status', { base: invalidator!.url })).body.stats;
    const event = (
      await database.pool.query<{ event: DomainEvent }>(
        `SELECT event FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence_id LIMIT 1`,
        [t.id],
      )
    ).rows[0]!.event;
    await board(p);
    const producer = new DomainEventProducer({
      kafka: createKafkaClient({
        clientId: 'dup',
        brokers: kafka.brokers,
        logger: pino({ level: 'silent' }),
      }),
      logger: pino({ level: 'silent' }),
    });
    await producer.connect();
    for (let i = 0; i < 3; i++) await producer.publish(event);
    await producer.close();

    await waitFor(
      async () =>
        (await call('GET', '/status', { base: invalidator!.url })).body.stats.invalidated >=
        before.invalidated + 3,
      { timeoutMs: 60_000, description: 'three duplicate deliveries handled' },
    );
    const after = (await call('GET', '/status', { base: invalidator!.url })).body.stats;
    expect(after.failed).toBe(before.failed);
    expect((await board(p)).cache).toBe('MISS');
    expect((await board(p)).cache).toBe('HIT');
  });

  it('failed invalidations are retried until they succeed, never acknowledged', async () => {
    const p = await newProject();
    const t = await createTask(p, 'before');
    await invalidatorCaughtUp();
    await board(p);
    const cached = await board(p);
    expect([cached.cache, titles(cached)]).toEqual(['HIT', ['before']]);

    // Redis stays up for readers, but invalidations fail: INCR (used only by the invalidation
    // script) is denied, so the script errors with NOPERM and deletes nothing.
    const admin = createRedisClient({ url: redis.url, logger: pino({ level: 'silent' }) });
    await waitFor(() => admin.status === 'ready', { description: 'admin connection' });
    await admin.call('ACL', 'SETUSER', 'default', '-incr');
    try {
      await call('PATCH', `/tasks/${t.id}`, {
        token: p.owner.token,
        body: { expectedVersion: 1, title: 'after' },
      });
      await waitFor(
        async () =>
          (await call('GET', '/status', { base: invalidator!.url })).body.stats.failed > 0,
        { timeoutMs: 30_000, description: 'an invalidation failing' },
      );
      const stale = await board(p);
      expect([stale.cache, titles(stale)]).toEqual(['HIT', ['before']]);
    } finally {
      await admin.call('ACL', 'SETUSER', 'default', '+incr');
      admin.disconnect();
    }
    // Not acknowledged, so Kafka redelivers it; once Redis accepts it, reads converge.
    await waitFor(async () => titles(await board(p)).includes('after'), {
      timeoutMs: 60_000,
      description: 'the retried invalidation to land',
    });
  });

  it('Redis outage: board reads fall back to PostgreSQL quickly and correctly; writes are unaffected; caching resumes by itself', async () => {
    const p = await newProject();
    const t = await createTask(p, 'x1');
    await invalidatorCaughtUp();
    await board(p);
    // A real cached entry exists before the outage, so a lost invalidation would leave it stale.
    const cached = await board(p);
    expect([cached.cache, titles(cached)]).toEqual(['HIT', ['x1']]);
    await redis.pause();
    try {
      const read = await board(p);
      expect(read.status).toBe(200);
      expect(read.cache).toBe('BYPASS');
      expect(titles(read)).toEqual(['x1']);
      expect(read.ms).toBeLessThan(3_000);
      const write = await call('PATCH', `/tasks/${t.id}`, {
        token: p.owner.token,
        body: { expectedVersion: 1, title: 'x2' },
      });
      expect(write.status).toBe(200);
      expect(titles(await board(p))).toEqual(['x2']);
      expect(replicaA.rawOutput()).not.toContain(JWT_SECRET);
    } finally {
      await redis.unpause();
    }
    // The invalidation that failed during the outage is retried from Kafka; reads converge.
    await waitFor(
      async () => {
        const b = await board(p);
        return b.cache === 'HIT' && titles(b).includes('x2');
      },
      { timeoutMs: 60_000, description: 'caching resumed with fresh data' },
    );
  });
});
