import { randomUUID } from 'node:crypto';
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

describe('partitioning by projectId', () => {
  it('delivers one project’s events in production order, from one partition', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    const collector = await startCollector(kafka, logger, topic);

    const projectId = randomUUID();
    const taskId = randomUUID();
    const sent = [];
    for (let version = 1; version <= 25; version++) {
      sent.push(await producer.publish(sampleEvent(projectId, { taskId, version })));
    }
    await collector.waitForCount(25);

    const versions = collector.received.map((r) => r.event.aggregateVersion);
    expect(versions).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(collector.received.map((r) => r.metadata.partition)).size).toBe(1);
    const offsets = collector.received.map((r) => BigInt(r.metadata.offset));
    expect(offsets.every((o, i) => i === 0 || o > offsets[i - 1]!)).toBe(true);
    expect(collector.received.map((r) => r.metadata.offset)).toEqual(sent.map((s) => s.offset));

    await producer.close();
    await collector.consumer.stop();
  });

  it('routes each key to the partition the partitioner computes for it', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    const collector = await startCollector(kafka, logger, topic);

    // Keys selected so that they are known to cover partitions 0, 1 and 2.
    const projects = projectIdsForEachPartition(3);
    for (const projectId of projects) {
      await producer.publish(sampleEvent(projectId));
      await producer.publish(sampleEvent(projectId));
    }
    await collector.waitForCount(6);

    for (const { event, metadata } of collector.received) {
      const expected = projects.indexOf(event.payload.projectId);
      expect(metadata.key).toBe(event.payload.projectId);
      expect(metadata.partition).toBe(expected);
    }
    expect(new Set(collector.received.map((r) => r.metadata.partition))).toEqual(
      new Set([0, 1, 2]),
    );

    await producer.close();
    await collector.consumer.stop();
  });
});
