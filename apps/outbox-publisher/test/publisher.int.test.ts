import { randomUUID } from 'node:crypto';
import { claimOutboxBatch } from '@dpp/database';
import { PublishError, type PublishResult } from '@dpp/kafka';
import { waitFor } from '@dpp/test-utils';
import { KafkaJSConnectionError } from 'kafkajs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventSink } from '../src/publisher.js';
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

/** A sink that fails every publish the way KafkaJS does when the broker is unreachable. */
function unreachableSink(): EventSink & { attempts: string[] } {
  const attempts: string[] = [];
  return {
    attempts,
    connect: async () => {},
    publish: async (event) => {
      attempts.push(event.eventId);
      throw new PublishError(
        event.eventId,
        new KafkaJSConnectionError('connect ECONNREFUSED 127.0.0.1:9'),
      );
    },
    close: async () => {},
  };
}

describe('publication', () => {
  it('publishes the stored event unchanged (same eventId, correlationId, key) and marks it published', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const projectId = randomUUID();
    const event = projectEvent(projectId, 3, 'corr-from-http-request');
    await seed(env, [event]);

    const sink = sinkFor(env, topic);
    const publisher = newPublisher(env, sink);
    await drain(publisher);

    await collector.waitForCount(1);
    const [{ event: consumed, metadata }] = collector.received as [(typeof collector.received)[0]];
    expect(consumed).toEqual(event);
    expect(metadata.key).toBe(projectId);
    const [row] = await outboxRows(env);
    expect(row).toMatchObject({ event_id: event.eventId, attempt_count: 0, claimed_by: null });
    expect(row!.published_at).toBeInstanceOf(Date);

    expect(env.lines.find((l) => l['msg'] === 'outbox event published')).toMatchObject({
      eventId: event.eventId,
      correlationId: 'corr-from-http-request',
      eventType: 'task.moved',
    });
    await collector.stop();
    await publisher.stop();
  });

  it('publishes under the partition key persisted with the row, never a re-derived one', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const event = projectEvent(randomUUID(), 1, 'corr-key');
    await seed(env, [event]);
    // Stand-in for a derivation that changed after the row was written: the row's key wins.
    const persistedKey = `persisted-${randomUUID()}`;
    await env.database.pool.query('UPDATE outbox_events SET partition_key = $1', [persistedKey]);

    const publisher = newPublisher(env, sinkFor(env, topic));
    await drain(publisher);

    await collector.waitForCount(1);
    expect(collector.received[0]!.metadata.key).toBe(persistedKey);
    expect(collector.received[0]!.event).toEqual(event);
    await collector.stop();
    await publisher.stop();
  });

  it('Invariant 10: publishes each project’s events in outbox order, without a global order', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const projects = [randomUUID(), randomUUID(), randomUUID()];
    const events = [];
    // Interleave three projects' events as concurrent requests would.
    for (let v = 1; v <= 15; v++)
      for (const p of projects) events.push(projectEvent(p, v, undefined, p));
    for (const e of events) await seed(env, [e]);

    const publisher = newPublisher(env, sinkFor(env, topic));
    // A single cycle may take at most one event per project (the head of each project's queue).
    const firstCycle = await publisher.runOnce();
    expect(firstCycle.claimed).toBe(3);
    await drain(publisher);
    await collector.waitForCount(45);

    for (const p of projects) {
      const versions = collector.received
        .filter((r) => r.event.payload.projectId === p)
        .map((r) => r.event.aggregateVersion);
      expect(versions).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    }
    // Deliberately no assertion about the relative order of different projects.
    await collector.stop();
    await publisher.stop();
  });
});

describe('claims and leases', () => {
  it('Invariant 6: concurrent claims by two workers never return the same event', async () => {
    const events = Array.from({ length: 120 }, (_, i) => projectEvent(randomUUID(), i + 1));
    await seed(env, events);

    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        claimOutboxBatch(env.database.db, { workerId: `w${i % 2}`, limit: 30, leaseMs: 30_000 }),
      ),
    );
    const ids = claims.flat().map((r) => r.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(120);
  });

  it('only offers the oldest unpublished event of each project', async () => {
    const p = randomUUID();
    await seed(env, [projectEvent(p, 1), projectEvent(p, 2), projectEvent(randomUUID(), 1)]);
    const first = await claimOutboxBatch(env.database.db, {
      workerId: 'a',
      limit: 10,
      leaseMs: 30_000,
    });
    expect(first.map((r) => [r.partitionKey === p, r.event.aggregateVersion])).toEqual([
      [true, 1],
      [false, 1],
    ]);
    // Version 2 is not claimable by anyone while version 1 is unpublished, even though v1 is leased.
    expect(
      await claimOutboxBatch(env.database.db, { workerId: 'b', limit: 10, leaseMs: 30_000 }),
    ).toEqual([]);
  });

  it('respects a live lease and recovers an expired one (crashed worker)', async () => {
    await seed(env, [projectEvent(randomUUID(), 1)]);
    const [claimed] = await claimOutboxBatch(env.database.db, {
      workerId: 'crashed',
      limit: 10,
      leaseMs: 800,
    });
    expect(claimed).toBeDefined();
    expect(
      await claimOutboxBatch(env.database.db, { workerId: 'other', limit: 10, leaseMs: 30_000 }),
    ).toEqual([]);

    const reclaimed = await waitFor(
      async () =>
        (
          await claimOutboxBatch(env.database.db, { workerId: 'other', limit: 10, leaseMs: 30_000 })
        )[0],
      { timeoutMs: 10_000, description: 'the expired lease to be reclaimable' },
    );
    expect(reclaimed.eventId).toBe(claimed!.eventId);
  });
});

describe('failed attempts', () => {
  it('Invariant 7: never marks published without an acknowledgement; records the attempt and backs off', async () => {
    const e1 = projectEvent(randomUUID(), 1);
    const e2 = projectEvent(randomUUID(), 1);
    await seed(env, [e1, e2]);
    const sink = unreachableSink();
    const publisher = newPublisher(env, sink, { backoff: { baseMs: 10_000, maxMs: 60_000 } });

    const before = Date.now();
    const result = await publisher.runOnce();

    // Kafka unreachable: the batch stops after the first failure instead of trying every row.
    expect(result).toMatchObject({ claimed: 2, published: 0, failed: 1, aborted: true });
    expect(sink.attempts).toEqual([e1.eventId]);
    const [r1, r2] = await outboxRows(env);
    expect(r1).toMatchObject({
      published_at: null,
      attempt_count: 1,
      claimed_by: null,
      claimed_until: null,
    });
    expect(r1!.last_error).toMatch(/PublishError.*ECONNREFUSED/);
    expect(r1!.last_error!.length).toBeLessThanOrEqual(500);
    // First retry: 5–10 s later (base 10 s, equal jitter).
    const delay = r1!.next_attempt_at.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(4_000);
    expect(delay).toBeLessThanOrEqual(11_000);
    // The row that was never attempted is released untouched.
    expect(r2).toMatchObject({ published_at: null, attempt_count: 0, claimed_by: null });
    expect(publisher.ready).toBe(false);
  });

  it('backs off exponentially per row and never retries a row before its time', async () => {
    const event = projectEvent(randomUUID(), 1);
    await seed(env, [event]);
    const sink = unreachableSink();
    const publisher = newPublisher(env, sink, {
      backoff: { baseMs: 1_000, maxMs: 4_000 },
      random: () => 1,
    });

    const gaps: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      // Not eligible before next_attempt_at: a cycle right now claims nothing.
      if (attempt > 1) expect((await publisher.runOnce()).claimed).toBe(0);
      const [row] = await outboxRows(env);
      await waitFor(async () => (await publisher.runOnce()).failed === 1, {
        timeoutMs: 15_000,
        description: `attempt ${attempt}`,
      });
      const [after] = await outboxRows(env);
      gaps.push(after!.next_attempt_at.getTime() - after!.last_attempt_at!.getTime());
      expect(after!.attempt_count).toBe((row?.attempt_count ?? 0) + 1);
    }
    // 1 s, 2 s, 4 s, then capped at 4 s, with random() = 1.
    expect(gaps.map((g) => Math.round(g / 100) * 100)).toEqual([1_000, 2_000, 4_000, 4_000]);
    expect(sink.attempts).toEqual([event.eventId, event.eventId, event.eventId, event.eventId]);
  });

  it('keeps other projects flowing when one event is unpublishable (and holds that project back)', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const blocked = randomUUID();
    const healthy = randomUUID();
    const bad = projectEvent(blocked, 1);
    const behindBad = projectEvent(blocked, 2);
    const ok = projectEvent(healthy, 1);
    await seed(env, [bad, behindBad, ok]);
    // Corrupt the stored event so it fails validation at publish time (event-specific failure).
    await env.database.pool.query(
      `UPDATE outbox_events SET event = jsonb_set(event, '{payload,title}', '""') WHERE event_id = $1`,
      [bad.eventId],
    );

    const publisher = newPublisher(env, sinkFor(env, topic));
    const result = await publisher.runOnce();
    expect(result).toMatchObject({ claimed: 2, published: 1, failed: 1, aborted: false });
    await collector.waitForCount(1);
    expect(collector.received.map((r) => r.event.eventId)).toEqual([ok.eventId]);

    const rows = await outboxRows(env);
    expect(rows.find((r) => r.event_id === bad.eventId)).toMatchObject({
      published_at: null,
      attempt_count: 1,
    });
    // Ordering beats progress within a project: version 2 waits behind the failing version 1.
    expect(rows.find((r) => r.event_id === behindBad.eventId)).toMatchObject({
      published_at: null,
      attempt_count: 0,
    });
    await collector.stop();
    await publisher.stop();
  });
});

describe('Invariant 6 (end to end): two healthy publishers drain one outbox without duplicates', () => {
  it('publishes every event exactly once, in per-project order, split across both workers', async () => {
    const topic = await createTopic(env.kafka);
    const collector = await collectTopic(env, topic);
    const projects = Array.from({ length: 20 }, () => randomUUID());
    for (let v = 1; v <= 10; v++)
      await seed(
        env,
        projects.map((p) => projectEvent(p, v, undefined, p)),
      );

    const published = new Map<string, number>();
    const counting = (name: string): EventSink => {
      const inner = sinkFor(env, topic);
      return {
        connect: () => inner.connect(),
        close: (o) => inner.close(o),
        publish: async (event, options): Promise<PublishResult> => {
          const r = await inner.publish(event, options);
          published.set(name, (published.get(name) ?? 0) + 1);
          return r;
        },
      };
    };
    const a = newPublisher(env, counting('a'), { batchSize: 5, pollIntervalMs: 20 });
    const b = newPublisher(env, counting('b'), { batchSize: 5, pollIntervalMs: 20 });
    a.start();
    b.start();

    await waitFor(async () => (await outboxRows(env)).every((r) => r.published_at !== null), {
      timeoutMs: 120_000,
      description: 'all 200 events published',
    });
    await Promise.all([a.stop(), b.stop()]);
    await collector.waitForCount(200);
    await new Promise((r) => setTimeout(r, 1_000)); // a late duplicate would arrive here

    const ids = collector.received.map((r) => r.event.eventId);
    expect(ids.length).toBe(200);
    expect(new Set(ids).size).toBe(200); // no duplicates from racing healthy workers
    expect(published.get('a')! > 0 && published.get('b')! > 0).toBe(true);
    for (const p of projects) {
      const versions = collector.received
        .filter((r) => r.event.payload.projectId === p)
        .map((r) => r.event.aggregateVersion);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    await collector.stop();
  });
});
