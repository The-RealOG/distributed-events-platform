import {
  boardColumns,
  boards,
  comments,
  taskAssignees,
  tasks,
  users,
  type DbExecutor,
} from '@dpp/database';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

export type TaskRow = typeof tasks.$inferSelect;

/** Gap left between neighbours so most moves only rewrite the moved row. */
const POSITION_STEP = 1024;

const active = (id: string) => and(eq(tasks.id, id), isNull(tasks.deletedAt));

export async function findColumnInProject(ex: DbExecutor, columnId: string, projectId: string) {
  const [row] = await ex
    .select({ id: boardColumns.id, name: boardColumns.name })
    .from(boardColumns)
    .innerJoin(boards, eq(boards.id, boardColumns.boardId))
    .where(and(eq(boardColumns.id, columnId), eq(boards.projectId, projectId)));
  return row;
}

export async function insertTask(
  ex: DbExecutor,
  values: {
    projectId: string;
    columnId: string;
    title: string;
    description: string;
    createdBy: string;
  },
): Promise<TaskRow> {
  const [row] = await ex
    .insert(tasks)
    .values({
      ...values,
      // Append to the end of the column.
      position: sql`coalesce((select max(${tasks.position}) from ${tasks}
        where ${tasks.columnId} = ${values.columnId} and ${tasks.deletedAt} is null), 0) + ${POSITION_STEP}`,
    })
    .returning();
  return row!;
}

export async function findActiveTask(ex: DbExecutor, id: string): Promise<TaskRow | undefined> {
  const [row] = await ex.select().from(tasks).where(active(id));
  return row;
}

/**
 * Optimistic concurrency: the write only applies if nobody has bumped the version since the
 * caller read it. Under READ COMMITTED, a concurrent writer blocks on the row lock and then
 * re-evaluates `version = expected` against the committed row, so exactly one of two racing
 * updates with the same expected version can succeed. Returns undefined when it did not apply.
 */
export async function updateTaskIfVersion(
  ex: DbExecutor,
  id: string,
  expectedVersion: number,
  changes: Partial<Pick<TaskRow, 'title' | 'description' | 'columnId' | 'position' | 'deletedAt'>>,
): Promise<TaskRow | undefined> {
  const [row] = await ex
    .update(tasks)
    .set({ ...changes, version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
    .where(and(active(id), eq(tasks.version, expectedVersion)))
    .returning();
  return row;
}

/** Unconditional version bump for changes that commute (assignment), keeping versions monotonic. */
export async function bumpTaskVersion(ex: DbExecutor, id: string): Promise<TaskRow | undefined> {
  const [row] = await ex
    .update(tasks)
    .set({ version: sql`${tasks.version} + 1`, updatedAt: sql`now()` })
    .where(active(id))
    .returning();
  return row;
}

/**
 * Computes a position directly after `afterPosition` (or at the top when null) in a column,
 * ignoring the task being moved. Midpoints use `* 0.5`, which is exact for NUMERIC, whereas
 * `/ 2` rounds to a limited scale and could eventually collide with a neighbour.
 */
export async function positionAfter(
  ex: DbExecutor,
  columnId: string,
  afterPosition: string | null,
  movingTaskId: string,
): Promise<string> {
  const others = sql`${tasks.columnId} = ${columnId} and ${tasks.deletedAt} is null and ${tasks.id} <> ${movingTaskId}`;
  const query =
    afterPosition === null
      ? sql`select coalesce((select min(${tasks.position}) from ${tasks} where ${others}) - ${POSITION_STEP}, ${POSITION_STEP})::text as position`
      : sql`select coalesce(
          (${afterPosition}::numeric + (select min(${tasks.position}) from ${tasks} where ${others} and ${tasks.position} > ${afterPosition}::numeric)) * 0.5,
          ${afterPosition}::numeric + ${POSITION_STEP}
        )::text as position`;
  const result = await ex.execute<{ position: string }>(query);
  return result.rows[0]!.position;
}

export async function listActiveTasksForProject(ex: DbExecutor, projectId: string) {
  return (
    ex
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      // id breaks ties if two concurrent moves computed the same position.
      .orderBy(asc(tasks.position), asc(tasks.id))
  );
}

export async function listAssigneeIds(
  ex: DbExecutor,
  taskIds: string[],
): Promise<Map<string, string[]>> {
  const byTask = new Map<string, string[]>();
  if (taskIds.length === 0) return byTask;
  const rows = await ex
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(asc(taskAssignees.createdAt));
  for (const row of rows) {
    byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), row.userId]);
  }
  return byTask;
}

/** Returns true if a row was inserted (false if already assigned). */
export async function insertAssignee(
  ex: DbExecutor,
  values: { taskId: string; userId: string; assignedBy: string },
): Promise<boolean> {
  const rows = await ex.insert(taskAssignees).values(values).onConflictDoNothing().returning();
  return rows.length > 0;
}

/** Returns true if a row was deleted (false if not assigned). */
export async function deleteAssignee(ex: DbExecutor, taskId: string, userId: string) {
  const rows = await ex
    .delete(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .returning();
  return rows.length > 0;
}

export async function insertComment(
  ex: DbExecutor,
  values: { taskId: string; authorId: string; body: string },
) {
  const [row] = await ex.insert(comments).values(values).returning();
  return row!;
}

export async function listComments(ex: DbExecutor, taskId: string) {
  return ex
    .select({ comment: comments, authorDisplayName: users.displayName })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}
