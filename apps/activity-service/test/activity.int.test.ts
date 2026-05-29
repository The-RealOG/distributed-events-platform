import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@dpp/contracts';
import {
  createDatabase,
  createIdempotentHandler,
  runMigrations,
  type DatabaseHandle,
} from '@dpp/database';
import { createKafkaClient, DomainEventProducer, ensureTopics } from '@dpp/kafka';
import { createIsolatedDatabase, waitFor } from '@dpp/test-utils';
import type { Kafka } from 'kafkajs';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { recordActivity } from '../src/projection.js';
import { CONSUMER_NAME, createActivityWorker } from '../src/worker.js';
import { eventsForTask } from './events.js';

/**
 * The Activity Service against real PostgreSQL and Kafka: Kafka → processEventOnce →
 * activity_events. Each test uses its own topic; all share the real group name
 * `activity-service`, as replicas do.
 */
let url: string;
let database: DatabaseHandle;
let kafka: Kafka;
const lines: Record<string, unknown>[] = [];
const logger = pino(
  { level: 'debug' },
  { write: (l: string) => void lines.push(JSON.parse(l) as Record<string, unknown>) },
);

beforeAll(async () => {
  url = await createIsolatedDatabase(inject('postgresUrl'));
  await runMigrations(url);
  database = createDatabase({
    connectionString: url,
    applicationName: 'activity-test',
    maxConnections: 10,
  });
  kafka = createKafkaClient({ clientId: 'activity-test', brokers: inject('kafkaBrokers'), logger });
});
afterAll(() => database?.close());

async function createTopic(): Promise<string> {
  const name = `test.activity.${randomUUID()}`;
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopics(admin, [{ name, numPartitions: 3, replicationFactor: 1, config: {} }]);
  await admin.disconnect();
  return name;
}

async function publish(topic: string, events: DomainEvent[]) {
  const producer = new DomainEventProducer({ kafka, logger, topic });
  await producer.connect();
  for (const event of events) await producer.publish(event);
  await producer.close();
}

async function startWorker(topic: string) {
  const worker = createActivityWorker({ kafka, db: database.db, logger, topics: [topic] });
  const joined = worker.consumer.nextGroupJoin();
  await worker.consumer.start();
  await joined;
  return worker;
}

interface Row {
  id: string;
  event_id: string;
  project_id: string;
  event_type: string;
  aggregate_version: number;
  correlation_id: string;
  data: Record<string, unknown>;
}
async function activity(projectId: string): Promise<Row[]> {
  const r = await database.pool.query<Row>(
    'SELECT id::text, event_id, project_id, event_type, aggregate_version, correlation_id, data FROM activity_events WHERE project_id = $1 ORDER BY activity_events.id',
    [projectId],
  );
  return r.rows;
}
async function markers(eventIds: string[]): Promise<number> {
  const r = await database.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM processed_events WHERE consumer_name = $1 AND event_id = ANY($2::uuid[])',
    [CONSUMER_NAME, eventIds],
  );
  return r.rows[0]!.n;
}
const waitForRows = (projectId: string, n: number) =>
  waitFor(async () => (await activity(projectId)).length >= n, {
    timeoutMs: 60_000,
    description: `${n} activity rows for ${projectId}`,
  });

describe('projection through Kafka', () => {
  it('records every event type once, in the project’s event order, with its correlation ID', async () => {
    const topic = await createTopic();
    const projectId = randomUUID();
    const events = eventsForTask(projectId, { correlationId: 'corr-from-request' });
    await publish(topic, events);
    const worker = await startWorker(topic);
    await waitForRows(projectId, events.length);
    await worker.consumer.stop();

    const rows = await activity(projectId);
    // Persisted order (id) = the project's partition order = the order the events were written.
    expect(rows.map((r) => [r.event_id, r.event_type])).toEqual(
      events.map((e) => [e.eventId, e.eventType]),
    );
    expect(rows.map((r) => r.aggregate_version)).toEqual(events.map((e) => e.aggregateVersion));
    expect(new Set(rows.map((r) => r.correlation_id))).toEqual(new Set(['corr-from-request']));
    expect(await markers(events.map((e) => e.eventId))).toBe(events.length);
    expect(worker.stats).toMatchObject({ processed: events.length, duplicate: 0, failed: 0 });

    // Traceable in the logs: consumer, event, correlation, project and Kafka coordinates.
    const line = lines.find(
      (l) => l['msg'] === 'event processed' && l['eventId'] === events[0]!.eventId,
    );
    expect(line).toMatchObject({
      consumer: CONSUMER_NAME,
      eventType: 'task.created',
      correlationId: 'corr-from-request',
      projectId,
      topic,
      partition: expect.any(Number),
      offset: expect.any(String),
    });
  });

  it('keeps projects apart: each project’s history holds only its own events', async () => {
    const topic = await createTopic();
    const [a, b] = [randomUUID(), randomUUID()];
    const [ea, eb] = [eventsForTask(a).slice(0, 3), eventsForTask(b).slice(0, 2)];
    await publish(topic, [ea[0]!, eb[0]!, ea[1]!, eb[1]!, ea[2]!]);
    const worker = await startWorker(topic);
    await waitForRows(a, 3);
    await waitForRows(b, 2);
    await worker.consumer.stop();
    expect((await activity(a)).map((r) => r.event_id)).toEqual(ea.map((e) => e.eventId));
    expect((await activity(b)).map((r) => r.event_id)).toEqual(eb.map((e) => e.eventId));
  });
});

describe('duplicates', () => {
  it('E123, E123, E124 on the topic → one activity entry for E123, and the consumer moves on', async () => {
    const topic = await createTopic();
    const projectId = randomUUID();
    const [e123, e124] = eventsForTask(projectId);
    await publish(topic, [e123!, e123!, e124!]);
    const worker = await startWorker(topic);
    await waitForRows(projectId, 2);
    await waitFor(() => worker.stats.processed + worker.stats.duplicate >= 3, {
      timeoutMs: 30_000,
      description: 'three deliveries handled',
    });
    await worker.consumer.stop();

    expect((await activity(projectId)).map((r) => r.event_id)).toEqual([
      e123!.eventId,
      e124!.eventId,
    ]);
    expect(worker.stats).toMatchObject({ processed: 2, duplicate: 1, failed: 0 });
  });

  it('the same event handled concurrently by two replicas (separate connection pools): one entry', async () => {
    const projectId = randomUUID();
    const [event] = eventsForTask(projectId);
    const replicaPools = [0, 1].map(() =>
      createDatabase({ connectionString: url, applicationName: 'replica', maxConnections: 5 }),
    );
    const outcomes: string[] = [];
    const handlers = replicaPools.map((pool) =>
      createIdempotentHandler({
        db: pool.db,
        consumerName: CONSUMER_NAME,
        logger,
        handle: (e, tx) => recordActivity(tx, e),
        onOutcome: (o) => outcomes.push(o),
      }),
    );
    const meta = { topic: 'domain.events', partition: 0, offset: '1' };
    await Promise.all(Array.from({ length: 8 }, (_, i) => handlers[i % 2]!(event!, meta)));
    await Promise.all(replicaPools.map((p) => p.close()));

    expect(await activity(projectId)).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'processed')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(7);
  });
});

describe('failures', () => {
  it('skips malformed messages without recording anything and keeps processing valid events', async () => {
    const topic = await createTopic();
    const projectId = randomUUID();
    const [event] = eventsForTask(projectId);
    const raw = kafka.producer();
    await raw.connect();
    await raw.send({
      topic,
      messages: [
        { key: projectId, value: 'not json' },
        {
          key: projectId,
          value: JSON.stringify({ eventId: randomUUID(), eventType: 'task.created' }),
        },
      ],
    });
    await raw.disconnect();
    await publish(topic, [event!]);
    const worker = await startWorker(topic);
    await waitForRows(projectId, 1);
    await worker.consumer.stop();
    expect(await activity(projectId)).toHaveLength(1);
    expect(worker.stats).toMatchObject({ processed: 1, failed: 0 });
  });

  it('a database failure rolls back the entry and its marker; the event is applied once the database recovers', async () => {
    const topic = await createTopic();
    const projectId = randomUUID();
    const [event] = eventsForTask(projectId);
    // The activity insert fails for this project only (a stand-in for a database error).
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_activity() RETURNS trigger AS $$
      BEGIN
        IF NEW.project_id = '${projectId}' THEN RAISE EXCEPTION 'injected activity failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_activity BEFORE INSERT ON activity_events
        FOR EACH ROW EXECUTE FUNCTION fail_activity();`);
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    try {
      await publish(topic, [event!]);
      worker = await startWorker(topic);
      await waitFor(() => worker!.stats.failed >= 1, {
        timeoutMs: 30_000,
        description: 'a failed attempt',
      });
      expect(await activity(projectId)).toHaveLength(0);
      expect(await markers([event!.eventId])).toBe(0);
    } finally {
      await database.pool.query('DROP TRIGGER IF EXISTS fail_activity ON activity_events');
    }
    // Not acknowledged, so Kafka redelivers it; now it succeeds, exactly once.
    await waitForRows(projectId, 1);
    await worker.consumer.stop();
    expect(await activity(projectId)).toHaveLength(1);
    expect(await markers([event!.eventId])).toBe(1);
  });
});

describe('downtime and catch-up', () => {
  it('events published while the service is down are applied after restart, in order, once each', async () => {
    const topic = await createTopic();
    const projectId = randomUUID();
    const events = eventsForTask(projectId);
    await publish(topic, events.slice(0, 2));
    const first = await startWorker(topic);
    await waitForRows(projectId, 2);
    await first.consumer.stop();

    // Service down: writes continue upstream; the events wait in Kafka.
    await publish(topic, events.slice(2));
    expect(await activity(projectId)).toHaveLength(2);

    const second = await startWorker(topic);
    await waitForRows(projectId, events.length);
    // Give any (wrong) redelivery of the first two a chance to show up as a duplicate row.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await second.consumer.stop();

    const rows = await activity(projectId);
    expect(rows.map((r) => r.event_id)).toEqual(events.map((e) => e.eventId));
    expect(second.stats.processed).toBe(events.length - 2);
  });
});
