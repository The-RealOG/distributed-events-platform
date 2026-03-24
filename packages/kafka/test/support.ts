import { randomUUID } from 'node:crypto';
import { taskEvents, type DomainEvent } from '@dpp/contracts';
import { waitFor } from '@dpp/test-utils';
import type { Kafka } from 'kafkajs';
import { pino, type Logger } from 'pino';
import { inject } from 'vitest';
import {
  createKafkaClient,
  DomainEventConsumer,
  ensureTopics,
  partitionFor,
  type ConsumerHooks,
  type MessageMetadata,
} from '../src/index.js';

export const brokers = (): string[] => inject('kafkaBrokers');

export type LogLine = Record<string, unknown>;

/** A Pino logger whose JSON lines are kept in memory for assertions. */
export function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'debug', base: { service: 'kafka-test' } },
    { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) },
  );
  return { logger, lines };
}

export function kafkaClient(logger: Logger, brokerList = brokers()): Kafka {
  return createKafkaClient({
    clientId: `test-${randomUUID().slice(0, 8)}`,
    brokers: brokerList,
    logger,
  });
}

/** A fresh topic per test, so tests never see each other's messages. */
export async function createTestTopic(kafka: Kafka, numPartitions = 3): Promise<string> {
  const name = `test.${randomUUID()}`;
  const admin = kafka.admin();
  await admin.connect();
  try {
    await ensureTopics(admin, [{ name, numPartitions, replicationFactor: 1, config: {} }]);
  } finally {
    await admin.disconnect();
  }
  return name;
}

/** Project IDs chosen (by computing the partitioner) to land on partitions 0..n-1. */
export function projectIdsForEachPartition(numPartitions: number): string[] {
  const byPartition = new Map<number, string>();
  while (byPartition.size < numPartitions) {
    const id = randomUUID();
    const partition = partitionFor(id, numPartitions);
    if (!byPartition.has(partition)) byPartition.set(partition, id);
  }
  return Array.from({ length: numPartitions }, (_, p) => byPartition.get(p)!);
}

export function sampleEvent(
  projectId: string,
  opts: { version?: number; correlationId?: string; taskId?: string } = {},
): DomainEvent {
  return taskEvents.moved(
    { producer: 'kafka-test', correlationId: opts.correlationId ?? `test-${randomUUID()}` },
    randomUUID(),
    randomUUID(),
    {
      id: opts.taskId ?? randomUUID(),
      projectId,
      columnId: randomUUID(),
      title: 'Probe task',
      position: '1024',
      version: opts.version ?? 2,
    },
  );
}

export interface Received {
  event: DomainEvent;
  metadata: MessageMetadata;
}

/** Starts a consumer that records what it receives, and waits until it owns partitions. */
export async function startCollector(
  kafka: Kafka,
  logger: Logger,
  topic: string,
  opts: { groupId?: string; hooks?: ConsumerHooks; handler?: (r: Received) => Promise<void> } = {},
) {
  const received: Received[] = [];
  const consumer = new DomainEventConsumer({
    kafka,
    logger,
    groupId: opts.groupId ?? `test-group-${randomUUID()}`,
    topics: [topic],
    fromBeginning: true,
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
    handler: async (event, metadata) => {
      await opts.handler?.({ event, metadata });
      received.push({ event, metadata });
    },
  });
  const joined = consumer.nextGroupJoin();
  await consumer.start();
  await joined;
  return {
    consumer,
    received,
    waitForCount: (n: number, timeoutMs = 30_000) =>
      waitFor(() => received.length >= n, { timeoutMs, description: `${n} events on ${topic}` }),
  };
}
