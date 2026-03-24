import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DomainEventProducer,
  partitionFor,
  ProducerClosedError,
  PublishError,
} from '../src/index.js';
import {
  captureLogger,
  createTestTopic,
  kafkaClient,
  sampleEvent,
  startCollector,
} from './support.js';

describe('DomainEventProducer against a real broker', () => {
  it('publishes a valid event keyed by projectId and reports where Kafka put it', async () => {
    const { logger, lines } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    const collector = await startCollector(kafka, logger, topic);

    const projectId = randomUUID();
    const event = sampleEvent(projectId);
    const result = await producer.publish(event);

    expect(result).toMatchObject({ topic, key: projectId, partition: partitionFor(projectId, 3) });
    expect(result.offset).toMatch(/^\d+$/);

    await collector.waitForCount(1);
    const [{ event: consumed, metadata }] = collector.received as [(typeof collector.received)[0]];
    // Every field survives the round trip unchanged.
    expect(consumed).toEqual(event);
    expect(metadata).toMatchObject({
      topic,
      partition: result.partition,
      offset: result.offset,
      key: projectId,
    });
    expect(metadata.headers).toMatchObject({
      'event-id': event.eventId,
      'event-type': 'task.moved',
      'correlation-id': event.correlationId,
      'schema-version': '1',
      'content-type': 'application/json',
    });

    const published = lines.find((l) => l['msg'] === 'event published');
    expect(published).toMatchObject({
      eventId: event.eventId,
      eventType: 'task.moved',
      correlationId: event.correlationId,
      topic,
      partition: result.partition,
      offset: result.offset,
    });
    // Payload contents are not logged.
    expect(JSON.stringify(lines)).not.toContain('Probe task');

    await collector.consumer.stop();
    await producer.close();
  });

  it('refuses to put an invalid event on the wire', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();

    const bad = { ...sampleEvent(randomUUID()), eventId: 'not-a-uuid' };
    await expect(producer.publish(bad)).rejects.toThrow();

    const admin = kafka.admin();
    await admin.connect();
    const offsets = await admin.fetchTopicOffsets(topic);
    expect(offsets.every((p) => p.high === '0')).toBe(true);
    await admin.disconnect();
    await producer.close();
  });

  it('surfaces a failed publish to the caller, within a bounded time', async () => {
    const { logger, lines } = captureLogger();
    const kafka = kafkaClient(logger);
    const producer = new DomainEventProducer({ kafka, logger, topic: `missing.${randomUUID()}` });
    await producer.connect();

    const started = performance.now();
    const error = await producer.publish(sampleEvent(randomUUID())).catch((e: unknown) => e);
    const elapsed = performance.now() - started;

    expect(error).toBeInstanceOf(PublishError);
    expect(elapsed).toBeLessThan(20_000);
    expect(lines.some((l) => l['msg'] === 'event publish failed')).toBe(true);
    expect(lines.some((l) => l['msg'] === 'event published')).toBe(false);
    await producer.close();
  });

  it('rejects publishing before connect and after close', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const producer = new DomainEventProducer({ kafka, logger, topic });

    await expect(producer.publish(sampleEvent(randomUUID()))).rejects.toBeInstanceOf(PublishError);
    await producer.connect();
    await producer.close();
    await expect(producer.publish(sampleEvent(randomUUID()))).rejects.toBeInstanceOf(
      ProducerClosedError,
    );
  });
});
