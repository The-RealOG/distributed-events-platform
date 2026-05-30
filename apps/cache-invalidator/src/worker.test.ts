import { DOMAIN_EVENT_TYPES } from '@dpp/contracts';
import { describe, expect, it } from 'vitest';
import { INVALIDATES_BOARD } from './worker.js';

describe('which events invalidate the board cache', () => {
  it('every task change does; comments do not (the board carries no comments)', () => {
    expect(Object.keys(INVALIDATES_BOARD).sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    for (const type of DOMAIN_EVENT_TYPES) {
      expect(INVALIDATES_BOARD[type], type).toBe(type.startsWith('task.'));
    }
  });
});
