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
