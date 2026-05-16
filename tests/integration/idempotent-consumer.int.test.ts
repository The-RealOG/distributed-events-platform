import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { taskEvents, type DomainEvent } from '@dpp/contracts';
import {
  createDatabase,
  createIdempotentHandler,
  isEventProcessed,
  processEventOnce,
  runMigrations,
  sql,
  type ConsumerOutcome,
  type DatabaseHandle,
  type DbTransaction,
} from '@dpp/database';
import {
  createKafkaClient,
  DomainEventConsumer,
  DomainEventProducer,
  ensureTopics,
  type EventHandler,
} from '@dpp/kafka';
import {
  startKafka,
  startPostgres,
  waitFor,
  type StartedKafka,
  type StartedPostgres,
} from '@dpp/test-utils';
import type { Kafka } from 'kafkajs';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Phase 5 (ADR-013): a logical consumer applies each event's side effects once, although Kafka
 * delivers at least once. Real PostgreSQL for the transaction/race guarantees, real Kafka for
 * redelivery and offset behaviour.
 *
 * The side effect under test is a row in consumer_side_effects, a table with NO unique
 * constraint: if processing ran twice, two rows would exist.
 */
let postgres: StartedPostgres;
let broker: StartedKafka;
let database: DatabaseHandle;
let kafka: Kafka;
const lines: Record<string, unknown>[] = [];
const poolErrors: Error[] = [];
const logger = pino(
  { level: 'debug' },
  { write: (l: string) => void lines.push(JSON.parse(l) as Record<string, unknown>) },
);

beforeAll(async () => {
  [postgres, broker] = await Promise.all([startPostgres(), startKafka()]);
  await runMigrations(postgres.url);
  database = createDatabase({
    connectionString: postgres.url,
    applicationName: 'idempotency-test',
    maxConnections: 20,
    // The crash test kills its own session; the pool reports that dropped client here (as
    // services log it) instead of as an unhandled error.
    onPoolError: (err) => poolErrors.push(err),
  });
  await database.pool.query(`
    CREATE TABLE consumer_side_effects (
      id bigserial PRIMARY KEY,
      consumer_name text NOT NULL,
      event_id uuid NOT NULL
    )`);
  kafka = createKafkaClient({ clientId: 'idempotency-test', brokers: broker.brokers, logger });
});

afterAll(async () => {
  await database?.close();
  await broker?.stop();
  await postgres?.stop();
});

// ---------------------------------------------------------------------------------------------

const consumerName = () => `test-consumer-${randomUUID().slice(0, 8)}`;

function newEvent(projectId = randomUUID()): DomainEvent {
  return taskEvents.created(
    { producer: 'project-service', correlationId: `corr-${randomUUID()}` },
    randomUUID(),
    {
      id: randomUUID(),
      projectId,
      columnId: randomUUID(),
      title: 'private title',
      position: '1024',
      version: 1,
    },
  );
}

async function applyEffect(tx: DbTransaction, consumer: string, event: DomainEvent) {
  await tx.execute(
    sql`INSERT INTO consumer_side_effects (consumer_name, event_id) VALUES (${consumer}, ${event.eventId})`,
  );
}

async function effects(consumer: string, eventId: string): Promise<number> {
  const r = await database.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM consumer_side_effects WHERE consumer_name = $1 AND event_id = $2',
    [consumer, eventId],
  );
  return r.rows[0]!.n;
}

async function markers(eventId: string): Promise<string[]> {
  const r = await database.pool.query<{ consumer_name: string }>(
    'SELECT consumer_name FROM processed_events WHERE event_id = $1 ORDER BY consumer_name',
    [eventId],
  );
  return r.rows.map((row) => row.consumer_name);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

// ---------------------------------------------------------------------------------------------

describe('processEventOnce (real PostgreSQL)', () => {
  it('first delivery applies the side effect and records the marker together', async () => {
    const c = consumerName();
    const event = newEvent();
    expect(
      await processEventOnce(database.db, { consumerName: c, event }, (tx) =>
        applyEffect(tx, c, event),
      ),
    ).toBe('processed');
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);
    expect(await isEventProcessed(database.db, c, event.eventId)).toBe(true);
  });

  it('a redelivered event is recognised: the side effect is not repeated', async () => {
    const c = consumerName();
    const event = newEvent();
    let calls = 0;
    const work = async (tx: DbTransaction) => {
      calls++;
      await applyEffect(tx, c, event);
    };
    const outcomes = [];
    for (let i = 0; i < 3; i++) {
      outcomes.push(await processEventOnce(database.db, { consumerName: c, event }, work));
    }
    expect(outcomes).toEqual(['processed', 'duplicate', 'duplicate']);
    expect(calls).toBe(1);
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);
  });

  it('different logical consumers each process the same event exactly once', async () => {
    const [a, b] = [`a-${consumerName()}`, `b-${consumerName()}`];
    const event = newEvent();
    const outcomes: Record<string, string[]> = { [a]: [], [b]: [] };
    for (const c of [a, b, a, b]) {
      outcomes[c]!.push(
        await processEventOnce(database.db, { consumerName: c, event }, (tx) =>
          applyEffect(tx, c, event),
        ),
      );
    }
    expect(outcomes).toEqual({ [a]: ['processed', 'duplicate'], [b]: ['processed', 'duplicate'] });
    expect(await effects(a, event.eventId)).toBe(1);
    expect(await effects(b, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([a, b]);
  });

  it('a failing handler rolls back its side effect and the marker; the redelivery then succeeds', async () => {
    const c = consumerName();
    const event = newEvent();
    await expect(
      processEventOnce(database.db, { consumerName: c, event }, async (tx) => {
        await applyEffect(tx, c, event);
        throw new Error('handler failed after writing');
      }),
    ).rejects.toThrow('handler failed after writing');
    expect(await effects(c, event.eventId)).toBe(0);
    expect(await markers(event.eventId)).toEqual([]);

    expect(
      await processEventOnce(database.db, { consumerName: c, event }, (tx) =>
        applyEffect(tx, c, event),
      ),
    ).toBe('processed');
    expect(await effects(c, event.eventId)).toBe(1);
  });

  it('a crash before COMMIT (connection killed mid-transaction) leaves no side effect and no marker', async () => {
    const c = consumerName();
    const event = newEvent();
    await expect(
      processEventOnce(database.db, { consumerName: c, event }, async (tx) => {
        await applyEffect(tx, c, event);
        // The database session dies with the transaction open, as when the process crashes.
        await tx.execute(sql`SELECT pg_terminate_backend(pg_backend_pid())`);
      }),
    ).rejects.toThrow();
    expect(await effects(c, event.eventId)).toBe(0);
    expect(await markers(event.eventId)).toEqual([]);

    expect(
      await processEventOnce(database.db, { consumerName: c, event }, (tx) =>
        applyEffect(tx, c, event),
      ),
    ).toBe('processed');
    expect(await effects(c, event.eventId)).toBe(1);
  });

  it('concurrent duplicates: the second waits on the first and is skipped once it commits', async () => {
    const c = consumerName();
    const event = newEvent();
    const firstInside = deferred();
    const releaseFirst = deferred();
    let secondCalls = 0;

    const first = processEventOnce(database.db, { consumerName: c, event }, async (tx) => {
      await applyEffect(tx, c, event);
      firstInside.resolve();
      await releaseFirst.promise; // hold the transaction open
    });
    await firstInside.promise;
    const second = processEventOnce(database.db, { consumerName: c, event }, async (tx) => {
      secondCalls++;
      await applyEffect(tx, c, event);
    });

    // While the first is uncommitted, the second must not run its side effect (a SELECT-then-
    // INSERT check would see no marker yet and run it).
    await sleep(750);
    expect(secondCalls).toBe(0);

    releaseFirst.resolve();
    expect(await Promise.all([first, second])).toEqual(['processed', 'duplicate']);
    expect(secondCalls).toBe(0);
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);
  });

  it('concurrent duplicates: if the first rolls back, the waiting one processes the event', async () => {
    const c = consumerName();
    const event = newEvent();
    const firstInside = deferred();
    const releaseFirst = deferred();

    const first = processEventOnce(database.db, { consumerName: c, event }, async (tx) => {
      await applyEffect(tx, c, event);
      firstInside.resolve();
      await releaseFirst.promise;
      throw new Error('first replica failed');
    });
    await firstInside.promise;
    const second = processEventOnce(database.db, { consumerName: c, event }, (tx) =>
      applyEffect(tx, c, event),
    );
    await sleep(250);
    releaseFirst.resolve();

    await expect(first).rejects.toThrow('first replica failed');
    expect(await second).toBe('processed');
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);
  });

  it('ten replicas racing on one event: exactly one side effect', async () => {
    const c = consumerName();
    const event = newEvent();
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        processEventOnce(database.db, { consumerName: c, event }, async (tx) => {
          await applyEffect(tx, c, event);
          await sleep(20); // widen the window
        }),
      ),
    );
    expect(outcomes.filter((o) => o === 'processed')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(9);
    expect(await effects(c, event.eventId)).toBe(1);
  });

  it('the database enforces one marker per (consumer, event), not per event', async () => {
    const eventId = randomUUID();
    const insert = (consumer: string) =>
      database.pool.query(
        `INSERT INTO processed_events (consumer_name, event_id, event_type) VALUES ($1, $2, 'task.created')`,
        [consumer, eventId],
      );
    await insert('consumer-a');
    await expect(insert('consumer-a')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('consumer-b')).resolves.toBeDefined();
    // A non-logical name (host-style) is refused by the database as well.
    await expect(insert('ip-10-40-0-12.us-east-2.compute.internal')).rejects.toMatchObject({
      code: '23514',
    });
  });
});

// ---------------------------------------------------------------------------------------------

async function createTopic(): Promise<string> {
  const name = `test.idempotency.${randomUUID()}`;
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopics(admin, [{ name, numPartitions: 3, replicationFactor: 1, config: {} }]);
  await admin.disconnect();
  return name;
}

async function startConsumer(
  group: string,
  topic: string,
  handler: EventHandler,
  onInvalid?: () => void,
): Promise<DomainEventConsumer> {
  const consumer = new DomainEventConsumer({
    kafka,
    logger,
    groupId: group,
    topics: [topic],
    fromBeginning: true,
    handler,
    hooks: onInvalid ? { onInvalidMessage: onInvalid } : {},
  });
  const joined = consumer.nextGroupJoin();
  await consumer.start();
  await joined;
  return consumer;
}

async function publish(topic: string, ...events: DomainEvent[]) {
  const producer = new DomainEventProducer({ kafka, logger, topic });
  await producer.connect();
  for (const event of events) await producer.publish(event);
  await producer.close();
}

describe('idempotent consumer on Kafka (real broker)', { timeout: 180_000 }, () => {
  it('duplicate delivery (the same event twice on the topic): handled twice, applied once', async () => {
    const topic = await createTopic();
    const c = consumerName();
    const event = newEvent();
    await publish(topic, event, event); // the Phase-4 ack-before-mark duplicate: same eventId

    const outcomes: ConsumerOutcome[] = [];
    const consumer = await startConsumer(
      c,
      topic,
      createIdempotentHandler({
        db: database.db,
        consumerName: c,
        logger,
        handle: (e, tx) => applyEffect(tx, c, e),
        onOutcome: (o) => outcomes.push(o),
      }),
    );
    await waitFor(() => outcomes.length >= 2, { timeoutMs: 60_000, description: 'two deliveries' });
    await consumer.stop();

    expect(outcomes).toEqual(['processed', 'duplicate']);
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);

    // Logged with its coordinates and correlation ID, and without the payload.
    const skipped = lines.find(
      (l) => l['msg'] === 'duplicate event skipped' && l['eventId'] === event.eventId,
    );
    expect(skipped).toMatchObject({
      consumer: c,
      eventType: 'task.created',
      correlationId: event.correlationId,
      topic,
      partition: expect.any(Number),
      offset: expect.any(String),
    });
    expect(JSON.stringify(skipped)).not.toContain('private title');
  });

  it('DB commit succeeded but the offset commit was lost: the redelivery does not repeat the side effect', async () => {
    const topic = await createTopic();
    const c = consumerName();
    const event = newEvent();

    // Replica A commits the transaction, then dies before Kafka records the offset.
    let aDeliveries = 0;
    const replicaA = createIdempotentHandler({
      db: database.db,
      consumerName: c,
      logger,
      handle: (e, tx) => applyEffect(tx, c, e),
    });
    const a = await startConsumer(c, topic, async (e, m) => {
      await replicaA(e, m);
      aDeliveries++;
      throw new Error('simulated crash after DB commit, before offset commit');
    });
    await publish(topic, event);
    await waitFor(() => aDeliveries >= 1, { timeoutMs: 60_000, description: 'replica A delivery' });
    await a.stop();
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);

    // Replica B (a new process, same logical consumer) is sent the event again.
    const bOutcomes: ConsumerOutcome[] = [];
    const b = await startConsumer(
      c,
      topic,
      createIdempotentHandler({
        db: database.db,
        consumerName: c,
        logger,
        handle: (e, tx) => applyEffect(tx, c, e),
        onOutcome: (o) => bOutcomes.push(o),
      }),
    );
    await waitFor(() => bOutcomes.length >= 1, {
      timeoutMs: 60_000,
      description: 'redelivery to B',
    });
    await b.stop();

    expect(bOutcomes[0]).toBe('duplicate');
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);
  });

  it('crash before the DB commit: nothing persists, and the redelivery processes the event', async () => {
    const topic = await createTopic();
    const c = consumerName();
    const event = newEvent();

    let aAttempts = 0;
    const a = await startConsumer(
      c,
      topic,
      createIdempotentHandler({
        db: database.db,
        consumerName: c,
        logger,
        handle: async (e, tx) => {
          await applyEffect(tx, c, e);
          aAttempts++;
          throw new Error('simulated crash before commit');
        },
      }),
    );
    await publish(topic, event);
    await waitFor(() => aAttempts >= 1, { timeoutMs: 60_000, description: 'replica A attempt' });
    await a.stop();
    expect(await effects(c, event.eventId)).toBe(0);
    expect(await markers(event.eventId)).toEqual([]);

    const bOutcomes: ConsumerOutcome[] = [];
    const b = await startConsumer(
      c,
      topic,
      createIdempotentHandler({
        db: database.db,
        consumerName: c,
        logger,
        handle: (e, tx) => applyEffect(tx, c, e),
        onOutcome: (o) => bOutcomes.push(o),
      }),
    );
    await waitFor(() => bOutcomes.includes('processed'), {
      timeoutMs: 60_000,
      description: 'redelivery processed by B',
    });
    await b.stop();
    expect(await effects(c, event.eventId)).toBe(1);
    expect(await markers(event.eventId)).toEqual([c]);
  });

  it('malformed messages are skipped without a processed marker; valid events are still processed once', async () => {
    const topic = await createTopic();
    const c = consumerName();
    const projectId = randomUUID();
    const event = newEvent(projectId);
    const forgedId = randomUUID();

    const raw = kafka.producer();
    await raw.connect();
    await raw.send({
      topic,
      messages: [
        { key: projectId, value: '{ not json' },
        // Looks like an event (has an eventId) but fails the contract.
        { key: projectId, value: JSON.stringify({ eventId: forgedId, eventType: 'task.created' }) },
      ],
    });
    await raw.disconnect();
    await publish(topic, event);

    let invalid = 0;
    const outcomes: ConsumerOutcome[] = [];
    const consumer = await startConsumer(
      c,
      topic,
      createIdempotentHandler({
        db: database.db,
        consumerName: c,
        logger,
        handle: (e, tx) => applyEffect(tx, c, e),
        onOutcome: (o) => outcomes.push(o),
      }),
      () => invalid++,
    );
    await waitFor(() => outcomes.length >= 1 && invalid >= 2, {
      timeoutMs: 60_000,
      description: 'two malformed messages skipped and one event processed',
    });
    await consumer.stop();

    expect(outcomes).toEqual(['processed']);
    expect(await markers(forgedId)).toEqual([]);
    expect(await effects(c, forgedId)).toBe(0);
    expect(await markers(event.eventId)).toEqual([c]);
    expect(await effects(c, event.eventId)).toBe(1);
  });
});
