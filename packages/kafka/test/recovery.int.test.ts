import { randomUUID } from 'node:crypto';
import { startKafka, waitFor, type StartedKafka } from '@dpp/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEventProducer, PublishError } from '../src/index.js';
import {
  captureLogger,
  createTestTopic,
  kafkaClient,
  sampleEvent,
  startCollector,
} from './support.js';

// A dedicated broker, because this file stops and restarts it. A broker restart on a loaded
// laptop took ~60 s in practice, so these tests get a budget that covers it.
const BUDGET_MS = 480_000;
let broker: StartedKafka;
beforeAll(async () => {
  broker = await startKafka();
});
afterAll(async () => {
  await broker?.stop();
});

const report = (line: string) => process.stdout.write(`[recovery] ${line}\n`);

describe('broker outage and recovery', () => {
  it(
    'fails publishes clearly while down, then producer and consumer recover after restart',
    async () => {
      const { logger } = captureLogger();
      const kafka = kafkaClient(logger, broker.brokers);
      const topic = await createTestTopic(kafka);
      const producer = new DomainEventProducer({ kafka, logger, topic });
      await producer.connect();
      const collector = await startCollector(kafka, logger, topic);
      const projectId = randomUUID();

      const before = sampleEvent(projectId);
      await producer.publish(before);
      await collector.waitForCount(1);

      await broker.stopBroker();
      let started = performance.now();
      const failure = await producer.publish(sampleEvent(projectId)).catch((e: unknown) => e);
      const failMs = Math.round(performance.now() - started);
      expect(failure).toBeInstanceOf(PublishError);
      expect(failMs).toBeLessThan(30_000);
      report(`publish with broker down failed after ${failMs} ms`);

      started = performance.now();
      await broker.startBroker();
      report(`broker serving metadata again after ${Math.round(performance.now() - started)} ms`);

      // Same producer and consumer objects: no application-level reconnect logic.
      started = performance.now();
      let attempts = 0;
      const after = sampleEvent(projectId);
      await waitFor(
        async () => {
          attempts++;
          return producer.publish(after);
        },
        { timeoutMs: 60_000, intervalMs: 1_000, description: 'producer to publish after restart' },
      );
      report(
        `producer published after restart in ${Math.round(performance.now() - started)} ms (${attempts} attempt(s))`,
      );

      started = performance.now();
      await waitFor(() => collector.received.some((r) => r.event.eventId === after.eventId), {
        timeoutMs: 90_000,
        description: 'consumer to receive the post-restart event',
      });
      report(`consumer received it ${Math.round(performance.now() - started)} ms later`);

      await producer.close();
      await collector.consumer.stop();
    },
    BUDGET_MS,
  );

  it(
    'shuts producer and consumer down within a bound even when the broker is gone',
    async () => {
      const { logger } = captureLogger();
      const kafka = kafkaClient(logger, broker.brokers);
      const topic = await createTestTopic(kafka);
      const producer = new DomainEventProducer({ kafka, logger, topic });
      await producer.connect();
      const collector = await startCollector(kafka, logger, topic);

      await broker.stopBroker();
      const started = performance.now();
      await Promise.all([
        producer.close({ drainTimeoutMs: 2_000, disconnectTimeoutMs: 3_000 }),
        collector.consumer.stop({ timeoutMs: 5_000 }),
      ]);
      const elapsed = Math.round(performance.now() - started);
      report(`shutdown with broker down took ${elapsed} ms`);
      expect(elapsed).toBeLessThan(12_000);
      await broker.startBroker();
    },
    BUDGET_MS,
  );
});
