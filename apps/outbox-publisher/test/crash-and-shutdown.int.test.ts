import { randomUUID } from 'node:crypto';
import type { PublishResult } from '@dpp/kafka';
import { pauseContainer, unpauseContainer, waitFor } from '@dpp/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { SimulatedCrash, type EventSink } from '../src/publisher.js';
import {
  collectTopic,
  createTestEnv,
  createTopic,
  drain,
  newPublisher,
  outboxRows,
  projectEvent,
  resetOutbox,
  seed,
  sinkFor,
  type TestEnv,
} from './support.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => resetOutbox(env));

const SHORT_LEASE_MS = 1_000;

describe('publisher crashes', () => {
  it('Invariant 4: an event survives a publisher that dies after claiming it, before sending', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const event = projectEvent(randomUUID(), 1);
    await seed(env, [event]);

    const doomedSink = sinkFor(env, topic);
    const doomed = newPublisher(env, doomedSink, {
      leaseMs: SHORT_LEASE_MS,
      faults: {
        beforePublish: () => {
          throw new SimulatedCrash('before send');
        },
      },
    });
    doomed.start();
    await waitFor(() => doomed.crashed, { description: 'the simulated crash' });
    const [orphaned] = await outboxRows(env);
    expect(orphaned).toMatchObject({ published_at: null, attempt_count: 0 });
    expect(orphaned!.claimed_by).not.toBeNull(); // still leased by the dead worker

    // "Restart": a new worker picks it up once the dead worker's lease expires.
    const restarted = newPublisher(env, sinkFor(env, topic), { leaseMs: SHORT_LEASE_MS });
    restarted.start();
    await waitFor(async () => (await outboxRows(env))[0]!.published_at !== null, {
      timeoutMs: 20_000,
      description: 'republish after the lease expired',
    });
    await collector.waitForCount(1);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(collector.received.map((r) => r.event.eventId)).toEqual([event.eventId]); // no loss, no duplicate

    await restarted.stop();
    await doomedSink.close();
    await collector.stop();
  });

  it('Invariant 5: an event acknowledged by Kafka but not yet marked is republished with the SAME eventId', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const event = projectEvent(randomUUID(), 7, 'corr-duplicate-demo');
    await seed(env, [event]);

    const acked: PublishResult[] = [];
    const doomedSink = sinkFor(env, topic);
    const doomed = newPublisher(env, doomedSink, {
      leaseMs: SHORT_LEASE_MS,
      faults: {
        afterAck: (_row, result) => {
          acked.push(result);
          throw new SimulatedCrash('after Kafka acknowledged, before marking published');
        },
      },
    });
    doomed.start();
    await waitFor(() => doomed.crashed, { description: 'the simulated crash' });
    expect(acked).toHaveLength(1); // Kafka really has it…
    expect((await outboxRows(env))[0]!.published_at).toBeNull(); // …but the outbox doesn't know.

    const restarted = newPublisher(env, sinkFor(env, topic), { leaseMs: SHORT_LEASE_MS });
    restarted.start();
    await waitFor(async () => (await outboxRows(env))[0]!.published_at !== null, {
      timeoutMs: 20_000,
      description: 'republish after the lease expired',
    });
    await collector.waitForCount(2);

    // The expected at-least-once duplicate: two Kafka records, one logical event.
    const [first, second] = collector.received;
    expect(collector.received).toHaveLength(2);
    expect(first!.event.eventId).toBe(event.eventId);
    expect(second!.event.eventId).toBe(event.eventId);
    expect(second!.event).toEqual(first!.event); // byte-identical envelope, same correlationId
    expect(second!.event.correlationId).toBe('corr-duplicate-demo');
    expect(first!.metadata.offset).not.toBe(second!.metadata.offset); // genuinely two records
    expect(first!.metadata.partition).toBe(second!.metadata.partition);

    await restarted.stop();
    await doomedSink.close();
    await collector.stop();
  });
});

describe('graceful shutdown', () => {
  it('stops promptly when idle', async () => {
    const publisher = newPublisher(env, sinkFor(env, await createTopic(env.kafka)), {
      pollIntervalMs: 60_000,
    });
    publisher.start();
    await waitFor(() => publisher.ready, { description: 'publisher ready' });
    const started = performance.now();
    await publisher.stop();
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(publisher.ready).toBe(false);
  });

  it('finishes the event in flight, releases unsent claims, and loses nothing', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const events = Array.from({ length: 5 }, () => projectEvent(randomUUID(), 1));
    await seed(env, events);

    let releaseSend!: () => void;
    const sendGate = new Promise<void>((r) => (releaseSend = r));
    let inFlight = false;
    const inner = sinkFor(env, topic);
    const gated: EventSink = {
      connect: () => inner.connect(),
      close: (o) => inner.close(o),
      publish: async (event) => {
        inFlight = true;
        await sendGate;
        return inner.publish(event);
      },
    };
    const first = newPublisher(env, gated, { batchSize: 5 });
    first.start();
    await waitFor(() => inFlight, { description: 'first publish to be in flight' });

    const stopping = first.stop();
    releaseSend();
    await stopping;

    const rows = await outboxRows(env);
    expect(rows.filter((r) => r.published_at !== null)).toHaveLength(1); // the in-flight one finished
    expect(rows.filter((r) => r.claimed_by !== null)).toEqual([]); // the rest were handed back

    // Another replica takes over the released rows immediately (no lease wait).
    const second = newPublisher(env, sinkFor(env, topic));
    await drain(second);
    await collector.waitForCount(5);
    expect(new Set(collector.received.map((r) => r.event.eventId))).toEqual(
      new Set(events.map((e) => e.eventId)),
    );
    await second.stop();
    await collector.stop();
  });
});

describe('PostgreSQL temporarily unavailable to the publisher', () => {
  it('reports not ready while the database is frozen and resumes publishing afterwards', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const publisher = newPublisher(env, sinkFor(env, topic), {
      backoff: { baseMs: 200, maxMs: 1_000 },
    });
    publisher.start();
    await waitFor(() => publisher.ready, { description: 'publisher ready' });

    const container = inject('postgresContainerId');
    await pauseContainer(container);
    try {
      await waitFor(() => !publisher.ready, {
        timeoutMs: 30_000,
        description: 'publisher to notice the outage',
      });
    } finally {
      await unpauseContainer(container);
    }

    const event = projectEvent(randomUUID(), 1);
    await seed(env, [event]);
    await collector.waitForCount(1);
    expect(collector.received[0]!.event.eventId).toBe(event.eventId);
    await waitFor(() => publisher.ready, { description: 'publisher ready again' });
    await publisher.stop();
    await collector.stop();
  });
});
