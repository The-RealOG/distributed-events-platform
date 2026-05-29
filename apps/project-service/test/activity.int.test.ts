import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createHarness,
  createProjectFixture,
  createTask,
  type Harness,
  type ProjectFixture,
} from './harness.js';

/**
 * GET /projects/:id/activity reads the projection the Activity Service writes (ADR-014). Here
 * rows are inserted directly, as the Activity Service would; its consumption is tested in
 * apps/activity-service and end to end in tests/integration.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function seed(
  f: ProjectFixture,
  count: number,
  extra: { actorId?: string; data?: Record<string, unknown>; eventType?: string } = {},
) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const eventId = randomUUID();
    ids.push(eventId);
    await h.database.pool.query(
      `INSERT INTO activity_events (event_id, project_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, task_id, actor_id, data, correlation_id, occurred_at)
       VALUES ($1, $2, $3, 'task', $4, $5, $4, $6, $7, $8, now())`,
      [
        eventId,
        f.projectId,
        extra.eventType ?? 'task.updated',
        randomUUID(),
        i + 1,
        extra.actorId ?? f.owner.id,
        JSON.stringify(extra.data ?? { n: i }),
        `corr-${i}`,
      ],
    );
  }
  return ids;
}

describe('GET /projects/:id/activity', () => {
  it('is empty for a project with no activity yet', async () => {
    const f = await createProjectFixture(h);
    const res = await h.call('GET', `/projects/${f.projectId}/activity`, { as: f.owner });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null, people: {} });
  });

  it('is not written by the request path: a successful change is not listed until the projection catches up', async () => {
    const f = await createProjectFixture(h);
    await createTask(h, f, 'Async');
    const res = await h.call('GET', `/projects/${f.projectId}/activity`, { as: f.owner });
    expect(res.body.items).toEqual([]);
  });

  it('lists newest first, with structured data, correlation ID and actor names', async () => {
    const f = await createProjectFixture(h);
    const assignee = await addMember(h, f);
    const [firstId] = await seed(f, 1, { eventType: 'task.created', data: { title: 'A' } });
    const [secondId] = await seed(f, 1, {
      eventType: 'task.assigned',
      data: { title: 'A', assigneeId: assignee.id },
    });
    const res = await h.call('GET', `/projects/${f.projectId}/activity`, { as: f.owner });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { eventId: string }) => i.eventId)).toEqual([secondId, firstId]);
    expect(res.body.items[0]).toMatchObject({
      eventType: 'task.assigned',
      actorId: f.owner.id,
      data: { title: 'A', assigneeId: assignee.id },
      correlationId: 'corr-0',
      occurredAt: expect.any(String),
    });
    expect(Object.keys(res.body.people).sort()).toEqual([f.owner.id, assignee.id].sort());
  });

  it('pages with a cursor: no overlaps, no gaps, stable under new activity', async () => {
    const f = await createProjectFixture(h);
    const ids = await seed(f, 7);
    const newestFirst = [...ids].reverse();

    const page1 = await h.call('GET', `/projects/${f.projectId}/activity?limit=3`, { as: f.owner });
    expect(page1.body.items.map((i: { eventId: string }) => i.eventId)).toEqual(
      newestFirst.slice(0, 3),
    );
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    // New activity arriving between page requests does not shift the older pages.
    await seed(f, 2);

    const page2 = await h.call(
      'GET',
      `/projects/${f.projectId}/activity?limit=3&before=${page1.body.nextCursor}`,
      { as: f.owner },
    );
    expect(page2.body.items.map((i: { eventId: string }) => i.eventId)).toEqual(
      newestFirst.slice(3, 6),
    );
    const page3 = await h.call(
      'GET',
      `/projects/${f.projectId}/activity?limit=3&before=${page2.body.nextCursor}`,
      { as: f.owner },
    );
    expect(page3.body.items.map((i: { eventId: string }) => i.eventId)).toEqual(
      newestFirst.slice(6),
    );
    expect(page3.body.nextCursor).toBeNull();
  });

  it('bounds the page size and rejects malformed cursors', async () => {
    const f = await createProjectFixture(h);
    await seed(f, 30);
    const res = await h.call('GET', `/projects/${f.projectId}/activity`, { as: f.owner });
    expect(res.body.items).toHaveLength(25);
    for (const q of ['limit=0', 'limit=101', 'before=abc', 'before=-1', 'before=0']) {
      const bad = await h.call('GET', `/projects/${f.projectId}/activity?${q}`, { as: f.owner });
      expect(bad.status, q).toBe(400);
    }
  });

  it('shows each project only its own activity', async () => {
    const [a, b] = [await createProjectFixture(h), await createProjectFixture(h)];
    const [ia] = await seed(a, 1);
    const [ib] = await seed(b, 1);
    const resA = await h.call('GET', `/projects/${a.projectId}/activity`, { as: a.owner });
    const resB = await h.call('GET', `/projects/${b.projectId}/activity`, { as: b.owner });
    expect(resA.body.items.map((i: { eventId: string }) => i.eventId)).toEqual([ia]);
    expect(resB.body.items.map((i: { eventId: string }) => i.eventId)).toEqual([ib]);
  });

  it('applies project authorization: members read; others get 403; unknown project 404; anonymous 401', async () => {
    const f = await createProjectFixture(h);
    await seed(f, 1);
    const member = await addMember(h, f);
    const outsider = await h.login('outsider');

    expect((await h.call('GET', `/projects/${f.projectId}/activity`, { as: member })).status).toBe(
      200,
    );
    const denied = await h.call('GET', `/projects/${f.projectId}/activity`, { as: outsider });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain('corr-0');
    expect(
      (await h.call('GET', `/projects/${randomUUID()}/activity`, { as: f.owner })).status,
    ).toBe(404);
    expect((await h.call('GET', `/projects/${f.projectId}/activity`)).status).toBe(401);
  });
});
