import { randomUUID } from 'node:crypto';
import { commentEvents, taskEvents, type DomainEvent } from '@dpp/contracts';

/**
 * One event of every type, built with the real contract factories (as the Project Service
 * builds them), for one task in one project, at increasing task versions.
 */
export function eventsForTask(
  projectId = randomUUID(),
  options: { correlationId?: string; actorId?: string; taskId?: string } = {},
): DomainEvent[] {
  const ctx = {
    producer: 'project-service',
    correlationId: options.correlationId ?? `corr-${randomUUID()}`,
  };
  const actorId = options.actorId ?? randomUUID();
  const taskId = options.taskId ?? randomUUID();
  const [todo, done] = [randomUUID(), randomUUID()];
  const assignee = randomUUID();
  const task = (version: number, columnId = todo, title = 'Write spec') => ({
    id: taskId,
    projectId,
    columnId,
    title,
    position: '1024',
    version,
  });
  return [
    taskEvents.created(ctx, actorId, task(1)),
    taskEvents.updated(
      ctx,
      actorId,
      { title: 'Write spec', description: '' },
      { ...task(2, todo, 'Write the spec'), description: 'secret draft text' },
    ),
    taskEvents.moved(ctx, actorId, todo, task(3, done, 'Write the spec')),
    taskEvents.assigned(ctx, actorId, task(4, done, 'Write the spec'), assignee),
    taskEvents.unassigned(ctx, actorId, task(5, done, 'Write the spec'), assignee),
    commentEvents.created(
      ctx,
      { id: randomUUID(), taskId, authorId: actorId, body: `looks good ${'x'.repeat(400)}` },
      { projectId, title: 'Write the spec' },
    ),
    taskEvents.deleted(ctx, actorId, task(6, done, 'Write the spec')),
  ];
}
