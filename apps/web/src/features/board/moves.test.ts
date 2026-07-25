import { describe, expect, it } from 'vitest';
import { makeBoard } from '../../test/fakeBackend';
import { applyMove, dropTarget, moveTargets } from './moves';

describe('moveTargets', () => {
  const board = makeBoard([['A', 'B', 'C'], ['X', 'Y'], []]);
  const [todo, doing, done] = board.columns;
  const [a, b, c] = todo!.tasks;
  const [, y] = doing!.tasks;

  it('moves up by anchoring after the task two places above (or to the top)', () => {
    expect(moveTargets(board, a!.id).up).toBeNull();
    expect(moveTargets(board, b!.id).up).toEqual({ columnId: todo!.id, afterTaskId: null });
    expect(moveTargets(board, c!.id).up).toEqual({ columnId: todo!.id, afterTaskId: a!.id });
  });

  it('moves down by anchoring after the next task', () => {
    expect(moveTargets(board, a!.id).down).toEqual({ columnId: todo!.id, afterTaskId: b!.id });
    expect(moveTargets(board, c!.id).down).toBeNull();
  });

  it('appends to another column, or places at the top of an empty one', () => {
    expect(moveTargets(board, a!.id).toColumn(doing!.id)).toEqual({
      columnId: doing!.id,
      afterTaskId: y!.id,
    });
    expect(moveTargets(board, a!.id).toColumn(done!.id)).toEqual({
      columnId: done!.id,
      afterTaskId: null,
    });
    expect(moveTargets(board, a!.id).toColumn(todo!.id)).toBeNull();
  });
});

describe('dropTarget (drag and drop)', () => {
  const board = makeBoard([['A', 'B', 'C'], ['X', 'Y'], []]);
  const [todo, doing, done] = board.columns;
  const [a, b, c] = todo!.tasks;
  const [x, y] = doing!.tasks;

  it('drops into another column before a card, at its end, or into an empty column', () => {
    expect(dropTarget(board, a!.id, doing!.id, x!.id)).toEqual({
      columnId: doing!.id,
      afterTaskId: null,
    });
    expect(dropTarget(board, a!.id, doing!.id, y!.id)).toEqual({
      columnId: doing!.id,
      afterTaskId: x!.id,
    });
    expect(dropTarget(board, a!.id, doing!.id, null)).toEqual({
      columnId: doing!.id,
      afterTaskId: y!.id,
    });
    expect(dropTarget(board, a!.id, done!.id, null)).toEqual({
      columnId: done!.id,
      afterTaskId: null,
    });
  });

  it('reorders within a column, ignoring the dragged card itself as an anchor', () => {
    expect(dropTarget(board, c!.id, todo!.id, a!.id)).toEqual({
      columnId: todo!.id,
      afterTaskId: null,
    });
    expect(dropTarget(board, a!.id, todo!.id, null)).toEqual({
      columnId: todo!.id,
      afterTaskId: c!.id,
    });
    expect(dropTarget(board, a!.id, todo!.id, c!.id)).toEqual({
      columnId: todo!.id,
      afterTaskId: b!.id,
    });
  });

  it('returns null for drops that change nothing', () => {
    expect(dropTarget(board, a!.id, todo!.id, a!.id)).toBeNull();
    expect(dropTarget(board, a!.id, todo!.id, b!.id)).toBeNull(); // already right before B
    expect(dropTarget(board, c!.id, todo!.id, null)).toBeNull(); // already last
  });

  it('applyMove shows the result the server will produce', () => {
    const moved = applyMove(board, a!.id, { columnId: doing!.id, afterTaskId: x!.id });
    expect(moved.columns.map((col) => col.tasks.map((t) => t.title))).toEqual([
      ['B', 'C'],
      ['X', 'A', 'Y'],
      [],
    ]);
    expect(moved.columns[1]!.tasks[1]!.columnId).toBe(doing!.id);
  });
});
