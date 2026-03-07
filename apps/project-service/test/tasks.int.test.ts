import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createHarness,
  createProjectFixture,
  createTask,
  type Harness,
  type ProjectFixture,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function columnTaskIds(f: ProjectFixture, columnIndex: number): Promise<string[]> {
  const board = await h.call('GET', `/projects/${f.projectId}/board`, { as: f.owner });
  return board.body.columns[columnIndex].tasks.map((t: { id: string }) => t.id);
}

describe('task CRUD', () => {
  it('creates, reads and updates a task, bumping the version', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Write spec');
    expect(task.version).toBe(1);

    const updated = await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Write the spec', description: 'Details' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      title: 'Write the spec',
      description: 'Details',
      version: 2,
    });
    expect((await h.call('GET', `/tasks/${task.id}`, { as: f.owner })).body.version).toBe(2);
  });

  it('rejects a column from another project', async () => {
    const f = await createProjectFixture(h);
    const other = await createProjectFixture(h);
    const res = await h.call('POST', '/tasks', {
      as: f.owner,
      body: { projectId: f.projectId, columnId: other.columns[0]!.id, title: 'x' },
    });
    expect(res.status).toBe(400);
  });

  it('validates input with safe, structured errors', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'T');

    const empty = await h.call('POST', '/tasks', {
      as: f.owner,
      body: { projectId: f.projectId, columnId: f.columns[0]!.id, title: '   ' },
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
    expect(empty.body.error.requestId).toEqual(expect.any(String));

    expect((await h.call('GET', '/tasks/not-a-uuid', { as: f.owner })).status).toBe(400);
    expect(
      (await h.call('PATCH', `/tasks/${task.id}`, { as: f.owner, body: { title: 'no version' } }))
        .status,
    ).toBe(400);
    expect(
      (await h.call('PATCH', `/tasks/${task.id}`, { as: f.owner, body: { expectedVersion: 1 } }))
        .status,
    ).toBe(400);
  });

  it('soft-deletes with a version check and hides the task afterwards', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Temporary');

    expect(
      (await h.call('DELETE', `/tasks/${task.id}?expectedVersion=7`, { as: f.owner })).status,
    ).toBe(409);
    expect(
      (await h.call('DELETE', `/tasks/${task.id}?expectedVersion=1`, { as: f.owner })).status,
    ).toBe(204);
    expect((await h.call('GET', `/tasks/${task.id}`, { as: f.owner })).status).toBe(404);
    expect(
      (await h.call('DELETE', `/tasks/${task.id}?expectedVersion=2`, { as: f.owner })).status,
    ).toBe(404);
    expect(await columnTaskIds(f, 0)).toEqual([]);
  });

  it('forbids non-members from reading or mutating tasks', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Secret');
    const outsider = await h.login('outsider');

    expect((await h.call('GET', `/tasks/${task.id}`, { as: outsider })).status).toBe(403);
    expect(
      (
        await h.call('PATCH', `/tasks/${task.id}`, {
          as: outsider,
          body: { expectedVersion: 1, title: 'x' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.call('POST', `/tasks/${task.id}/comments`, { as: outsider, body: { body: 'hi' } }))
        .status,
    ).toBe(403);
    expect(
      (
        await h.call('POST', '/tasks', {
          as: outsider,
          body: { projectId: f.projectId, columnId: f.columns[0]!.id, title: 'x' },
        })
      ).status,
    ).toBe(403);
  });
});

describe('optimistic concurrency', () => {
  it('returns 409 for a stale version and does not overwrite the newer change', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f);
    const task = await createTask(h, f, 'Original');

    const first = await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Owner edit' },
    });
    const stale = await h.call('PATCH', `/tasks/${task.id}`, {
      as: member,
      body: { expectedVersion: 1, title: 'Member edit' },
    });

    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
    expect((await h.call('GET', `/tasks/${task.id}`, { as: f.owner })).body.title).toBe(
      'Owner edit',
    );
  });

  it('lets exactly one of many parallel updates win (smoke test; see concurrency.int.test.ts)', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Contended');
    const writers = 12;

    const results = await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        h.call('PATCH', `/tasks/${task.id}`, {
          as: f.owner,
          body: { expectedVersion: 1, title: `writer-${i}` },
        }),
      ),
    );

    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(writers - 1);

    const final = (await h.call('GET', `/tasks/${task.id}`, { as: f.owner })).body;
    expect(final.version).toBe(2);
    expect(final.title).toBe(winners[0]!.body.title);
  });

  it('serializes concurrent moves of the same task the same way', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Moving');
    const results = await Promise.all(
      [1, 2].map((col) =>
        h.call('POST', `/tasks/${task.id}/move`, {
          as: f.owner,
          body: { expectedVersion: 1, columnId: f.columns[col]!.id, afterTaskId: null },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('moving and ordering', () => {
  it('moves across columns to the top, after an anchor, and to the end', async () => {
    const f = await createProjectFixture(h);
    const [a, b, c] = [
      await createTask(h, f, 'A', 1),
      await createTask(h, f, 'B', 1),
      await createTask(h, f, 'C', 1),
    ];
    const x = await createTask(h, f, 'X');
    const y = await createTask(h, f, 'Y');
    const z = await createTask(h, f, 'Z');
    const move = (id: string, version: number, afterTaskId: string | null) =>
      h.call('POST', `/tasks/${id}/move`, {
        as: f.owner,
        body: { expectedVersion: version, columnId: f.columns[1]!.id, afterTaskId },
      });

    expect((await move(x.id, 1, null)).body.columnId).toBe(f.columns[1]!.id);
    expect(await columnTaskIds(f, 1)).toEqual([x.id, a.id, b.id, c.id]);

    await move(y.id, 1, a.id);
    expect(await columnTaskIds(f, 1)).toEqual([x.id, a.id, y.id, b.id, c.id]);

    await move(z.id, 1, c.id);
    expect(await columnTaskIds(f, 1)).toEqual([x.id, a.id, y.id, b.id, c.id, z.id]);
    expect(await columnTaskIds(f, 0)).toEqual([]);
  });

  it('keeps positions distinct under repeated insertion into the same gap', async () => {
    const f = await createProjectFixture(h);
    const first = await createTask(h, f, 'first');
    const last = await createTask(h, f, 'last');
    const inserted: string[] = [];
    // Each new task goes directly after `first`, halving the same gap every time.
    for (let i = 0; i < 40; i++) {
      const t = await createTask(h, f, `n${i}`, 1);
      const res = await h.call('POST', `/tasks/${t.id}/move`, {
        as: f.owner,
        body: { expectedVersion: 1, columnId: f.columns[0]!.id, afterTaskId: first.id },
      });
      expect(res.status).toBe(200);
      inserted.unshift(t.id);
    }
    expect(await columnTaskIds(f, 0)).toEqual([first.id, ...inserted, last.id]);
  });

  it('rejects invalid anchors and stale versions', async () => {
    const f = await createProjectFixture(h);
    const a = await createTask(h, f, 'A');
    const b = await createTask(h, f, 'B', 1);
    const move = (body: object) => h.call('POST', `/tasks/${a.id}/move`, { as: f.owner, body });

    expect(
      (await move({ expectedVersion: 1, columnId: f.columns[2]!.id, afterTaskId: b.id })).status,
    ).toBe(400);
    expect(
      (await move({ expectedVersion: 1, columnId: f.columns[0]!.id, afterTaskId: a.id })).status,
    ).toBe(400);
    expect(
      (await move({ expectedVersion: 9, columnId: f.columns[1]!.id, afterTaskId: null })).status,
    ).toBe(409);
  });
});

describe('assignees and comments', () => {
  it('assigns workspace members idempotently and rejects non-members', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f);
    const outsider = await h.login('outsider');
    const task = await createTask(h, f, 'Assignable');
    const assign = (userId: string) =>
      h.call('POST', `/tasks/${task.id}/assignees`, { as: f.owner, body: { userId } });

    const once = await assign(member.id);
    const twice = await assign(member.id);
    expect(once.body).toMatchObject({ assigneeIds: [member.id], version: 2 });
    expect(twice.body).toMatchObject({ assigneeIds: [member.id], version: 2 });
    expect((await assign(outsider.id)).status).toBe(400);

    expect(
      (await h.call('DELETE', `/tasks/${task.id}/assignees/${member.id}`, { as: f.owner })).status,
    ).toBe(204);
    expect(
      (await h.call('DELETE', `/tasks/${task.id}/assignees/${member.id}`, { as: f.owner })).status,
    ).toBe(204);
    const after = (await h.call('GET', `/tasks/${task.id}`, { as: f.owner })).body;
    expect(after).toMatchObject({ assigneeIds: [], version: 3 });
  });

  it('adds and lists comments in order with author names', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f);
    const task = await createTask(h, f, 'Discuss');

    await h.call('POST', `/tasks/${task.id}/comments`, { as: f.owner, body: { body: 'first' } });
    const second = await h.call('POST', `/tasks/${task.id}/comments`, {
      as: member,
      body: { body: 'second' },
    });
    expect(second.status).toBe(201);

    const list = (await h.call('GET', `/tasks/${task.id}/comments`, { as: member })).body;
    expect(list.map((c: { body: string }) => c.body)).toEqual(['first', 'second']);
    expect(list[1]).toMatchObject({ authorId: member.id, authorDisplayName: 'member' });
  });
});
