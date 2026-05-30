import { createRedisClient, SharedCache } from '@dpp/cache';
import { createKafkaClient, kafkaConnectionFromEnv } from '@dpp/kafka';
import { createLoggerOptions } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { pino } from 'pino';
import { buildApp, SERVICE_NAME } from './app.js';
import { loadInvalidatorConfig } from './config.js';
import { createInvalidatorWorker } from './worker.js';

const config = loadInvalidatorConfig();
const logger = pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL));

const redis = createRedisClient({
  url: config.REDIS_URL,
  logger,
  commandTimeoutMs: config.CACHE_COMMAND_TIMEOUT_MS,
});
// The TTL is the readers' concern; the invalidator only deletes.
const cache = new SharedCache(redis, { logger, ttlSeconds: 1 });
const kafka = createKafkaClient({ ...kafkaConnectionFromEnv(config), logger });
const { consumer, stats } = createInvalidatorWorker({ kafka, cache, logger });
const app = buildApp(logger, redis, consumer, stats);

installGracefulShutdown({
  log: logger,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  steps: [
    { name: 'consumer', run: () => consumer.stop() },
    { name: 'http', run: () => app.close() },
    { name: 'redis', run: async () => void (await redis.quit().catch(() => redis.disconnect())) },
  ],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  await consumer.start();
  logger.info('cache invalidator started');
} catch (err) {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
}
