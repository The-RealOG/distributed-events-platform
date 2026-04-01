import { randomUUID } from 'node:crypto';
import { taskEvents, type DomainEvent } from '@dpp/contracts';
import {
  createDatabase,
  insertOutboxEvent,
  runMigrations,
  type DatabaseHandle,
} from '@dpp/database';
import {
  createKafkaClient,
  DomainEventConsumer,
  DomainEventProducer,
  ensureTopics,
  type MessageMetadata,
} from '@dpp/kafka';
import { createIsolatedDatabase, waitFor } from '@dpp/test-utils';
import type { Kafka } from 'kafkajs';
import { pino, type Logger } from 'pino';
import { inject } from 'vitest';
import { OutboxPublisher, type EventSink, type OutboxPublisherOptions } from '../src/publisher.js';

export type LogLine = Record<string, unknown>;

export interface TestEnv {
  database: DatabaseHandle;
  kafka: Kafka;
  logger: Logger;
  lines: LogLine[];
  brokers: string[];
  close(): Promise<void>;
}

/** A migrated database of this file's own, plus a Kafka client. */
export async function createTestEnv(brokers: string[] = inject('kafkaBrokers')): Promise<TestEnv> {
  const url = await createIsolatedDatabase(inject('postgresUrl'));
  await runMigrations(url);
  const database = createDatabase({
    connectionString: url,
    applicationName: 'publisher-test',
    maxConnections: 10,
    connectionTimeoutMs: 2_000,
    statementTimeoutMs: 2_000,
    queryTimeoutMs: 3_000,
  });
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (l: string) => void lines.push(JSON.parse(l) as LogLine) },
  );
  const kafka = createKafkaClient({
    clientId: `publisher-test-${randomUUID().slice(0, 6)}`,
    brokers,
    logger,
  });
  return { database, kafka, logger, lines, brokers, close: () => database.close() };
}

export async function createTopic(kafka: Kafka): Promise<string> {
  const name = `test.outbox.${randomUUID()}`;
  const admin = kafka.admin();
  await admin.connect();
  await ensureTopics(admin, [{ name, numPartitions: 3, replicationFactor: 1, config: {} }]);
  await admin.disconnect();
  return name;
}

export async function resetOutbox(env: TestEnv): Promise<void> {
  await env.database.pool.query('TRUNCATE outbox_events');
}

export function sinkFor(env: TestEnv, topic: string): DomainEventProducer {
  return new DomainEventProducer({ kafka: env.kafka, logger: env.logger, topic });
}

export function newPublisher(
  env: TestEnv,
  sink: EventSink,
  overrides: Partial<OutboxPublisherOptions> = {},
): OutboxPublisher {
  return new OutboxPublisher({
    db: env.database.db,
    sink,
    logger: env.logger,
    workerId: `worker-${randomUUID().slice(0, 8)}`,
    batchSize: 50,
    pollIntervalMs: 50,
    leaseMs: 30_000,
    backoff: { baseMs: 100, maxMs: 1_000 },
    ...overrides,
  });
}

/** Task events for one project; `version` becomes aggregateVersion. */
export function projectEvent(
  projectId: string,
  version: number,
  correlationId = `corr-${randomUUID()}`,
  taskId?: string,
): DomainEvent {
  return taskEvents.moved(
    { producer: 'project-service', correlationId },
    randomUUID(),
    randomUUID(),
    {
      id: taskId ?? randomUUID(),
      projectId,
      columnId: randomUUID(),
      title: `v${version}`,
      position: String(version * 1024),
      version,
    },
  );
}

/** Writes events exactly as the Project Service does: insertOutboxEvent inside a transaction. */
export async function seed(env: TestEnv, events: DomainEvent[]): Promise<void> {
  await env.database.db.transaction(async (tx) => {
    for (const event of events) await insertOutboxEvent(tx, event);
  });
}

export interface OutboxRow {
  sequence_id: string;
  event_id: string;
  partition_key: string;
  published_at: Date | null;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: Date | null;
  next_attempt_at: Date;
  claimed_by: string | null;
  claimed_until: Date | null;
  event: DomainEvent;
}

export async function outboxRows(env: TestEnv): Promise<OutboxRow[]> {
  return (
    await env.database.pool.query<OutboxRow>('SELECT * FROM outbox_events ORDER BY sequence_id')
  ).rows;
}

/** Runs cycles until nothing is left to claim (or a cycle aborts). */
export async function drain(publisher: OutboxPublisher, maxCycles = 500): Promise<void> {
  for (let i = 0; i < maxCycles; i++) {
    const result = await publisher.runOnce();
    if (result.claimed === 0 || result.aborted) return;
  }
  throw new Error('outbox did not drain');
}

export interface Received {
  event: DomainEvent;
  metadata: MessageMetadata;
}

/** Records every message on a topic from the beginning, duplicates included. */
export async function collectTopic(env: TestEnv, topic: string) {
  const received: Received[] = [];
  const consumer = new DomainEventConsumer({
    kafka: env.kafka,
    logger: env.logger,
    groupId: `collector-${randomUUID()}`,
    topics: [topic],
    fromBeginning: true,
    handler: async (event, metadata) => void received.push({ event, metadata }),
  });
  const joined = consumer.nextGroupJoin();
  await consumer.start();
  await joined;
  return {
    received,
    stop: () => consumer.stop(),
    waitForCount: (n: number, timeoutMs = 60_000) =>
      waitFor(() => received.length >= n, { timeoutMs, description: `${n} records on ${topic}` }),
  };
}
