import type { BoardDto, TaskDto } from '@dpp/contracts';

export interface MoveRequest {
  columnId: string;
  /** Place after this task in the target column; null places it at the top. */
  afterTaskId: string | null;
}

/**
 * Translates a user's intent into the server's move request, using the board as last
 * fetched. The server computes the actual position and rejects anchors that have since
 * moved, so a stale board produces an error and a refetch, never a silent misplacement.
 */
export function moveTargets(board: BoardDto, taskId: string) {
  const column = board.columns.find((c) => c.tasks.some((t) => t.id === taskId));
  if (!column) return { up: null, down: null, toColumn: () => null };
  const tasks = column.tasks;
  const index = tasks.findIndex((t) => t.id === taskId);

  const up: MoveRequest | null =
    index === 0
      ? null
      : { columnId: column.id, afterTaskId: index >= 2 ? tasks[index - 2]!.id : null };
  const down: MoveRequest | null =
    index === tasks.length - 1 ? null : { columnId: column.id, afterTaskId: tasks[index + 1]!.id };

  const toColumn = (columnId: string): MoveRequest | null => {
    if (columnId === column.id) return null;
    const target = board.columns.find((c) => c.id === columnId);
    if (!target) return null;
    const last: TaskDto | undefined = target.tasks[target.tasks.length - 1];
    return { columnId, afterTaskId: last ? last.id : null };
  };

  return { up, down, toColumn };
}

/**
 * Drag and drop: the move request for dropping `taskId` into `columnId` just before
 * `beforeTaskId` (null = at the end). Returns null when the drop would not change anything.
 */
export function dropTarget(
  board: BoardDto,
  taskId: string,
  columnId: string,
  beforeTaskId: string | null,
): MoveRequest | null {
  const source = board.columns.find((c) => c.tasks.some((t) => t.id === taskId));
  const target = board.columns.find((c) => c.id === columnId);
  if (!source || !target || beforeTaskId === taskId) return null;
  const others = target.tasks.filter((t) => t.id !== taskId);
  const slot =
    beforeTaskId === null ? others.length : others.findIndex((t) => t.id === beforeTaskId);
  if (slot < 0) return null;
  const afterTaskId = slot === 0 ? null : others[slot - 1]!.id;
  if (source.id === columnId) {
    const index = source.tasks.findIndex((t) => t.id === taskId);
    const currentAfter = index === 0 ? null : source.tasks[index - 1]!.id;
    if (currentAfter === afterTaskId) return null;
  }
  return { columnId, afterTaskId };
}

/** The board as it will look once `move` lands, for showing a drag result immediately. */
export function applyMove(board: BoardDto, taskId: string, move: MoveRequest): BoardDto {
  const task = board.columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
  if (!task) return board;
  return {
    ...board,
    columns: board.columns.map((column) => {
      const tasks = column.tasks.filter((t) => t.id !== taskId);
      if (column.id !== move.columnId) return { ...column, tasks };
      const at =
        move.afterTaskId === null ? 0 : tasks.findIndex((t) => t.id === move.afterTaskId) + 1;
      tasks.splice(at, 0, { ...task, columnId: column.id });
      return { ...column, tasks };
    }),
  };
}
