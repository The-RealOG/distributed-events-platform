import { randomUUID } from 'node:crypto';
import { waitFor } from '@dpp/test-utils';
import { describe, expect, it } from 'vitest';
import { DomainEventProducer, ProducerClosedError } from '../src/index.js';
import {
  captureLogger,
  createTestTopic,
  kafkaClient,
  sampleEvent,
  startCollector,
} from './support.js';

describe('graceful shutdown', () => {
  it('consumer stop() waits for the message in progress, then commits so it is not redelivered', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const groupId = `shutdown-${randomUUID()}`;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = false;
    let finished = false;
    const first = await startCollector(kafka, logger, topic, {
      groupId,
      handler: async () => {
        started = true;
        await gate;
        finished = true;
      },
    });

    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();
    const projectId = randomUUID();
    const inFlightEvent = sampleEvent(projectId);
    await producer.publish(inFlightEvent);
    await waitFor(() => started, { description: 'handler to start' });

    let stopped = false;
    const stopping = first.consumer.stop().then(() => (stopped = true));
    // Give stop() every chance to return early; it must not while the handler is running.
    await new Promise((r) => setTimeout(r, 500));
    expect(stopped).toBe(false);
    expect(finished).toBe(false);

    release();
    await stopping;
    expect(finished).toBe(true);
    expect(first.received.map((r) => r.event.eventId)).toEqual([inFlightEvent.eventId]);

    // A replacement member of the same group resumes after the committed offset.
    const marker = sampleEvent(projectId);
    await producer.publish(marker);
    const second = await startCollector(kafka, logger, topic, { groupId });
    await second.waitForCount(1);
    expect(second.received.map((r) => r.event.eventId)).toEqual([marker.eventId]);

    await producer.close();
    await second.consumer.stop();
  });

  it('producer close() lets an in-flight publish finish and then refuses new ones', async () => {
    const { logger } = captureLogger();
    const kafka = kafkaClient(logger);
    const topic = await createTestTopic(kafka);
    const producer = new DomainEventProducer({ kafka, logger, topic });
    await producer.connect();

    const publishing = producer.publish(sampleEvent(randomUUID()));
    const closing = producer.close();
    await expect(publishing).resolves.toMatchObject({ topic });
    await closing;
    await expect(producer.publish(sampleEvent(randomUUID()))).rejects.toBeInstanceOf(
      ProducerClosedError,
    );
  });
});
