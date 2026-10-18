import type { Principal } from '@dpp/auth';
import { insertOutboxEvent, type Database, type DbExecutor } from '@dpp/database';
import { requireProjectRole, requireTaskRole } from '../../domain/access.js';
import { REQUIRED_ROLE } from '../../domain/roles.js';
import type { RequestContext } from '../../http/authenticate.js';
import { badRequest, notFound, versionConflict } from '../../http/errors.js';
import { createOnce } from '../../http/idempotency.js';
import { iso } from '../../http/schemas.js';
import { findUserById } from '../identity/repository.js';
import { findMemberRole } from '../workspaces/repository.js';
import {
  bumpTaskVersion,
  deleteAssignee,
  findActiveTask,
  findColumnInProject,
  insertAssignee,
  insertComment,
  insertTask,
  listAssigneeIds,
  listComments,
  positionAfter,
  updateTaskIfVersion,
  type TaskRow,
} from './repository.js';
import { buildCommentCreated, buildTaskEvent } from './events.js';
import type { CommentDto, TaskDto } from './schemas.js';

export const toTaskDto = (row: TaskRow, assigneeIds: string[]): TaskDto => ({
  id: row.id,
  projectId: row.projectId,
  columnId: row.columnId,
  title: row.title,
  description: row.description,
  position: row.position,
  version: row.version,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  assigneeIds,
});

type VersionedChanges = Parameters<typeof updateTaskIfVersion>[3];

async function withAssignees(ex: DbExecutor, row: TaskRow): Promise<TaskDto> {
  const assignees = await listAssigneeIds(ex, [row.id]);
  return toTaskDto(row, assignees.get(row.id) ?? []);
}

/**
 * Applies a change only if the caller's expected version is current. Rejects early when the
 * version read during authorization is already stale, and relies on the conditional UPDATE to
 * catch a writer that commits in between.
 */
async function applyVersioned(
  ex: DbExecutor,
  current: TaskRow,
  expectedVersion: number,
  changes: VersionedChanges,
): Promise<TaskRow> {
  if (current.version !== expectedVersion) throw versionConflict(current.version);
  const updated = await updateTaskIfVersion(ex, current.id, expectedVersion, changes);
  if (updated) return updated;

  const latest = await findActiveTask(ex, current.id);
  if (!latest) throw notFound('Task');
  throw versionConflict(latest.version);
}

/**
 * Every mutation below is one PostgreSQL transaction containing both the domain change and its
 * outbox event (ADR-011). If either write fails, both roll back. Nothing here talks to Kafka:
 * the request succeeds when the transaction commits, and the Outbox Publisher delivers the
 * event later.
 */
export class TaskService {
  constructor(private readonly db: Database) {}

  async create(
    ctx: RequestContext,
    input: { projectId: string; columnId: string; title: string; description: string },
  ): Promise<TaskDto> {
    return this.db.transaction(async (tx) => {
      await requireProjectRole(tx, ctx.principal.userId, input.projectId, REQUIRED_ROLE.editTasks);
      return createOnce(tx, ctx.principal.userId, ctx.idempotency, async () => {
        if (!(await findColumnInProject(tx, input.columnId, input.projectId))) {
          throw badRequest('Column does not belong to this project', { field: 'columnId' });
        }
        const task = await insertTask(tx, { ...input, createdBy: ctx.principal.userId });
        await insertOutboxEvent(tx, buildTaskEvent.created(ctx, task));
        return toTaskDto(task, []);
      });
    });
  }

  async get(principal: Principal, taskId: string): Promise<TaskDto> {
    const { task } = await requireTaskRole(
      this.db,
      principal.userId,
      taskId,
      REQUIRED_ROLE.readProject,
    );
    return withAssignees(this.db, task);
  }

  async update(
    ctx: RequestContext,
    taskId: string,
    input: {
      expectedVersion: number;
      title?: string | undefined;
      description?: string | undefined;
    },
  ): Promise<TaskDto> {
    return this.db.transaction(async (tx) => {
      const { task } = await requireTaskRole(
        tx,
        ctx.principal.userId,
        taskId,
        REQUIRED_ROLE.editTasks,
      );
      const changes: VersionedChanges = {};
      if (input.title !== undefined && input.title !== task.title) changes.title = input.title;
      if (input.description !== undefined && input.description !== task.description) {
        changes.description = input.description;
      }
      // A save that changes nothing writes nothing: no version bump and no event, so every
      // task version corresponds to exactly one event. It is still rejected if stale.
      if (Object.keys(changes).length === 0) {
        if (task.version !== input.expectedVersion) throw versionConflict(task.version);
        return withAssignees(tx, task);
      }
      const updated = await applyVersioned(tx, task, input.expectedVersion, changes);
      await insertOutboxEvent(tx, buildTaskEvent.updated(ctx, task, updated));
      return withAssignees(tx, updated);
    });
  }

  async move(
    ctx: RequestContext,
    taskId: string,
    input: { expectedVersion: number; columnId: string; afterTaskId: string | null },
  ): Promise<TaskDto> {
    return this.db.transaction(async (tx) => {
      const { task } = await requireTaskRole(
        tx,
        ctx.principal.userId,
        taskId,
        REQUIRED_ROLE.editTasks,
      );
      if (task.version !== input.expectedVersion) throw versionConflict(task.version);

      if (!(await findColumnInProject(tx, input.columnId, task.projectId))) {
        throw badRequest('Column does not belong to this task’s project', { field: 'columnId' });
      }

      let afterPosition: string | null = null;
      if (input.afterTaskId !== null) {
        const anchor =
          input.afterTaskId === taskId ? undefined : await findActiveTask(tx, input.afterTaskId);
        if (!anchor || anchor.columnId !== input.columnId) {
          throw badRequest('afterTaskId must reference another task in the target column', {
            field: 'afterTaskId',
          });
        }
        afterPosition = anchor.position;
      }

      const position = await positionAfter(tx, input.columnId, afterPosition, taskId);
      const moved = await applyVersioned(tx, task, input.expectedVersion, {
        columnId: input.columnId,
        position,
      });
      await insertOutboxEvent(tx, buildTaskEvent.moved(ctx, task, moved));
      return withAssignees(tx, moved);
    });
  }

  async delete(ctx: RequestContext, taskId: string, expectedVersion: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { task } = await requireTaskRole(
        tx,
        ctx.principal.userId,
        taskId,
        REQUIRED_ROLE.editTasks,
      );
      const deleted = await applyVersioned(tx, task, expectedVersion, { deletedAt: new Date() });
      await insertOutboxEvent(tx, buildTaskEvent.deleted(ctx, deleted));
    });
  }

  /** Idempotent: assigning an existing assignee succeeds without changing the task version. */
  async assign(ctx: RequestContext, taskId: string, userId: string): Promise<TaskDto> {
    return this.db.transaction(async (tx) => {
      const { task, workspaceId } = await requireTaskRole(
        tx,
        ctx.principal.userId,
        taskId,
        REQUIRED_ROLE.editTasks,
      );
      if (!(await findMemberRole(tx, workspaceId, userId))) {
        throw badRequest('Assignee must be a member of the workspace', { field: 'userId' });
      }
      const inserted = await insertAssignee(tx, {
        taskId,
        userId,
        assignedBy: ctx.principal.userId,
      });
      if (!inserted) return withAssignees(tx, task); // already assigned: no change, no event
      const bumped = await bumpTaskVersion(tx, taskId);
      if (!bumped) throw notFound('Task');
      await insertOutboxEvent(tx, buildTaskEvent.assigned(ctx, bumped, userId));
      return withAssignees(tx, bumped);
    });
  }

  /** Idempotent: removing a non-assignee succeeds without changing the task version. */
  async unassign(ctx: RequestContext, taskId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await requireTaskRole(tx, ctx.principal.userId, taskId, REQUIRED_ROLE.editTasks);
      if (!(await deleteAssignee(tx, taskId, userId))) return; // not assigned: no change, no event
      const bumped = await bumpTaskVersion(tx, taskId);
      if (!bumped) throw notFound('Task');
      await insertOutboxEvent(tx, buildTaskEvent.unassigned(ctx, bumped, userId));
    });
  }

  async addComment(ctx: RequestContext, taskId: string, body: string): Promise<CommentDto> {
    return this.db.transaction(async (tx) => {
      const { task } = await requireTaskRole(
        tx,
        ctx.principal.userId,
        taskId,
        REQUIRED_ROLE.comment,
      );
      return createOnce(tx, ctx.principal.userId, ctx.idempotency, async () => {
        const author = await findUserById(tx, ctx.principal.userId);
        if (!author) throw notFound('User');
        const comment = await insertComment(tx, { taskId, authorId: author.id, body });
        await insertOutboxEvent(tx, buildCommentCreated(ctx, comment, task));
        return {
          id: comment.id,
          taskId: comment.taskId,
          authorId: comment.authorId,
          authorDisplayName: author.displayName,
          body: comment.body,
          createdAt: iso(comment.createdAt),
        };
      });
    });
  }

  async listComments(principal: Principal, taskId: string): Promise<CommentDto[]> {
    await requireTaskRole(this.db, principal.userId, taskId, REQUIRED_ROLE.readProject);
    const rows = await listComments(this.db, taskId);
    return rows.map(({ comment, authorDisplayName }) => ({
      id: comment.id,
      taskId: comment.taskId,
      authorId: comment.authorId,
      authorDisplayName,
      body: comment.body,
      createdAt: iso(comment.createdAt),
    }));
  }
}
