import type { CacheEntry } from './shared-cache.js';

/**
 * Every cache key is built here (ADR-015), so the reader (Project Service) and the invalidator
 * can never disagree about a key. Bump BOARD_FORMAT when the cached board's shape changes:
 * old entries are then simply never read again and expire by TTL.
 */
export const BOARD_FORMAT = 1;

export function boardCacheEntry(projectId: string): CacheEntry {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('board cache key needs a project UUID');
  return {
    key: `board:v${BOARD_FORMAT}:${projectId}`,
    generationKey: `board:gen:${projectId}`,
  };
}
