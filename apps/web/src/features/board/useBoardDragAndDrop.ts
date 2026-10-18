import type { BoardDto } from '@dpp/contracts';
import { useState, type DragEvent } from 'react';
import { applyMove, dropTarget, type MoveRequest } from './moves';
import type { useTaskMutations } from './useTaskMutations';

/** Drag data type for a task card; lets drop targets recognise our drags synchronously. */
export const TASK_DRAG_TYPE = 'application/x-dpp-task';

/** Drag and drop state: the card being dragged and where it would land. */
export interface DragState {
  taskId: string;
  over?: { columnId: string; beforeTaskId: string | null } | undefined;
}

export interface DnD {
  drag: DragState | null;
  start: (taskId: string) => void;
  over: (columnId: string, beforeTaskId: string | null) => void;
  drop: (taskId: string, columnId: string, beforeTaskId: string | null) => void;
  end: () => void;
}

/** The card the pointer is above the middle of, i.e. the card a drop would land before. */
export function cardBelowPointer(event: DragEvent<HTMLElement>): string | null {
  const cards = event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]');
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) return card.dataset['taskId'] ?? null;
  }
  return null;
}

/**
 * Drag-and-drop moves for a board. Returns the handlers and the board to display: a dropped
 * card is shown in its new place until a board fetched after the drop arrives (or the move
 * fails, which refreshes the board and reports why). Local display state only: the board itself
 * is always the server's.
 */
export function useBoardDragAndDrop(
  board: BoardDto | undefined,
  boardUpdatedAt: number,
  move: ReturnType<typeof useTaskMutations>['move'],
): { dnd: DnD; shown: BoardDto | undefined } {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<{ taskId: string; to: MoveRequest; since: number } | null>(
    null,
  );

  const optimistic = pending && !move.isError && boardUpdatedAt <= pending.since ? pending : null;
  const shown = board && optimistic ? applyMove(board, optimistic.taskId, optimistic.to) : board;

  const dnd: DnD = {
    drag,
    start: (taskId) => setDrag({ taskId }),
    over: (columnId, beforeTaskId) =>
      setDrag((d) =>
        d && (d.over?.columnId !== columnId || d.over.beforeTaskId !== beforeTaskId)
          ? { ...d, over: { columnId, beforeTaskId } }
          : d,
      ),
    drop: (taskId, columnId, beforeTaskId) => {
      setDrag(null);
      if (!board || !taskId || move.isPending) return;
      const task = board.columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
      const to = dropTarget(board, taskId, columnId, beforeTaskId);
      if (!task || !to) return;
      setPending({ taskId, to, since: boardUpdatedAt });
      move.mutate({ task, to }, { onError: () => setPending(null) });
    },
    end: () => setDrag(null),
  };
  return { dnd, shown };
}
