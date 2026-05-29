import { DOMAIN_EVENT_TYPES } from '@dpp/contracts';
import { describe, expect, it } from 'vitest';
import { eventsForTask } from '../test/events.js';
import { toActivityRow } from './projection.js';

describe('activity projection', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const events = eventsForTask(projectId, { correlationId: 'corr-1' });
  const rows = Object.fromEntries(events.map((e) => [e.eventType, toActivityRow(e)]));

  it('covers every domain event type', () => {
    expect(Object.keys(rows).sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it('copies identity, project, version, actor and correlation from the event', () => {
    for (const event of events) {
      expect(toActivityRow(event)).toMatchObject({
        eventId: event.eventId,
        projectId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        taskId: event.payload.taskId,
        actorId: event.payload.actorId,
        correlationId: 'corr-1',
        occurredAt: new Date(event.occurredAt),
      });
    }
  });

  it('keeps structured facts per type, not sentences', () => {
    const taskId = events[0]!.payload.taskId;
    expect(rows['task.created']!.data).toEqual({
      taskId,
      title: 'Write spec',
      columnId: expect.any(String),
    });
    expect(rows['task.updated']!.data).toEqual({
      taskId,
      title: { previous: 'Write spec', current: 'Write the spec' },
      descriptionChanged: true,
    });
    expect(rows['task.moved']!.data).toEqual({
      taskId,
      title: 'Write the spec',
      fromColumnId: expect.any(String),
      toColumnId: expect.any(String),
    });
    expect(rows['task.assigned']!.data).toMatchObject({ taskId, assigneeId: expect.any(String) });
    expect(rows['task.unassigned']!.data).toMatchObject({ taskId, assigneeId: expect.any(String) });
    expect(rows['task.deleted']!.data).toEqual({
      taskId,
      title: 'Write the spec',
      columnId: expect.any(String),
    });
    expect(rows['comment.created']!.data).toEqual({
      commentId: events[5]!.aggregateId,
      taskId,
      taskTitle: 'Write the spec',
      excerpt: expect.any(String),
      bodyLength: 411,
    });
  });

  it('never stores task descriptions or full comment bodies', () => {
    const all = JSON.stringify(Object.values(rows).map((r) => r.data));
    expect(all).not.toContain('secret draft text');
    expect((rows['comment.created']!.data['excerpt'] as string).length).toBeLessThanOrEqual(280);
  });
});
