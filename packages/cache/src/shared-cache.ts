import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { z } from 'zod';

/**
 * A thin cache-aside layer over a shared Redis/Valkey (ADR-015). PostgreSQL stays authoritative;
 * every method here may fail, and callers treat failure as "no cache", never as an error.
 *
 * Each cached value has a GENERATION counter next to it. Invalidation increments the counter
 * and deletes the value; a reader remembers the generation it saw on its miss and may only
 * write back if the generation is unchanged. That closes the classic cache-aside race:
 *
 *   reader: miss (gen 5) ─ reads PostgreSQL (old state) ──────────────── SET? gen is 6 → skipped
 *   writer:                    commit ─ event ─ invalidator: INCR gen 6, DEL
 *
 * Without it the reader would store the pre-change snapshot after the invalidation, and the
 * stale value would live until its TTL.
 */

export interface CacheStats {
  hits: number;
  misses: number;
  /** Reads/writes that failed (Redis down, timeout): served from PostgreSQL instead. */
  errors: number;
  /** Values that failed to parse/validate: treated as misses and deleted. */
  corrupt: number;
  writes: number;
  /** Write-backs refused because the entry was invalidated during the read. */
  staleWritesSkipped: number;
  invalidations: number;
  /** Reads that skipped the cache on request (read-your-writes) and refreshed it. */
  refreshes: number;
}

export type CacheRead<T> =
  { status: 'hit'; value: T } | { status: 'miss'; generation: string } | { status: 'error' };

// SET only if the generation is still the one the reader saw on its miss.
const WRITE_IF_GENERATION = `
local current = redis.call('GET', KEYS[2]) or '0'
if current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0`;

// Invalidate: bump the generation (so in-flight reads cannot write back) and drop the value.
const INVALIDATE = `
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[1])
return redis.call('DEL', KEYS[1])`;

/** Generation counters outlive any read by far; they expire so idle projects leave nothing. */
const GENERATION_TTL_SECONDS = 24 * 60 * 60;

export interface CacheEntry {
  key: string;
  generationKey: string;
}

export class SharedCache {
  readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    errors: 0,
    corrupt: 0,
    writes: 0,
    staleWritesSkipped: 0,
    invalidations: 0,
    refreshes: 0,
  };
  readonly #redis: Redis;
  readonly #log: Logger;
  readonly #ttlSeconds: number;

  constructor(redis: Redis, options: { logger: Logger; ttlSeconds: number }) {
    if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds <= 0) {
      throw new Error('cache TTL must be a positive number of seconds');
    }
    this.#redis = redis;
    this.#log = options.logger.child({ component: 'cache' });
    this.#ttlSeconds = options.ttlSeconds;
  }

  get ttlSeconds(): number {
    return this.#ttlSeconds;
  }

  async read<T>(entry: CacheEntry, schema: z.ZodType<T>): Promise<CacheRead<T>> {
    let raw: string | null | undefined;
    let generation: string | null | undefined;
    try {
      [raw, generation] = await this.#redis.mget(entry.key, entry.generationKey);
    } catch (err) {
      this.stats.errors++;
      this.#log.warn(
        { err: describe(err), key: entry.key },
        'cache read failed; using the database',
      );
      return { status: 'error' };
    }
    if (raw !== null && raw !== undefined) {
      const parsed = parse(raw, schema);
      if (parsed.ok) {
        this.stats.hits++;
        return { status: 'hit', value: parsed.value };
      }
      // Never serve or crash on a bad entry: drop it and read the database.
      this.stats.corrupt++;
      this.#log.warn({ key: entry.key, reason: parsed.reason }, 'corrupt cache entry discarded');
      await this.#redis.del(entry.key).catch(() => undefined);
    }
    this.stats.misses++;
    return { status: 'miss', generation: generation ?? '0' };
  }

  /**
   * For a read that must not use the cached value (the client asked for fresh data): the
   * current generation, to be passed to write() after reading PostgreSQL, or undefined if Redis
   * is unavailable. Never throws.
   */
  async generationForRefresh(entry: CacheEntry): Promise<string | undefined> {
    try {
      const generation = await this.#redis.get(entry.generationKey);
      this.stats.refreshes++;
      return generation ?? '0';
    } catch (err) {
      this.stats.errors++;
      this.#log.warn(
        { err: describe(err), key: entry.key },
        'cache read failed; using the database',
      );
      return undefined;
    }
  }

  /** Stores a value read after a miss, unless it was invalidated meanwhile. Never throws. */
  async write(entry: CacheEntry, generation: string, value: unknown): Promise<void> {
    try {
      const stored = await this.#redis.eval(
        WRITE_IF_GENERATION,
        2,
        entry.key,
        entry.generationKey,
        generation,
        JSON.stringify(value),
        this.#ttlSeconds,
      );
      if (stored === 1) this.stats.writes++;
      else this.stats.staleWritesSkipped++;
    } catch (err) {
      this.stats.errors++;
      this.#log.warn(
        { err: describe(err), key: entry.key },
        'cache write failed; value not cached',
      );
    }
  }

  /**
   * Makes the entry absent and blocks in-flight stale write-backs. Throws on failure: the
   * invalidator must not acknowledge an invalidation that did not happen.
   * Repeating it is harmless (the entry is absent either way), so duplicate events need no
   * deduplication (ADR-015).
   */
  async invalidate(entry: CacheEntry): Promise<void> {
    await this.#redis.eval(INVALIDATE, 2, entry.key, entry.generationKey, GENERATION_TTL_SECONDS);
    this.stats.invalidations++;
  }
}

function parse<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const result = schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, reason: 'invalid_shape' };
}

/** Error text for logs: message only (Redis errors carry no credentials or values). */
function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
