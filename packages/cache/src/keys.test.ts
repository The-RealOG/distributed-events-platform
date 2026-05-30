import { describe, expect, it } from 'vitest';
import { BOARD_FORMAT, boardCacheEntry } from './keys.js';

describe('board cache keys', () => {
  const projectId = '0b8f2c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

  it('are versioned and scoped to one project', () => {
    expect(boardCacheEntry(projectId)).toEqual({
      key: `board:v${BOARD_FORMAT}:${projectId}`,
      generationKey: `board:gen:${projectId}`,
    });
    expect(boardCacheEntry(projectId).key).not.toEqual(
      boardCacheEntry('1b8f2c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e').key,
    );
  });

  it('refuse anything but a project id (no key injection, no wildcard)', () => {
    for (const bad of ['', '*', 'board:*', `${projectId}:x`]) {
      expect(() => boardCacheEntry(bad)).toThrow();
    }
  });
});
