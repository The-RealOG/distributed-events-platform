import { commentEvents, taskEvents, type EventContext } from '@dpp/contracts';
import type { RequestContext } from '../../http/authenticate.js';
import type { TaskRow } from './repository.js';

export const PRODUCER = 'project-service';

const eventContext = (ctx: RequestContext): EventContext => ({
  producer: PRODUCER,
  correlationId: ctx.correlationId,
});

// Events are always built from the row as written by the mutation (RETURNING), so
// aggregateVersion is the committed post-mutation version, never the caller's expectedVersion.
const snapshot = (row: TaskRow) => ({
  id: row.id,
  projectId: row.projectId,
  columnId: row.columnId,
  title: row.title,
  position: row.position,
  version: row.version,
});

export const buildTaskEvent = {
  created: (ctx: RequestContext, after: TaskRow) =>
    taskEvents.created(eventContext(ctx), ctx.principal.userId, snapshot(after)),
  updated: (ctx: RequestContext, before: TaskRow, after: TaskRow) =>
    taskEvents.updated(
      eventContext(ctx),
      ctx.principal.userId,
      { title: before.title, description: before.description },
      { ...snapshot(after), description: after.description },
    ),
  moved: (ctx: RequestContext, before: TaskRow, after: TaskRow) =>
    taskEvents.moved(eventContext(ctx), ctx.principal.userId, before.columnId, snapshot(after)),
  deleted: (ctx: RequestContext, after: TaskRow) =>
    taskEvents.deleted(eventContext(ctx), ctx.principal.userId, snapshot(after)),
  assigned: (ctx: RequestContext, after: TaskRow, assigneeId: string) =>
    taskEvents.assigned(eventContext(ctx), ctx.principal.userId, snapshot(after), assigneeId),
  unassigned: (ctx: RequestContext, after: TaskRow, assigneeId: string) =>
    taskEvents.unassigned(eventContext(ctx), ctx.principal.userId, snapshot(after), assigneeId),
};

export const buildCommentCreated = (
  ctx: RequestContext,
  comment: { id: string; taskId: string; authorId: string; body: string },
  task: TaskRow,
) =>
  commentEvents.created(eventContext(ctx), comment, {
    projectId: task.projectId,
    title: task.title,
  });
