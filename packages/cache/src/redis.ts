import { Redis } from 'ioredis';
import type { Logger } from 'pino';

export interface RedisOptions {
  /** redis://host:port locally; rediss://host:port (TLS) for ElastiCache in-transit encryption. */
  url: string;
  logger: Logger;
  /** Upper bound on any command; a slow or hung Redis must not slow requests down. */
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
}

/**
 * A client tuned for a cache that may be absent: commands fail immediately while disconnected
 * (no offline queue, no per-command retries) and are bounded by a timeout, so callers fall back
 * to PostgreSQL at once. Reconnection continues in the background with capped backoff.
 */
export function createRedisClient(options: RedisOptions): Redis {
  const log = options.logger.child({ component: 'redis' });
  const redis = new Redis(options.url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: options.commandTimeoutMs ?? 250,
    connectTimeout: options.connectTimeoutMs ?? 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    lazyConnect: false,
  });
  let down = false;
  redis.on('ready', () => {
    if (down) log.info('redis connection restored');
    down = false;
  });
  // Without a listener, connection errors would be unhandled 'error' events.
  redis.on('error', (err) => {
    if (!down) log.warn({ err: `${err.name}: ${err.message}` }, 'redis unavailable');
    down = true;
  });
  return redis;
}
