import type { DomainEvent } from '@dpp/contracts';
import { activityEvents, type DbTransaction } from '@dpp/database';

/**
 * The activity record kept for each domain event (ADR-014). Structured facts, not sentences:
 * the API/UI decide the wording, and can change it without rewriting history.
 *
 * Retained per event type (all from the event contract; nothing is fetched back from the
 * Project Service, and nothing beyond what the contract intentionally exposes):
 *
 *   task.created     taskId, title, columnId
 *   task.updated     taskId, title {previous, current} when renamed, descriptionChanged
 *                    (never the description text)
 *   task.moved       taskId, title, fromColumnId, toColumnId
 *   task.deleted     taskId, title, columnId
 *   task.assigned    taskId, title, assigneeId
 *   task.unassigned  taskId, title, assigneeId
 *   comment.created  commentId, taskId, taskTitle, excerpt (≤ 280 chars, the contract's bounded
 *                    excerpt), bodyLength (never the full body)
 */
export function activityData(event: DomainEvent): Record<string, unknown> {
  const p = event.payload;
  switch (event.eventType) {
    case 'task.created':
      return { taskId: p.taskId, title: event.payload.title, columnId: event.payload.columnId };
    case 'task.updated':
      return {
        taskId: p.taskId,
        ...(event.payload.title ? { title: event.payload.title } : {}),
        descriptionChanged: event.payload.descriptionChanged,
      };
    case 'task.moved':
      return {
        taskId: p.taskId,
        title: event.payload.title,
        fromColumnId: event.payload.fromColumnId,
        toColumnId: event.payload.toColumnId,
      };
    case 'task.deleted':
      return { taskId: p.taskId, title: event.payload.title, columnId: event.payload.columnId };
    case 'task.assigned':
    case 'task.unassigned':
      return { taskId: p.taskId, title: event.payload.title, assigneeId: event.payload.assigneeId };
    case 'comment.created':
      return {
        commentId: event.payload.commentId,
        taskId: p.taskId,
        taskTitle: event.payload.taskTitle,
        excerpt: event.payload.excerpt,
        bodyLength: event.payload.bodyLength,
      };
  }
}

export function toActivityRow(event: DomainEvent): typeof activityEvents.$inferInsert {
  return {
    eventId: event.eventId,
    projectId: event.payload.projectId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    taskId: event.payload.taskId,
    actorId: event.payload.actorId,
    data: activityData(event),
    correlationId: event.correlationId,
    occurredAt: new Date(event.occurredAt),
  };
}

/** The Activity Service's side effect, run inside processEventOnce's transaction. */
export async function recordActivity(tx: DbTransaction, event: DomainEvent): Promise<void> {
  await tx.insert(activityEvents).values(toActivityRow(event));
}
