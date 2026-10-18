import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRetention } from '../src/retention.js';
import {
  createTestEnv,
  outboxRows,
  projectEvent,
  resetOutbox,
  seed,
  type TestEnv,
} from './support.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => resetOutbox(env));

async function setAge(eventId: string, column: 'published_at' | 'created_at', hoursAgo: number) {
  await env.database.pool.query(
    `UPDATE outbox_events SET ${column} = now() - make_interval(hours => $2) WHERE event_id = $1`,
    [eventId, hoursAgo],
  );
}

describe('outbox retention', () => {
  it('deletes only events published before the retention, never pending ones', async () => {
    const oldPublished = projectEvent(randomUUID(), 1);
    const oldPublishedOtherProject = projectEvent(randomUUID(), 1);
    const recentPublished = projectEvent(randomUUID(), 1);
    const oldPending = projectEvent(randomUUID(), 1);
    await seed(env, [oldPublished, oldPublishedOtherProject, recentPublished, oldPending]);
    await setAge(oldPublished.eventId, 'published_at', 200);
    await setAge(oldPublishedOtherProject.eventId, 'published_at', 200);
    await setAge(recentPublished.eventId, 'published_at', 1);
    // Created long ago and still owed to Kafka: must survive any retention.
    await setAge(oldPending.eventId, 'created_at', 300);

    // Batch size 1 exercises the repeat-while-full loop.
    const retention = new OutboxRetention({
      db: env.database.db,
      logger: env.logger,
      olderThanHours: 168,
      intervalMs: 60_000,
      batchSize: 1,
    });
    const deleted = await retention.runOnce();

    expect(deleted).toBe(2);
    const remaining = (await outboxRows(env)).map((r) => r.event_id).sort();
    expect(remaining).toEqual([recentPublished.eventId, oldPending.eventId].sort());
    const pending = (await outboxRows(env)).find((r) => r.event_id === oldPending.eventId);
    expect(pending?.published_at).toBeNull();
  });

  it('deletes nothing when every published event is within the retention', async () => {
    const event = projectEvent(randomUUID(), 1);
    await seed(env, [event]);
    await setAge(event.eventId, 'published_at', 1);

    const retention = new OutboxRetention({
      db: env.database.db,
      logger: env.logger,
      olderThanHours: 168,
      intervalMs: 60_000,
    });

    expect(await retention.runOnce()).toBe(0);
    expect(await outboxRows(env)).toHaveLength(1);
  });
});
