import * as schema from '@dpp/database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateTaskIfVersion } from '../src/modules/tasks/repository.js';
import { createHarness, createProjectFixture, createTask, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const settled = async (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

describe('conditional version update under a forced interleaving', () => {
  // HTTP-level races are timing-dependent. This drives two real transactions into the exact
  // interleaving that a lost update needs: both have read version 1, T1 writes and holds the
  // row lock, T2's write blocks, T1 commits. T2 must then match zero rows.
  it('lets the second writer observe the first commit and apply nothing', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Original');

    const c1 = await h.database.pool.connect();
    const c2 = await h.database.pool.connect();
    try {
      const tx1 = drizzle(c1, { schema });
      const tx2 = drizzle(c2, { schema });
      await c1.query('begin');
      await c2.query('begin');

      const first = await updateTaskIfVersion(tx1, task.id, 1, { title: 'first writer' });
      expect(first?.version).toBe(2);

      const second = updateTaskIfVersion(tx2, task.id, 1, { title: 'second writer' });
      expect(await settled(second, 300)).toBe(false); // blocked on T1's row lock

      await c1.query('commit');
      expect(await second).toBeUndefined();
      await c2.query('commit');
    } finally {
      c1.release();
      c2.release();
    }

    const final = (await h.call('GET', `/tasks/${task.id}`, { as: f.owner })).body;
    expect(final).toMatchObject({ title: 'first writer', version: 2 });
  });
});
