import { taskEvents } from '@dpp/contracts';
import type { Admin } from 'kafkajs';
import { describe, expect, it } from 'vitest';
import {
  encodeDomainEvent,
  ensureTopics,
  kafkaEnvSchema,
  partitionFor,
  TopicMismatchError,
  TOPICS,
  type TopicSpec,
} from './index.js';

const projectId = '44444444-4444-4444-8444-444444444444';
const event = taskEvents.created(
  { producer: 'project-service', correlationId: 'corr-1' },
  '11111111-1111-4111-8111-111111111111',
  {
    id: '33333333-3333-4333-8333-333333333333',
    projectId,
    columnId: '55555555-5555-4555-8555-555555555555',
    title: 'T',
    position: '1024',
    version: 1,
  },
  { now: new Date('2026-01-02T03:04:05.000Z') },
);

describe('encodeDomainEvent', () => {
  it('keys by projectId, serializes the envelope as JSON and mirrors routing headers', () => {
    const message = encodeDomainEvent(event);
    expect(message.key).toBe(projectId);
    expect(JSON.parse(message.value as string)).toEqual(event);
    expect(message.timestamp).toBe(String(Date.parse('2026-01-02T03:04:05.000Z')));
    expect(message.headers).toEqual({
      'content-type': 'application/json',
      'event-id': event.eventId,
      'event-type': 'task.created',
      'schema-version': '1',
      'correlation-id': 'corr-1',
    });
  });
});

describe('partitionFor', () => {
  it('is deterministic and in range', () => {
    for (let i = 0; i < 200; i++) {
      const key = `project-${i}`;
      const p = partitionFor(key, 3);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(3);
      expect(partitionFor(key, 3)).toBe(p);
    }
  });

  it('spreads keys across all partitions', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => partitionFor(`project-${i}`, 3)));
    expect(used).toEqual(new Set([0, 1, 2]));
  });
});

/** Minimal in-memory stand-in for the three admin calls ensureTopics uses. */
function fakeAdmin(existing: Record<string, number>, opts: { raceOnCreate?: boolean } = {}) {
  const topics = { ...existing };
  const created: string[] = [];
  const admin = {
    listTopics: async () => Object.keys(topics),
    createTopics: async ({
      topics: specs,
    }: {
      topics: { topic: string; numPartitions: number }[];
    }) => {
      for (const s of specs) {
        topics[s.topic] = s.numPartitions;
        created.push(s.topic);
      }
      if (opts.raceOnCreate)
        throw Object.assign(new Error('exists'), { type: 'TOPIC_ALREADY_EXISTS' });
      return true;
    },
    fetchTopicMetadata: async ({ topics: names }: { topics: string[] }) => ({
      topics: names.map((name) => ({
        name,
        partitions: Array.from({ length: topics[name] ?? 0 }, (_, i) => ({ partitionId: i })),
      })),
    }),
  };
  return { admin: admin as unknown as Admin, created, topics };
}

const specs: TopicSpec[] = [TOPICS.domainEvents, TOPICS.domainEventsDlq];

describe('ensureTopics', () => {
  it('creates missing topics with the declared partition counts', async () => {
    const { admin, topics } = fakeAdmin({});
    expect(await ensureTopics(admin, specs)).toEqual({
      created: ['domain.events', 'domain.events.dlq'],
      existing: [],
    });
    expect(topics).toEqual({ 'domain.events': 3, 'domain.events.dlq': 1 });
  });

  it('is idempotent: existing, correct topics are left alone', async () => {
    const { admin, created } = fakeAdmin({ 'domain.events': 3, 'domain.events.dlq': 1 });
    expect(await ensureTopics(admin, specs)).toEqual({
      created: [],
      existing: ['domain.events', 'domain.events.dlq'],
    });
    expect(created).toEqual([]);
  });

  it('tolerates another initializer creating the topic first', async () => {
    const { admin } = fakeAdmin({}, { raceOnCreate: true });
    await expect(ensureTopics(admin, specs)).resolves.toBeDefined();
  });

  it('refuses to accept a topic with the wrong partition count instead of changing it', async () => {
    const { admin, topics } = fakeAdmin({ 'domain.events': 1, 'domain.events.dlq': 1 });
    await expect(ensureTopics(admin, specs)).rejects.toBeInstanceOf(TopicMismatchError);
    expect(topics['domain.events']).toBe(1);
  });
});

describe('kafkaEnvSchema', () => {
  it('parses a broker list', () => {
    expect(
      kafkaEnvSchema.parse({ KAFKA_BROKERS: 'kafka:9092, other:9093', KAFKA_CLIENT_ID: 'x' }),
    ).toEqual({
      KAFKA_BROKERS: ['kafka:9092', 'other:9093'],
      KAFKA_CLIENT_ID: 'x',
    });
  });

  it('rejects malformed broker addresses', () => {
    expect(kafkaEnvSchema.safeParse({ KAFKA_BROKERS: 'kafka', KAFKA_CLIENT_ID: 'x' }).success).toBe(
      false,
    );
    expect(kafkaEnvSchema.safeParse({ KAFKA_BROKERS: '', KAFKA_CLIENT_ID: 'x' }).success).toBe(
      false,
    );
  });
});
