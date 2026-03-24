import { randomUUID } from 'node:crypto';
import { waitFor } from '@dpp/test-utils';
import { describe, expect, it } from 'vitest';
import { DomainEventProducer } from '../src/index.js';
import {
  captureLogger,
  createTestTopic,
  kafkaClient,
  projectIdsForEachPartition,
  sampleEvent,
  startCollector,
} from './support.js';

describe('consumer groups', () => {
  it('splits partitions between members of one group: each event is handled once', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const groupId = `replicas-${randomUUID()}`;

    const a = await startCollector(kafka, logger, topic, { groupId });
    const b = await startCollector(kafka, logger, topic, { groupId });
    // Wait for the rebalance that gives each member a disjoint share of the 3 partitions.
    await waitFor(
      () => {
        const pa = a.consumer.assignment.flatMap((t) => t.partitions);
        const pb = b.consumer.assignment.flatMap((t) => t.partitions);
        const all = [...pa, ...pb].sort();
        return pa.length > 0 && pb.length > 0 && JSON.stringify(all) === '[0,1,2]';
      },
      { timeoutMs: 60_000, description: 'rebalance across both members' },
    );

    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    for (const projectId of projectIdsForEachPartition(3)) {
      for (let i = 0; i < 10; i++) await producer.publish(sampleEvent(projectId));
    }
    await waitFor(() => a.received.length + b.received.length >= 30, {
      description: '30 events across the group',
    });

    const idsA = new Set(a.received.map((r) => r.event.eventId));
    const idsB = new Set(b.received.map((r) => r.event.eventId));
    expect(idsA.size + idsB.size).toBe(30);
    expect([...idsA].filter((id) => idsB.has(id))).toEqual([]);
    expect(idsA.size).toBeGreaterThan(0);
    expect(idsB.size).toBeGreaterThan(0);
    // Each member only saw its own partitions.
    const ownsA = new Set(a.consumer.assignment.flatMap((t) => t.partitions));
    expect(a.received.every((r) => ownsA.has(r.metadata.partition))).toBe(true);

    await producer.close();
    await Promise.all([a.consumer.stop(), b.consumer.stop()]);
  });

  it('gives every group its own full copy of the stream', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    // e.g. activity-service and realtime-service
    const x = await startCollector(kafka, logger, topic, { groupId: `activity-${randomUUID()}` });
    const y = await startCollector(kafka, logger, topic, { groupId: `realtime-${randomUUID()}` });

    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    const sent = [];
    for (const projectId of projectIdsForEachPartition(3))
      sent.push((await producer.publish(sampleEvent(projectId))) && projectId);
    await x.waitForCount(3);
    await y.waitForCount(3);

    const ids = (c: typeof x) => c.received.map((r) => r.event.eventId).sort();
    expect(ids(x)).toEqual(ids(y));
    expect(ids(x)).toHaveLength(3);

    await producer.close();
    await Promise.all([x.consumer.stop(), y.consumer.stop()]);
  });
});
