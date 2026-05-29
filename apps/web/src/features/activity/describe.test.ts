import type { ActivityEntryDto } from '@dpp/contracts';
import { describe, expect, it } from 'vitest';
import { describeActivity } from './describe';

const ada = 'a0000000-0000-4000-8000-000000000001';
const bob = 'b0000000-0000-4000-8000-000000000002';
const [todo, done] = [
  'c0000000-0000-4000-8000-000000000003',
  'd0000000-0000-4000-8000-000000000004',
];
const ctx = {
  people: { [ada]: 'Ada', [bob]: 'Bob' },
  columns: { [todo]: 'To do', [done]: 'Done' },
};
const entry = (eventType: string, data: Record<string, unknown>): ActivityEntryDto => ({
  id: '1',
  eventId: 'e0000000-0000-4000-8000-000000000005',
  eventType,
  taskId: 'f0000000-0000-4000-8000-000000000006',
  actorId: ada,
  data,
  occurredAt: '2026-09-26T10:00:00.000Z',
  correlationId: 'c',
});

describe('describeActivity', () => {
  it('words every event type from structured data and current names', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['task.created', { title: 'Spec', columnId: todo }, 'Ada created “Spec” in “To do”'],
      [
        'task.updated',
        { title: { previous: 'Spec', current: 'Spec v2' }, descriptionChanged: false },
        'Ada renamed “Spec” to “Spec v2”',
      ],
      ['task.updated', { descriptionChanged: true }, 'Ada edited the description of “a task”'],
      [
        'task.moved',
        { title: 'Spec', fromColumnId: todo, toColumnId: done },
        'Ada moved “Spec” from “To do” to “Done”',
      ],
      [
        'task.moved',
        { title: 'Spec', fromColumnId: done, toColumnId: done },
        'Ada reordered “Spec” in “Done”',
      ],
      ['task.deleted', { title: 'Spec', columnId: done }, 'Ada deleted “Spec”'],
      ['task.assigned', { title: 'Spec', assigneeId: bob }, 'Ada assigned Bob to “Spec”'],
      ['task.unassigned', { title: 'Spec', assigneeId: bob }, 'Ada unassigned Bob from “Spec”'],
      [
        'comment.created',
        { taskTitle: 'Spec', excerpt: 'LGTM' },
        'Ada commented on “Spec”: “LGTM”',
      ],
    ];
    for (const [type, data, text] of cases)
      expect(describeActivity(entry(type, data), ctx)).toBe(text);
  });

  it('degrades gracefully: unknown people, deleted columns, future event types', () => {
    expect(
      describeActivity(
        { ...entry('task.created', { title: 'X', columnId: 'gone' }), actorId: bob },
        { people: {}, columns: {} },
      ),
    ).toBe('Someone created “X” in another column');
    expect(describeActivity(entry('task.archived', {}), ctx)).toBe('Ada: task.archived');
  });
});
