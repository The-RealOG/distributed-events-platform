import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteExpiredIdempotencyKeys } from '../src/http/idempotency.js';
import {
  addMember,
  createHarness,
  createProjectFixture,
  type Harness,
  type ProjectFixture,
  type User,
} from './harness.js';

/** Idempotency-Key on create requests, against a real PostgreSQL. */
let h: Harness;
let fx: ProjectFixture;
beforeAll(async () => {
  h = await createHarness();
  fx = await createProjectFixture(h);
});
afterAll(() => h.close());

const createTask = (
  title: string,
  key?: string,
  as: User = fx.owner,
  columnId = fx.columns[0]!.id,
) =>
  h.call('POST', '/tasks', {
    as,
    body: { projectId: fx.projectId, columnId, title },
    ...(key ? { headers: { 'idempotency-key': key } } : {}),
  });

async function countTasks(title: string): Promise<number> {
  const { rows } = await h.database.pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM tasks WHERE project_id = $1 AND title = $2',
    [fx.projectId, title],
  );
  return Number(rows[0]!.n);
}

async function countCreatedEvents(taskId: string): Promise<number> {
  const { rows } = await h.database.pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'task.created'`,
    [taskId],
  );
  return Number(rows[0]!.n);
}

describe('Idempotency-Key on POST /tasks', () => {
  it('replays the first response for a retry: one task and one event', async () => {
    const key = randomUUID();

    const first = await createTask('retried', key);
    const retry = await createTask('retried', key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await countTasks('retried')).toBe(1);
    expect(await countCreatedEvents(first.body.id)).toBe(1);
  });

  it('creates once when duplicates arrive concurrently', async () => {
    const key = randomUUID();

    const responses = await Promise.all(Array.from({ length: 5 }, () => createTask('raced', key)));

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await countTasks('raced')).toBe(1);
  });

  it('refuses a key reused for a different request, without creating anything', async () => {
    const key = randomUUID();
    await createTask('original', key);

    const reused = await createTask('something else', key);

    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await countTasks('something else')).toBe(0);
  });

  it('frees the key when the first attempt rolls back', async () => {
    const key = randomUUID();
    const foreignColumn = randomUUID();

    const failed = await createTask('after rollback', key, fx.owner, foreignColumn);
    // Same key, now a valid request: the failed attempt's key row was rolled back with it.
    const retried = await createTask('after rollback', key);

    expect(failed.status).toBe(400);
    expect(retried.status).toBe(201);
    expect(await countTasks('after rollback')).toBe(1);
  });

  it('scopes keys to the user who sent them', async () => {
    const member = await addMember(h, fx);
    const key = randomUUID();

    const mine = await createTask('per user', key);
    const theirs = await createTask('per user', key, member);

    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(mine.body.id);
    expect(await countTasks('per user')).toBe(2);
  });

  it('keeps creating a new task per request when no key is sent', async () => {
    await createTask('no key');
    await createTask('no key');

    expect(await countTasks('no key')).toBe(2);
  });

  it('rejects a malformed key', async () => {
    const res = await createTask('bad key', 'has spaces in it');

    expect(res.status).toBe(400);
    expect(await countTasks('bad key')).toBe(0);
  });
});

describe('Idempotency-Key on POST /tasks/:id/comments', () => {
  it('adds one comment for a retried request', async () => {
    const task = (await createTask('commented')).body;
    const key = randomUUID();
    const comment = (k: string) =>
      h.call('POST', `/tasks/${task.id}/comments`, {
        as: fx.owner,
        body: { body: 'only once' },
        headers: { 'idempotency-key': k },
      });

    const first = await comment(key);
    const retry = await comment(key);

    expect(retry.body).toEqual(first.body);
    const { rows } = await h.database.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM comments WHERE task_id = $1',
      [task.id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe('idempotency key expiry', () => {
  it('deletes keys older than the retention and keeps newer ones', async () => {
    const oldKey = randomUUID();
    const newKey = randomUUID();
    await createTask('expiring old', oldKey);
    await createTask('expiring new', newKey);
    await h.database.pool.query(
      `UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = $1`,
      [oldKey],
    );

    await h.database.db.transaction((tx) => deleteExpiredIdempotencyKeys(tx, 24));

    const { rows } = await h.database.pool.query<{ key: string }>(
      'SELECT key FROM idempotency_keys WHERE key = ANY($1)',
      [[oldKey, newKey]],
    );
    expect(rows.map((r) => r.key)).toEqual([newKey]);
  });
});
