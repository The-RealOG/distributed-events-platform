import { randomUUID } from 'node:crypto';
import type { EventParseFailure } from '@dpp/contracts';
import { waitFor } from '@dpp/test-utils';
import { describe, expect, it } from 'vitest';
import { createPartitioner, DomainEventProducer } from '../src/index.js';
import {
  captureLogger,
  createTestTopic,
  kafkaClient,
  sampleEvent,
  startCollector,
} from './support.js';

describe('DomainEventConsumer against a real broker', () => {
  it('keeps running through every kind of malformed message and skips each one deliberately', async () => {
    const { logger, lines } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const invalid: EventParseFailure[] = [];
    const collector = await startCollector(kafka, logger, topic, {
      hooks: { onInvalidMessage: (failure) => invalid.push(failure) },
    });

    const projectId = randomUUID();
    const good = () => sampleEvent(projectId);
    const tweak = (mutate: (e: Record<string, any>) => void) => {
      const e = structuredClone(good()) as unknown as Record<string, any>;
      mutate(e);
      return JSON.stringify(e);
    };
    const MARKER = 'SECRET-PAYLOAD-MARKER';
    const malformed: [EventParseFailure['reason'], string][] = [
      ['invalid_json', `{"eventId": "${MARKER}"`],
      ['invalid_envelope', JSON.stringify({ hello: MARKER })],
      ['unknown_event_type', tweak((e) => (e['eventType'] = 'task.teleported'))],
      ['invalid_envelope', tweak((e) => delete e['eventId'])],
      ['invalid_envelope', tweak((e) => (e['aggregateId'] = 'task-1'))],
      ['invalid_envelope', tweak((e) => (e['occurredAt'] = 'last tuesday'))],
      ['unsupported_schema_version', tweak((e) => (e['schemaVersion'] = 900))],
      ['invalid_payload', tweak((e) => (e['payload']['title'] = MARKER.repeat(100)))],
    ];

    // Raw producer: bypasses our validation, like a buggy or foreign producer would. All on the
    // same key, so they sit on one partition in front of a valid event.
    const raw = kafka.producer({ createPartitioner });
    await raw.connect();
    for (const [, value] of malformed) {
      await raw.send({ topic, messages: [{ key: projectId, value }] });
    }
    const first = good();
    await raw.send({ topic, messages: [{ key: projectId, value: JSON.stringify(first) }] });

    await collector.waitForCount(1);
    expect(collector.received[0]!.event.eventId).toBe(first.eventId);
    expect(invalid.map((f) => f.reason)).toEqual(malformed.map(([reason]) => reason));

    // Still alive and consuming afterwards.
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    const second = good();
    await producer.publish(second);
    await collector.waitForCount(2);
    expect(collector.received[1]!.event.eventId).toBe(second.eventId);

    // Each skip is logged with coordinates and reason, never with the raw payload.
    const skips = lines.filter((l) => l['msg'] === 'skipping malformed event');
    expect(skips).toHaveLength(malformed.length);
    for (const skip of skips) {
      expect(skip).toMatchObject({
        topic,
        partition: expect.any(Number),
        offset: expect.any(String),
        key: projectId,
      });
    }
    expect(JSON.stringify(lines)).not.toContain(MARKER);

    await raw.disconnect();
    await producer.close();
    await collector.consumer.stop();
  });

  it('carries a gateway-style correlation ID through Kafka unchanged', async () => {
    const { logger, lines } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const collector = await startCollector(kafka, logger, topic);
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();

    // Exactly what the gateway generates when a request arrives without one.
    const correlationId = randomUUID();
    const event = sampleEvent(randomUUID(), { correlationId });
    await producer.publish(event);
    await collector.waitForCount(1);

    const [{ event: consumed, metadata }] = collector.received as [(typeof collector.received)[0]];
    expect(consumed.correlationId).toBe(correlationId);
    expect(metadata.headers['correlation-id']).toBe(correlationId);
    await waitFor(() => lines.some((l) => l['msg'] === 'event processed'), {
      description: 'processed log',
    });
    const processed = lines.find((l) => l['msg'] === 'event processed');
    expect(processed).toMatchObject({
      correlationId,
      eventId: event.eventId,
      consumerGroup: collector.consumer.groupId,
      topic,
      offset: metadata.offset,
    });

    await producer.close();
    await collector.consumer.stop();
  });
});
