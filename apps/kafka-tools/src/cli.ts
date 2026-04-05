import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { baseEnvSchema, loadConfig } from '@dpp/config';
import { commentEvents, taskEvents, type DomainEvent } from '@dpp/contracts';
import {
  createKafkaClient,
  createPartitioner,
  DomainEventConsumer,
  DomainEventProducer,
  ensureTopics,
  TOPICS,
} from '@dpp/kafka';
import { createLoggerOptions } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import type { Kafka } from 'kafkajs';
import { pino } from 'pino';
import { z } from 'zod';

/**
 * Developer and ops tooling for the local Kafka. Also the Compose `kafka-init` job.
 *
 *   init-topics                     create/verify domain.events (3) and domain.events.dlq (1)
 *   topics                          partitions, leaders and offsets for the platform topics
 *   groups                          consumer groups with committed offsets and lag
 *   produce-sample [--type T] [--project ID] [--correlation-id C]
 *   produce-malformed --kind invalid-json|unknown-type|bad-schema-version|bad-payload
 *   consume [--group G] [--from-beginning]    probe consumer; prints each event (Ctrl-C to stop)
 */

const config = loadConfig(
  baseEnvSchema.extend({
    // Host default; containers set kafka:9092.
    KAFKA_BROKERS: z
      .string()
      .default('localhost:9094')
      .transform((v) => v.split(',').map((b) => b.trim())),
    KAFKA_CLIENT_ID: z.string().default('kafka-tools'),
    LOG_LEVEL: baseEnvSchema.shape.LOG_LEVEL.default('warn'),
  }),
);

const logger = pino(createLoggerOptions('kafka-tools', config.LOG_LEVEL));
const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const kafka = createKafkaClient({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKERS,
  logger,
});
const platformTopics = [TOPICS.domainEvents, TOPICS.domainEventsDlq];

async function withAdmin<T>(fn: (admin: ReturnType<Kafka['admin']>) => Promise<T>): Promise<T> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.disconnect();
  }
}

function sampleEvent(type: string, projectId: string, correlationId: string): DomainEvent {
  const ctx = { producer: 'kafka-tools', correlationId };
  const actor = randomUUID();
  const task = {
    id: randomUUID(),
    projectId,
    columnId: randomUUID(),
    title: 'Sample task',
    position: '1024',
    version: 2,
  };
  switch (type) {
    case 'task.created':
      return taskEvents.created(ctx, actor, { ...task, version: 1 });
    case 'task.updated':
      return taskEvents.updated(
        ctx,
        actor,
        { title: 'Old title', description: '' },
        { ...task, description: '' },
      );
    case 'task.moved':
      return taskEvents.moved(ctx, actor, randomUUID(), task);
    case 'task.deleted':
      return taskEvents.deleted(ctx, actor, task);
    case 'task.assigned':
      return taskEvents.assigned(ctx, actor, task, randomUUID());
    case 'task.unassigned':
      return taskEvents.unassigned(ctx, actor, task, randomUUID());
    case 'comment.created':
      return commentEvents.created(
        ctx,
        { id: randomUUID(), taskId: task.id, authorId: actor, body: 'Sample comment' },
        { projectId, title: task.title },
      );
    default:
      throw new Error(`Unknown event type: ${type}`);
  }
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  'init-topics': async () => {
    const result = await withAdmin((admin) => ensureTopics(admin, platformTopics));
    out({ message: 'topics ready', ...result });
  },

  topics: async () => {
    await withAdmin(async (admin) => {
      const metadata = await admin.fetchTopicMetadata({
        topics: platformTopics.map((t) => t.name),
      });
      for (const topic of metadata.topics) {
        const offsets = await admin.fetchTopicOffsets(topic.name);
        out({
          topic: topic.name,
          partitions: topic.partitions.map((p) => {
            const o = offsets.find((x) => x.partition === p.partitionId);
            return { partition: p.partitionId, leader: p.leader, low: o?.low, high: o?.high };
          }),
        });
      }
    });
  },

  groups: async () => {
    await withAdmin(async (admin) => {
      const { groups } = await admin.listGroups();
      const topic = TOPICS.domainEvents.name;
      const latest = await admin.fetchTopicOffsets(topic);
      for (const { groupId } of groups) {
        const [description] = (await admin.describeGroups([groupId])).groups;
        const committed = await admin.fetchOffsets({ groupId, topics: [topic] });
        const partitions = committed.flatMap((t) =>
          t.partitions.map((p) => {
            const high = BigInt(latest.find((l) => l.partition === p.partition)?.high ?? '0');
            const offset = BigInt(p.offset);
            return {
              partition: p.partition,
              committed: p.offset,
              lag: String(offset < 0n ? high : high - offset),
            };
          }),
        );
        out({
          groupId,
          state: description?.state,
          members: description?.members.length,
          topic,
          partitions,
        });
      }
    });
  },

  'produce-sample': async (args) => {
    const { values } = parseArgs({
      args,
      options: {
        type: { type: 'string' },
        project: { type: 'string' },
        'correlation-id': { type: 'string' },
      },
    });
    const event = sampleEvent(
      values.type ?? 'task.moved',
      values.project ?? randomUUID(),
      values['correlation-id'] ?? `kafka-tools-${randomUUID()}`,
    );
    const producer = new DomainEventProducer({ kafka, logger });
    await producer.connect();
    try {
      const result = await producer.publish(event);
      out({
        message: 'published',
        eventId: event.eventId,
        eventType: event.eventType,
        correlationId: event.correlationId,
        ...result,
      });
    } finally {
      await producer.close();
    }
  },

  'produce-malformed': async (args) => {
    const { values } = parseArgs({ args, options: { kind: { type: 'string' } } });
    const valid = sampleEvent(
      'task.moved',
      randomUUID(),
      `kafka-tools-${randomUUID()}`,
    ) as unknown as Record<string, unknown>;
    const kinds: Record<string, string> = {
      'invalid-json': '{"eventId": ',
      'unknown-type': JSON.stringify({ ...valid, eventType: 'task.teleported' }),
      'bad-schema-version': JSON.stringify({ ...valid, schemaVersion: 900 }),
      'bad-payload': JSON.stringify({ ...valid, payload: { nope: true } }),
    };
    const value = kinds[values.kind ?? ''];
    if (!value) throw new Error(`--kind must be one of: ${Object.keys(kinds).join(', ')}`);
    const producer = kafka.producer({ createPartitioner });
    await producer.connect();
    try {
      const [record] = await producer.send({
        topic: TOPICS.domainEvents.name,
        messages: [{ key: 'malformed-demo', value }],
      });
      out({
        message: 'sent malformed message',
        kind: values.kind,
        partition: record?.partition,
        offset: record?.baseOffset,
      });
    } finally {
      await producer.disconnect();
    }
  },

  consume: async (args) => {
    const { values } = parseArgs({
      args,
      options: { group: { type: 'string' }, 'from-beginning': { type: 'boolean' } },
    });
    const consumer = new DomainEventConsumer({
      kafka,
      logger,
      groupId: values.group ?? `probe-${randomUUID().slice(0, 8)}`,
      topics: [TOPICS.domainEvents.name],
      fromBeginning: values['from-beginning'] ?? false,
      hooks: {
        onInvalidMessage: (failure, m) =>
          out({
            message: 'malformed message skipped',
            reason: failure.reason,
            partition: m.partition,
            offset: m.offset,
            key: m.key,
          }),
      },
      handler: async (event, m) => {
        out({
          eventType: event.eventType,
          eventId: event.eventId,
          correlationId: event.correlationId,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          partition: m.partition,
          offset: m.offset,
          key: m.key,
          group: m.consumerGroup,
        });
      },
    });
    installGracefulShutdown({
      log: logger,
      timeoutMs: 15_000,
      steps: [{ name: 'consumer', run: () => consumer.stop() }],
    });
    await consumer.start();
    out({ message: 'consuming', groupId: consumer.groupId, topic: TOPICS.domainEvents.name });
  },
};

const [command, ...rest] = process.argv.slice(2);
const run = command ? commands[command] : undefined;
if (!run) {
  process.stderr.write(`usage: cli <${Object.keys(commands).join('|')}> [options]\n`);
  process.exit(2);
}
try {
  await run(rest);
} catch (err) {
  logger.error({ err }, `${command} failed`);
  process.exit(1);
}
