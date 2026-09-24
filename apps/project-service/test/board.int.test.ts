import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createHarness,
  createProjectFixture,
  createTask,
  type Harness,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('projects and boards', () => {
  it('creates a project with a board and default columns atomically', async () => {
    const f = await createProjectFixture(h);
    expect(f.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done']);

    const list = await h.call('GET', `/workspaces/${f.workspaceId}/projects`, { as: f.owner });
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([f.projectId]);
  });

  it('only lets ADMIN and above create projects', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f, 'MEMBER');
    const admin = await addMember(h, f, 'ADMIN');
    const body = { workspaceId: f.workspaceId, name: 'Side quest' };

    expect((await h.call('POST', '/projects', { as: member, body })).status).toBe(403);
    expect((await h.call('POST', '/projects', { as: admin, body })).status).toBe(201);
  });

  it('returns tasks grouped by column in position order, with assignees', async () => {
    const f = await createProjectFixture(h);
    const a = await createTask(h, f, 'A');
    const b = await createTask(h, f, 'B');
    const c = await createTask(h, f, 'C', 1);
    await h.call('POST', `/tasks/${b.id}/assignees`, { as: f.owner, body: { userId: f.owner.id } });

    const board = (await h.call('GET', `/projects/${f.projectId}/board`, { as: f.owner })).body;
    expect(board.columns[0].tasks.map((t: { id: string }) => t.id)).toEqual([a.id, b.id]);
    expect(board.columns[1].tasks.map((t: { id: string }) => t.id)).toEqual([c.id]);
    expect(board.columns[0].tasks[1].assigneeIds).toEqual([f.owner.id]);
  });

  it('hides the board from non-members and 404s unknown projects', async () => {
    const f = await createProjectFixture(h);
    const outsider = await h.login('outsider');
    expect((await h.call('GET', `/projects/${f.projectId}/board`, { as: outsider })).status).toBe(
      403,
    );
    expect((await h.call('GET', `/projects/${f.projectId}`, { as: outsider })).status).toBe(403);
    expect(
      (await h.call('GET', '/projects/00000000-0000-4000-8000-000000000000/board', { as: f.owner }))
        .status,
    ).toBe(404);
  });

  it('every board read is one snapshot: under concurrent moves each task appears exactly once, and the wire format is stable', async () => {
    const f = await createProjectFixture(h);
    const tasks = [];
    for (let i = 0; i < 12; i++) tasks.push(await createTask(h, f, `T${i}`, i % 3));
    const versions = new Map(tasks.map((t) => [t.id, t.version]));
    let moving = true;
    const mover = (async () => {
      for (let round = 0; moving && round < 200; round++) {
        await Promise.all(
          tasks.map(async (t, i) => {
            const res = await h.call('POST', `/tasks/${t.id}/move`, {
              as: f.owner,
              body: {
                expectedVersion: versions.get(t.id),
                columnId: f.columns[(i + round) % 3]!.id,
                afterTaskId: null,
              },
            });
            if (res.status === 200) versions.set(t.id, res.body.version);
          }),
        );
      }
    })();
    for (let read = 0; read < 40; read++) {
      const board = await h.call('GET', `/projects/${f.projectId}/board`, { as: f.owner });
      expect(board.status).toBe(200);
      const ids = board.body.columns.flatMap((c: { tasks: { id: string }[] }) =>
        c.tasks.map((t) => t.id),
      );
      expect(ids.sort()).toEqual(tasks.map((t) => t.id).sort());
    }
    moving = false;
    await mover;
    const board = await h.call('GET', `/projects/${f.projectId}/board`, { as: f.owner });
    const one = board.body.columns.flatMap((c: { tasks: unknown[] }) => c.tasks)[0];
    // Same shape and formats as GET /tasks/:id (timestamps with millisecond precision, Z).
    const single = await h.call('GET', `/tasks/${(one as { id: string }).id}`, { as: f.owner });
    expect(one).toEqual(single.body);
    expect((one as { createdAt: string }).createdAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );
  });
});
