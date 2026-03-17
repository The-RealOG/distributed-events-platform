import { describe, expect, it } from 'vitest';
import { makeBoard } from '../../test/fakeBackend';
import { moveTargets } from './moves';

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
