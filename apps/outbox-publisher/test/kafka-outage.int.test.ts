import { randomUUID } from 'node:crypto';
import { startKafka, waitFor, type StartedKafka } from '@dpp/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectTopic,
  createTestEnv,
  createTopic,
  newPublisher,
  outboxRows,
  projectEvent,
  seed,
  sinkFor,
  type TestEnv,
} from './support.js';

// Its own broker, because this test stops and restarts it.
let broker: StartedKafka;
let env: TestEnv;
beforeAll(async () => {
  broker = await startKafka();
  env = await createTestEnv(broker.brokers);
});
afterAll(async () => {
  await env?.close();
  await broker?.stop();
});

const report = (line: string) => process.stdout.write(`[kafka-outage] ${line}\n`);

describe('Kafka outage with the publisher running', () => {
  it('keeps events pending with recorded, backed-off attempts, then drains them unchanged after Kafka returns', async () => {
    const topic = await createTopic(env.kafka);
    const publisher = newPublisher(env, sinkFor(env, topic), {
      pollIntervalMs: 100,
      backoff: { baseMs: 500, maxMs: 4_000 },
    });
    publisher.start();
    await waitFor(() => publisher.ready, { description: 'publisher ready' });

    await broker.stopBroker();
    const outageStarted = performance.now();

    // Events committed during the outage (as the Project Service would, with Kafka down).
    const projectA = randomUUID();
    const projectB = randomUUID();
    const events = [
      projectEvent(projectA, 1, 'corr-a1'),
      projectEvent(projectB, 1, 'corr-b1'),
      projectEvent(projectA, 2, 'corr-a2'),
      projectEvent(projectA, 3, 'corr-a3'),
      projectEvent(projectB, 2, 'corr-b2'),
    ];
    for (const e of events) await seed(env, [e]);

    // The publisher tries, fails, records it, backs off, and reports not ready.
    await waitFor(async () => (await outboxRows(env)).some((r) => r.attempt_count >= 2), {
      timeoutMs: 90_000,
      description: 'repeated failed attempts during the outage',
    });
    const during = await outboxRows(env);
    expect(during.every((r) => r.published_at === null)).toBe(true);
    const attempted = during.filter((r) => r.attempt_count > 0);
    expect(attempted.length).toBeGreaterThan(0);
    for (const r of attempted) {
      expect(r.last_error).toMatch(/PublishError/);
      expect(r.next_attempt_at.getTime()).toBeGreaterThan(r.last_attempt_at!.getTime());
    }
    expect(publisher.ready).toBe(false);
    report(
      `during outage: ${during.length} pending, attempts per row ${JSON.stringify(during.map((r) => r.attempt_count))}`,
    );

    await broker.startBroker();
    report(`broker back after ${Math.round(performance.now() - outageStarted)} ms of outage`);
    const recovery = performance.now();

    // No manual step: the running publisher drains the backlog on its own.
    await waitFor(async () => (await outboxRows(env)).every((r) => r.published_at !== null), {
      timeoutMs: 120_000,
      description: 'backlog drained after recovery',
    });
    report(
      `backlog drained ${Math.round(performance.now() - recovery)} ms after the broker returned`,
    );
    await waitFor(() => publisher.ready, { description: 'publisher ready again' });

    const collector = await collectTopic(env, topic);
    await collector.waitForCount(events.length);
    const received = collector.received.map((r) => r.event);
    // Same identities and correlation IDs as were committed; nothing rebuilt.
    expect(new Set(received.map((e) => e.eventId))).toEqual(new Set(events.map((e) => e.eventId)));
    for (const e of events) {
      expect(received.find((r) => r.eventId === e.eventId)?.correlationId).toBe(e.correlationId);
    }
    // Per-project order survived the outage.
    const versionsOf = (p: string) =>
      received.filter((e) => e.payload.projectId === p).map((e) => e.aggregateVersion);
    expect(versionsOf(projectA)).toEqual([1, 2, 3]);
    expect(versionsOf(projectB)).toEqual([1, 2]);

    await collector.stop();
    await publisher.stop();
  }, 300_000);
});
