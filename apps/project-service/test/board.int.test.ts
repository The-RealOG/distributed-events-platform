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
});
