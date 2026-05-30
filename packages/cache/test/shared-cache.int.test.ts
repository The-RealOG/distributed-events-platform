import { randomUUID } from 'node:crypto';
import { startRedis, waitFor, type StartedRedis } from '@dpp/test-utils';
import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { boardCacheEntry, createRedisClient, SharedCache } from '../src/index.js';

let server: StartedRedis;
let redis: Redis;
const logger = pino({ level: 'silent' });
const value = z.object({ n: z.number() });

beforeAll(async () => {
  server = await startRedis();
  redis = createRedisClient({ url: server.url, logger });
  await waitFor(() => redis.status === 'ready', { description: 'redis ready' });
});
afterAll(async () => {
  redis?.disconnect();
  await server?.stop();
});

const newCache = (ttlSeconds = 300) => new SharedCache(redis, { logger, ttlSeconds });
const entry = () => boardCacheEntry(randomUUID());

describe('cache-aside primitives (real Valkey)', () => {
  it('miss → write → hit, with a finite TTL on the value', async () => {
    const cache = newCache(120);
    const e = entry();
    const miss = await cache.read(e, value);
    expect(miss).toEqual({ status: 'miss', generation: '0' });
    await cache.write(e, '0', { n: 1 });
    expect(await cache.read(e, value)).toEqual({ status: 'hit', value: { n: 1 } });
    const ttl = await redis.ttl(e.key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, writes: 1 });
  });

  it('rejects a non-positive or non-integer TTL (no accidental "forever")', () => {
    for (const ttlSeconds of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => newCache(ttlSeconds)).toThrow('TTL');
    }
  });

  it('invalidation removes the value; repeating it is harmless', async () => {
    const cache = newCache();
    const e = entry();
    await cache.write(e, '0', { n: 1 });
    await cache.invalidate(e);
    await cache.invalidate(e);
    await cache.invalidate(e);
    expect(await redis.exists(e.key)).toBe(0);
    const again = await cache.read(e, value);
    expect(again.status).toBe('miss');
    // The next reader repopulates normally at the current generation.
    await cache.write(e, (again as { generation: string }).generation, { n: 2 });
    expect(await cache.read(e, value)).toEqual({ status: 'hit', value: { n: 2 } });
  });

  it('refuses a stale write-back: a read that started before an invalidation cannot store its snapshot', async () => {
    const cache = newCache();
    const e = entry();
    const miss = await cache.read(e, value); // reader starts (generation 0) and goes to the DB…
    await cache.invalidate(e); // …meanwhile a change commits and is invalidated…
    await cache.write(e, (miss as { generation: string }).generation, { n: 'old' as never }); // …reader returns late
    expect(await redis.exists(e.key)).toBe(0);
    expect(cache.stats.staleWritesSkipped).toBe(1);
  });

  it('treats a corrupt entry as a miss and deletes it', async () => {
    const cache = newCache();
    for (const bad of ['{not json', JSON.stringify({ n: 'text' })]) {
      const e = entry();
      await redis.set(e.key, bad);
      expect((await cache.read(e, value)).status).toBe('miss');
      expect(await redis.exists(e.key)).toBe(0);
    }
    expect(cache.stats.corrupt).toBe(2);
  });

  it('isolates keys: invalidating one project leaves another cached', async () => {
    const cache = newCache();
    const [a, b] = [entry(), entry()];
    await cache.write(a, '0', { n: 1 });
    await cache.write(b, '0', { n: 2 });
    await cache.invalidate(a);
    expect((await cache.read(a, value)).status).toBe('miss');
    expect(await cache.read(b, value)).toEqual({ status: 'hit', value: { n: 2 } });
  });

  it('fails fast while Redis is unreachable (reads report an error, writes are dropped, invalidations throw) and recovers by itself', async () => {
    const cache = newCache();
    const e = entry();
    await server.pause();
    try {
      const started = performance.now();
      expect(await cache.read(e, value)).toEqual({ status: 'error' });
      await cache.write(e, '0', { n: 1 }); // must not throw
      await expect(cache.invalidate(e)).rejects.toThrow();
      // Bounded by the command timeout, not by a TCP timeout.
      expect(performance.now() - started).toBeLessThan(3_000);
    } finally {
      await server.unpause();
    }
    await waitFor(async () => (await cache.read(e, value)).status === 'miss', {
      timeoutMs: 20_000,
      description: 'cache usable again',
    });
    expect(cache.stats.errors).toBeGreaterThanOrEqual(2);
  });
});
