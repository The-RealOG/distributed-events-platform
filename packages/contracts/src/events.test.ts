import { describe, expect, it } from 'vitest';
import {
  commentEvents,
  createDomainEvent,
  decodeDomainEvent,
  DOMAIN_EVENT_TYPES,
  parseDomainEvent,
  partitionKeyOf,
  taskEvents,
  type DomainEvent,
  type EventContext,
  type TaskSnapshot,
} from './events.js';

const ctx: EventContext = { producer: 'project-service', correlationId: 'corr-8f2a' };
const actor = '11111111-1111-4111-8111-111111111111';
const assignee = '22222222-2222-4222-8222-222222222222';
const task: TaskSnapshot = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: '44444444-4444-4444-8444-444444444444',
  columnId: '55555555-5555-4555-8555-555555555555',
  title: 'Write spec',
  position: '2048.5',
  version: 3,
};
const otherColumn = '66666666-6666-4666-8666-666666666666';
const comment = {
  id: '77777777-7777-4777-8777-777777777777',
  taskId: task.id,
  authorId: actor,
  body: 'LGTM',
};

/** One valid event of every type, built through the public factories. */
function oneOfEach(): Record<DomainEvent['eventType'], DomainEvent> {
  return {
    'task.created': taskEvents.created(ctx, actor, { ...task, version: 1 }),
    'task.updated': taskEvents.updated(
      ctx,
      actor,
      { title: 'Old', description: '' },
      { ...task, description: 'x' },
    ),
    'task.moved': taskEvents.moved(ctx, actor, otherColumn, task),
    'task.deleted': taskEvents.deleted(ctx, actor, task),
    'task.assigned': taskEvents.assigned(ctx, actor, task, assignee),
    'task.unassigned': taskEvents.unassigned(ctx, actor, task, assignee),
    'comment.created': commentEvents.created(ctx, comment, {
      projectId: task.projectId,
      title: task.title,
    }),
  };
}

/** A mutable, untyped copy of an event: the shape a malicious or buggy producer could send. */
type Json = Record<string, unknown>;
type RawEvent = Json & { payload: Json };

const roundTrip = (event: unknown) => decodeDomainEvent(JSON.stringify(event));
const clone = (event: DomainEvent) => structuredClone(event) as unknown as RawEvent;

describe('event factories', () => {
  it('builds a valid, fully-populated event for every type', () => {
    const events = oneOfEach();
    expect(Object.keys(events).sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    for (const event of Object.values(events)) {
      expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.occurredAt).toMatch(/Z$/);
      expect(event).toMatchObject({
        schemaVersion: 1,
        producer: 'project-service',
        correlationId: 'corr-8f2a',
      });
      expect(roundTrip(event)).toEqual({ ok: true, event });
    }
  });

  it('uses the task id and post-mutation version as aggregate identity', () => {
    const moved = taskEvents.moved(ctx, actor, otherColumn, task);
    expect(moved).toMatchObject({
      aggregateType: 'task',
      aggregateId: task.id,
      aggregateVersion: 3,
    });
    expect(moved.payload).toMatchObject({
      fromColumnId: otherColumn,
      toColumnId: task.columnId,
      position: '2048.5',
    });
  });

  it('records title changes with before/after and only a flag for descriptions', () => {
    const e = taskEvents.updated(
      ctx,
      actor,
      { title: 'Old', description: 'a' },
      { ...task, description: 'b' },
    );
    expect(e.payload).toEqual({
      projectId: task.projectId,
      actorId: actor,
      taskId: task.id,
      title: { previous: 'Old', current: 'Write spec' },
      descriptionChanged: true,
    });
    expect(JSON.stringify(e)).not.toContain('"b"');
  });

  it('refuses to build an update that changes nothing', () => {
    expect(() =>
      taskEvents.updated(
        ctx,
        actor,
        { title: task.title, description: 'same' },
        { ...task, description: 'same' },
      ),
    ).toThrow();
  });

  it('makes invalid construction fail at the producer', () => {
    expect(() => taskEvents.created(ctx, actor, { ...task, title: '' })).toThrow();
    expect(() => taskEvents.created(ctx, 'not-a-uuid', task)).toThrow();
    expect(() =>
      taskEvents.created({ ...ctx, correlationId: 'has spaces' }, actor, task),
    ).toThrow();
    expect(() => taskEvents.created(ctx, actor, { ...task, position: '1e3' })).toThrow();
  });

  it('keeps comment bodies out of events except for a bounded excerpt', () => {
    const body = 'x'.repeat(5_000);
    const e = commentEvents.created(
      ctx,
      { ...comment, body },
      { projectId: task.projectId, title: task.title },
    );
    expect(e.payload.excerpt).toHaveLength(280);
    expect(e.payload.bodyLength).toBe(5_000);
    expect(e).toMatchObject({
      aggregateType: 'comment',
      aggregateId: comment.id,
      aggregateVersion: 1,
    });
  });

  it('passes the correlation and causation IDs through unchanged', () => {
    const e = taskEvents.created(
      { ...ctx, correlationId: 'Req-1.a:b_c-9', causationId: 'evt-parent' },
      actor,
      task,
    );
    const parsed = roundTrip(e);
    expect(parsed.ok && parsed.event.correlationId).toBe('Req-1.a:b_c-9');
    expect(parsed.ok && parsed.event.causationId).toBe('evt-parent');
  });

  it('keys every event by its project', () => {
    for (const event of Object.values(oneOfEach()))
      expect(partitionKeyOf(event)).toBe(task.projectId);
  });
});

describe('parsing and classification', () => {
  const valid = () => clone(taskEvents.moved(ctx, actor, otherColumn, task));

  it('rejects bytes that are not JSON', () => {
    expect(decodeDomainEvent('{"eventId":')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(decodeDomainEvent(null)).toEqual({ ok: false, reason: 'invalid_json' });
    expect(decodeDomainEvent(new TextEncoder().encode('\u0000garbage'))).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
  });

  it('rejects JSON that is not an envelope', () => {
    for (const value of [42, 'text', [], {}, { hello: 'world' }]) {
      expect(parseDomainEvent(value)).toMatchObject({ ok: false, reason: 'invalid_envelope' });
    }
  });

  it.each([
    ['missing eventId', (e: RawEvent) => delete e['eventId']],
    ['non-UUID eventId', (e: RawEvent) => (e['eventId'] = 'evt-1')],
    ['non-UUID aggregateId', (e: RawEvent) => (e['aggregateId'] = '1234')],
    ['occurredAt not a timestamp', (e: RawEvent) => (e['occurredAt'] = 'yesterday')],
    ['occurredAt not in UTC', (e: RawEvent) => (e['occurredAt'] = '2026-01-01T10:00:00+02:00')],
    ['aggregateVersion 0', (e: RawEvent) => (e['aggregateVersion'] = 0)],
    ['unsafe correlationId', (e: RawEvent) => (e['correlationId'] = 'a b\nc')],
    ['missing producer', (e: RawEvent) => delete e['producer']],
    ['schemaVersion as string', (e: RawEvent) => (e['schemaVersion'] = '1')],
  ])('rejects invalid metadata: %s', (_name, mutate) => {
    const e = valid();
    mutate(e);
    expect(parseDomainEvent(e)).toMatchObject({ ok: false, reason: 'invalid_envelope' });
  });

  it('keeps the eventId of a bad envelope when it is a valid UUID, for diagnostics', () => {
    const e = valid();
    delete e['producer'];
    expect(parseDomainEvent(e)).toMatchObject({
      reason: 'invalid_envelope',
      eventId: e['eventId'],
    });
  });

  it.each([2, 900])(
    'rejects unsupported schemaVersion %i instead of reading it as v1',
    (version) => {
      const e = valid();
      e['schemaVersion'] = version;
      expect(parseDomainEvent(e)).toMatchObject({
        ok: false,
        reason: 'unsupported_schema_version',
        schemaVersion: version,
      });
    },
  );

  it('checks the schema version before anything type-specific', () => {
    const e = valid();
    e['schemaVersion'] = 2;
    e['eventType'] = 'task.teleported';
    e['payload'] = { entirely: 'different' };
    expect(parseDomainEvent(e)).toMatchObject({ reason: 'unsupported_schema_version' });
  });

  it('classifies unknown event types', () => {
    const e = valid();
    e['eventType'] = 'task.teleported';
    expect(parseDomainEvent(e)).toMatchObject({
      ok: false,
      reason: 'unknown_event_type',
      eventType: 'task.teleported',
    });
  });

  it('rejects a payload that belongs to a different event type', () => {
    const e = valid();
    e['payload'] = clone(taskEvents.created(ctx, actor, task))['payload'];
    expect(parseDomainEvent(e)).toMatchObject({
      ok: false,
      reason: 'invalid_payload',
      eventType: 'task.moved',
    });
  });

  it.each(DOMAIN_EVENT_TYPES)('rejects %s with a required payload field missing', (type) => {
    const e = clone(oneOfEach()[type]);
    delete e['payload']['projectId'];
    expect(parseDomainEvent(e)).toMatchObject({ ok: false, reason: 'invalid_payload' });
  });

  it('rejects an aggregateId that does not match the payload', () => {
    const e = valid();
    e['aggregateId'] = assignee;
    expect(parseDomainEvent(e)).toMatchObject({ ok: false, reason: 'invalid_payload' });
  });

  it('rejects the wrong aggregateType for an event type', () => {
    const e = valid();
    e['aggregateType'] = 'comment';
    expect(parseDomainEvent(e)).toMatchObject({ ok: false, reason: 'invalid_payload' });
  });
});

describe('generic factory', () => {
  it('accepts deterministic id and clock for tests', () => {
    const e = createDomainEvent(
      'task.deleted',
      ctx,
      task,
      {
        projectId: task.projectId,
        actorId: actor,
        taskId: task.id,
        title: task.title,
        columnId: task.columnId,
      },
      {
        eventId: '99999999-9999-4999-8999-999999999999',
        now: new Date('2026-01-02T03:04:05.678Z'),
      },
    );
    expect(e).toMatchObject({
      eventId: '99999999-9999-4999-8999-999999999999',
      occurredAt: '2026-01-02T03:04:05.678Z',
    });
  });
});
