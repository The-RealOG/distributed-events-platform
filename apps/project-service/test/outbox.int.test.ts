import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createHarness,
  createProjectFixture,
  createTask,
  type Harness,
  type ProjectFixture,
  type User,
} from './harness.js';

/**
 * Request-side outbox invariants (ADR-011), against a real PostgreSQL. There is no Kafka broker
 * and no publisher in this environment at all; the request path must not need them.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

interface OutboxRow {
  sequence_id: string;
  event_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_version: number;
  partition_key: string;
  correlation_id: string;
  published_at: Date | null;
  event: Record<string, any>;
}

async function outboxFor(projectId: string): Promise<OutboxRow[]> {
  const { rows } = await h.database.pool.query<OutboxRow>(
    'SELECT * FROM outbox_events WHERE partition_key = $1 ORDER BY sequence_id',
    [projectId],
  );
  return rows;
}

async function taskRow(id: string) {
  const { rows } = await h.database.pool.query(
    'SELECT version, title, column_id, deleted_at FROM tasks WHERE id = $1',
    [id],
  );
  return rows[0] as { version: number; title: string; column_id: string; deleted_at: Date | null };
}

/** h.call with an explicit correlation ID, as the gateway would forward it. */
function callAs(user: User, correlationId: string) {
  return (method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
    h.call(method, url, { as: user, body, headers: { 'x-correlation-id': correlationId } });
}

type FailureMode =
  'outbox insert fails' | 'outbox fails at commit' | 'domain write fails at commit';

/**
 * Makes one project's writes fail at a chosen point, using real triggers, to prove atomicity:
 * - outbox insert fails: BEFORE INSERT on outbox_events raises. Catches an event written after
 *   the domain transaction committed (the change would stay, without its event).
 * - outbox fails at commit: a DEFERRED constraint trigger on outbox_events raises at COMMIT,
 *   after both writes succeeded.
 * - domain write fails at commit: DEFERRED constraint triggers on tasks, comments and
 *   task_assignees raise at COMMIT. Catches an event written on another connection or in its own
 *   transaction (the event would commit although the change did not).
 */
interface Injection {
  /** How many times the injected failure fired (a sequence: increments survive rollback). */
  fired(): Promise<number>;
  restore(): Promise<void>;
}

async function injectFailure(projectId: string, mode: FailureMode): Promise<Injection> {
  const fn = `test_fail_${randomUUID().replace(/-/g, '')}`;
  await h.database.pool.query(`CREATE SEQUENCE ${fn}_fired`);
  // One branch per table: PL/pgSQL plans each IF branch separately, so a field is only resolved
  // on the table that has it. (A single OR-expression referencing NEW.partition_key and
  // NEW.project_id errors on *every* row of every table, making all concurrent writes fail.)
  await h.database.pool.query(`
    CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      hit boolean := false;
      affected_task uuid;
    BEGIN
      IF TG_TABLE_NAME = 'outbox_events' THEN
        hit := NEW.partition_key = '${projectId}';
      ELSIF TG_TABLE_NAME = 'tasks' THEN
        hit := NEW.project_id = '${projectId}';
      ELSE
        IF TG_OP = 'DELETE' THEN affected_task := OLD.task_id; ELSE affected_task := NEW.task_id; END IF;
        hit := EXISTS (SELECT 1 FROM tasks t WHERE t.id = affected_task AND t.project_id = '${projectId}');
      END IF;
      IF hit THEN
        PERFORM nextval('${fn}_fired');
        RAISE EXCEPTION 'injected failure for project ${projectId}';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;`);
  const triggers: [string, string][] =
    mode === 'outbox insert fails'
      ? [
          [
            'outbox_events',
            `CREATE TRIGGER ${fn} BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
          ],
        ]
      : (mode === 'outbox fails at commit'
          ? ['outbox_events']
          : ['tasks', 'comments', 'task_assignees']
        ).map((table) => [
          table,
          `CREATE CONSTRAINT TRIGGER ${fn} AFTER INSERT OR UPDATE OR DELETE ON ${table}
             DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
        ]);
  for (const [, ddl] of triggers) await h.database.pool.query(ddl);
  return {
    fired: async () => {
      const { rows } = await h.database.pool.query<{ n: string }>(
        `SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM ${fn}_fired`,
      );
      return Number(rows[0]!.n);
    },
    restore: async () => {
      for (const [table] of triggers) await h.database.pool.query(`DROP TRIGGER ${fn} ON ${table}`);
      await h.database.pool.query(`DROP FUNCTION ${fn}()`);
      await h.database.pool.query(`DROP SEQUENCE ${fn}_fired`);
    },
  };
}

describe('Invariant 1 + 9: every committed mutation has exactly one outbox event, at its post-mutation version', () => {
  it('writes one event per change, in order, with the committed version, actor, key and correlation ID', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f);
    const as = (cid: string) => callAs(f.owner, cid);

    const created = await as('corr-create')('POST', '/tasks', {
      projectId: f.projectId,
      columnId: f.columns[0]!.id,
      title: 'Draft',
    });
    const id = created.body.id as string;
    await as('corr-update')('PATCH', `/tasks/${id}`, { expectedVersion: 1, title: 'Final' });
    await as('corr-move')('POST', `/tasks/${id}/move`, {
      expectedVersion: 2,
      columnId: f.columns[1]!.id,
      afterTaskId: null,
    });
    await as('corr-assign')('POST', `/tasks/${id}/assignees`, { userId: member.id });
    const comment = await as('corr-comment')('POST', `/tasks/${id}/comments`, {
      body: 'Looks good',
    });
    await as('corr-unassign')('DELETE', `/tasks/${id}/assignees/${member.id}`);
    await as('corr-delete')('DELETE', `/tasks/${id}?expectedVersion=5`);

    const rows = await outboxFor(f.projectId);
    expect(rows.map((r) => [r.event_type, r.aggregate_version, r.correlation_id])).toEqual([
      ['task.created', 1, 'corr-create'],
      ['task.updated', 2, 'corr-update'],
      ['task.moved', 3, 'corr-move'],
      ['task.assigned', 4, 'corr-assign'],
      ['comment.created', 1, 'corr-comment'],
      ['task.unassigned', 5, 'corr-unassign'],
      ['task.deleted', 6, 'corr-delete'],
    ]);
    // The committed task version matches the last task event.
    expect((await taskRow(id)).version).toBe(6);

    for (const row of rows) {
      // The stored event is the complete envelope, with the same identity as the columns.
      expect(row.event).toMatchObject({
        eventId: row.event_id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        correlationId: row.correlation_id,
        producer: 'project-service',
        schemaVersion: 1,
        payload: { projectId: f.projectId, actorId: f.owner.id },
      });
      expect(row.partition_key).toBe(f.projectId);
      expect(row.published_at).toBeNull(); // nothing publishes in this environment
    }
    expect(new Set(rows.map((r) => r.event_id)).size).toBe(rows.length);

    const byType = Object.fromEntries(rows.map((r) => [r.event_type, r.event['payload']]));
    expect(byType['task.updated']).toEqual({
      projectId: f.projectId,
      actorId: f.owner.id,
      taskId: id,
      title: { previous: 'Draft', current: 'Final' },
      descriptionChanged: false,
    });
    expect(byType['task.moved']).toMatchObject({
      fromColumnId: f.columns[0]!.id,
      toColumnId: f.columns[1]!.id,
    });
    expect(byType['task.assigned']).toMatchObject({ assigneeId: member.id, title: 'Final' });
    expect(byType['comment.created']).toMatchObject({
      commentId: comment.body.id,
      taskId: id,
      excerpt: 'Looks good',
      bodyLength: 10,
    });
    expect(byType['task.deleted']).toEqual({
      projectId: f.projectId,
      actorId: f.owner.id,
      taskId: id,
      title: 'Final',
      columnId: f.columns[1]!.id,
    });
  });

  it('uses the version after the change, not the expectedVersion sent by the client (5 → 6 → 7 → 8)', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f);
    const task = await createTask(h, f, 'Versioned');
    for (let v = 1; v < 5; v++) {
      await h.call('PATCH', `/tasks/${task.id}`, {
        as: f.owner,
        body: { expectedVersion: v, title: `v${v + 1}` },
      });
    }
    expect((await taskRow(task.id)).version).toBe(5);

    await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 5, title: 'six' },
    });
    await h.call('POST', `/tasks/${task.id}/move`, {
      as: f.owner,
      body: { expectedVersion: 6, columnId: f.columns[2]!.id, afterTaskId: null },
    });
    await h.call('POST', `/tasks/${task.id}/assignees`, {
      as: f.owner,
      body: { userId: member.id },
    });

    const last3 = (await outboxFor(f.projectId)).slice(-3);
    expect(last3.map((r) => [r.event_type, r.aggregate_version])).toEqual([
      ['task.updated', 6],
      ['task.moved', 7],
      ['task.assigned', 8],
    ]);
    expect((await taskRow(task.id)).version).toBe(8);
  });

  it('gives a task exactly one event per version: versions 1..n with no gaps', async () => {
    const f = await createProjectFixture(h);
    const member = await addMember(h, f);
    const task = await createTask(h, f, 'Gapless');
    await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Gapless' },
    }); // no-op
    await h.call('POST', `/tasks/${task.id}/assignees`, {
      as: f.owner,
      body: { userId: member.id },
    });
    await h.call('POST', `/tasks/${task.id}/assignees`, {
      as: f.owner,
      body: { userId: member.id },
    }); // no-op
    await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 2, description: 'x' },
    });
    await h.call('DELETE', `/tasks/${task.id}/assignees/${f.owner.id}`, { as: f.owner }); // no-op

    const versions = (await outboxFor(f.projectId))
      .filter((r) => r.aggregate_id === task.id)
      .map((r) => r.aggregate_version);
    expect(versions).toEqual([1, 2, 3]);
    expect((await taskRow(task.id)).version).toBe(3);
  });
});

describe('no outbox event for requests that change nothing', () => {
  it('writes nothing for rejected, forbidden, invalid, no-op and read requests', async () => {
    const f = await createProjectFixture(h);
    const outsider = await h.login('outsider');
    const task = await createTask(h, f, 'Stable');
    const before = (await outboxFor(f.projectId)).length;

    const results = [
      await h.call('PATCH', `/tasks/${task.id}`, {
        as: f.owner,
        body: { expectedVersion: 9, title: 'x' },
      }), // 409
      await h.call('PATCH', `/tasks/${task.id}`, {
        as: outsider,
        body: { expectedVersion: 1, title: 'x' },
      }), // 403
      await h.call('PATCH', `/tasks/${task.id}`, {
        as: f.owner,
        body: { expectedVersion: 1, title: '' },
      }), // 400
      await h.call('PATCH', `/tasks/${task.id}`, {
        as: f.owner,
        body: { expectedVersion: 1, title: 'Stable' },
      }), // no-op
      await h.call('GET', `/tasks/${task.id}`, { as: f.owner }),
      await h.call('GET', `/projects/${f.projectId}/board`, { as: f.owner }),
    ];
    expect(results.map((r) => r.status)).toEqual([409, 403, 400, 200, 200, 200]);
    expect((await outboxFor(f.projectId)).length).toBe(before);
    expect((await taskRow(task.id)).version).toBe(1);
  });

  it('rejects a stale no-op save instead of reporting success', async () => {
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Same');
    await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Changed' },
    });
    const stale = await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Changed' },
    });
    expect(stale.status).toBe(409);
  });
});

interface Scenario {
  name: string;
  /** Prepares state; returns the request to perform and a snapshot function of the affected state. */
  setup: (f: ProjectFixture) => Promise<{
    act: () => Promise<{ status: number; body: any }>;
    snapshot: () => Promise<unknown>;
  }>;
}

const scenarios: Scenario[] = [
  {
    name: 'task.created',
    setup: async (f) => ({
      act: () =>
        h.call('POST', '/tasks', {
          as: f.owner,
          body: { projectId: f.projectId, columnId: f.columns[0]!.id, title: 'New' },
        }),
      snapshot: async () =>
        (
          await h.database.pool.query(
            'SELECT count(*)::int AS n FROM tasks WHERE project_id = $1',
            [f.projectId],
          )
        ).rows[0],
    }),
  },
  {
    name: 'task.updated',
    setup: async (f) => {
      const t = await createTask(h, f, 'Before');
      return {
        act: () =>
          h.call('PATCH', `/tasks/${t.id}`, {
            as: f.owner,
            body: { expectedVersion: 1, title: 'After' },
          }),
        snapshot: () => taskRow(t.id),
      };
    },
  },
  {
    name: 'task.moved',
    setup: async (f) => {
      const t = await createTask(h, f, 'Mover');
      return {
        act: () =>
          h.call('POST', `/tasks/${t.id}/move`, {
            as: f.owner,
            body: { expectedVersion: 1, columnId: f.columns[2]!.id, afterTaskId: null },
          }),
        snapshot: () => taskRow(t.id),
      };
    },
  },
  {
    name: 'task.deleted',
    setup: async (f) => {
      const t = await createTask(h, f, 'Doomed');
      return {
        act: () => h.call('DELETE', `/tasks/${t.id}?expectedVersion=1`, { as: f.owner }),
        snapshot: () => taskRow(t.id),
      };
    },
  },
  {
    name: 'task.assigned',
    setup: async (f) => {
      const t = await createTask(h, f, 'Assign me');
      const member = await addMember(h, f);
      return {
        act: () =>
          h.call('POST', `/tasks/${t.id}/assignees`, { as: f.owner, body: { userId: member.id } }),
        snapshot: async () => ({
          task: await taskRow(t.id),
          assignees: (
            await h.database.pool.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [
              t.id,
            ])
          ).rows,
        }),
      };
    },
  },
  {
    name: 'task.unassigned',
    setup: async (f) => {
      const t = await createTask(h, f, 'Unassign me');
      await h.call('POST', `/tasks/${t.id}/assignees`, {
        as: f.owner,
        body: { userId: f.owner.id },
      });
      return {
        act: () => h.call('DELETE', `/tasks/${t.id}/assignees/${f.owner.id}`, { as: f.owner }),
        snapshot: async () => ({
          task: await taskRow(t.id),
          assignees: (
            await h.database.pool.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [
              t.id,
            ])
          ).rows,
        }),
      };
    },
  },
  {
    name: 'comment.created',
    setup: async (f) => {
      const t = await createTask(h, f, 'Discussed');
      return {
        act: () =>
          h.call('POST', `/tasks/${t.id}/comments`, { as: f.owner, body: { body: 'hello' } }),
        snapshot: async () =>
          (
            await h.database.pool.query(
              'SELECT count(*)::int AS n FROM comments WHERE task_id = $1',
              [t.id],
            )
          ).rows[0],
      };
    },
  },
];

describe('Invariant 1 + 2: the mutation and its outbox event commit or roll back together', () => {
  for (const mode of [
    'outbox insert fails',
    'outbox fails at commit',
    'domain write fails at commit',
  ] as const) {
    for (const scenario of scenarios) {
      it(`${scenario.name}: when the ${mode}, nothing commits (no change, no event)`, async () => {
        const f = await createProjectFixture(h);
        const { act, snapshot } = await scenario.setup(f);
        const stateBefore = await snapshot();
        const eventsBefore = await outboxFor(f.projectId);

        const injection = await injectFailure(f.projectId, mode);
        let failed;
        let fired;
        try {
          failed = await act();
          fired = await injection.fired();
        } finally {
          await injection.restore();
        }

        // The injected failure (and not some other error) is what stopped the transaction…
        expect(fired).toBeGreaterThan(0);
        // …and the client learns it failed, without internals.
        expect(failed.status).toBe(500);
        expect(failed.body.error.code).toBe('INTERNAL');
        expect(JSON.stringify(failed.body)).not.toContain('injected');
        // Domain state (including task version and assignments) is exactly as before…
        expect(await snapshot()).toEqual(stateBefore);
        // …and no event exists for the rolled-back change.
        expect(await outboxFor(f.projectId)).toEqual(eventsBefore);

        // With the fault removed, the same request succeeds and writes exactly one event.
        const ok = await act();
        expect(ok.status).toBeLessThan(300);
        expect((await outboxFor(f.projectId)).length).toBe(eventsBefore.length + 1);
      });
    }
  }
});

describe('fault injection is scoped to its project', () => {
  for (const mode of [
    'outbox insert fails',
    'outbox fails at commit',
    'domain write fails at commit',
  ] as const) {
    it(`${mode}: other projects keep writing normally while it is installed`, async () => {
      const target = await createProjectFixture(h);
      const bystander = await createProjectFixture(h);
      const task = await createTask(h, bystander, 'Unaffected');
      const injection = await injectFailure(target.projectId, mode);
      try {
        const results = [
          await h.call('PATCH', `/tasks/${task.id}`, {
            as: bystander.owner,
            body: { expectedVersion: 1, title: 'Still fine' },
          }),
          await h.call('POST', `/tasks/${task.id}/assignees`, {
            as: bystander.owner,
            body: { userId: bystander.owner.id },
          }),
          await h.call('POST', `/tasks/${task.id}/comments`, {
            as: bystander.owner,
            body: { body: 'fine' },
          }),
          await h.call('DELETE', `/tasks/${task.id}/assignees/${bystander.owner.id}`, {
            as: bystander.owner,
          }),
        ];
        expect(results.map((r) => r.status)).toEqual([200, 200, 201, 204]);
        expect(await injection.fired()).toBe(0);
      } finally {
        await injection.restore();
      }
    });
  }
});

describe('Invariant 3: the request path does not depend on Kafka or the publisher', () => {
  it('commits mutations and returns promptly with no broker and no publisher anywhere', async () => {
    expect(process.env['KAFKA_BROKERS']).toBeUndefined();
    const f = await createProjectFixture(h);
    const task = await createTask(h, f, 'Fast');

    const started = performance.now();
    const res = await h.call('PATCH', `/tasks/${task.id}`, {
      as: f.owner,
      body: { expectedVersion: 1, title: 'Faster' },
    });
    const elapsed = performance.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(5_000);
    const [, updated] = await outboxFor(f.projectId);
    expect(updated).toMatchObject({ event_type: 'task.updated', published_at: null });
  });
});
