import type { Metrics } from '@dpp/observability';
import type { CacheStats } from './shared-cache.js';

/**
 * Exposes a SharedCache's counters as Prometheus counters, read at scrape time. Hit rate is a
 * query, not a metric: rate(cache_operations_total{result="hit"}[5m]) / rate(…{result=~"hit|miss"}[5m]).
 */
export function registerCacheMetrics(metrics: Metrics, stats: CacheStats, cache = 'board'): void {
  metrics.counter({
    name: 'cache_operations_total',
    help: 'Shared-cache operations by result (hit, miss, error = fell back to PostgreSQL, …)',
    labelNames: ['cache', 'result'],
    collect() {
      this.reset();
      const results: [string, number][] = [
        ['hit', stats.hits],
        ['miss', stats.misses],
        ['error', stats.errors],
        ['corrupt', stats.corrupt],
        ['write', stats.writes],
        ['stale_write_skipped', stats.staleWritesSkipped],
        ['refresh', stats.refreshes],
        ['invalidation', stats.invalidations],
      ];
      for (const [result, value] of results) if (value > 0) this.inc({ cache, result }, value);
    },
  });
}
