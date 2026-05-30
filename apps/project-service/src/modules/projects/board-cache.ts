import { boardCacheEntry, type SharedCache } from '@dpp/cache';
import { boardDto, type BoardDto } from '@dpp/contracts';

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';

/**
 * The board read's view of the shared cache (ADR-015). The cached value is the project-level
 * board (no per-user data), validated with the public DTO schema on every hit. Only the
 * Project Service reads and fills it; only the cache-invalidator invalidates it.
 */
export class BoardCache {
  constructor(readonly shared: SharedCache) {}

  read(projectId: string) {
    return this.shared.read(boardCacheEntry(projectId), boardDto);
  }

  write(projectId: string, generation: string, board: BoardDto) {
    return this.shared.write(boardCacheEntry(projectId), generation, board);
  }
}
