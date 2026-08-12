import { createDatabase, databaseTlsCaFromEnv } from '@dpp/database';
import { createKafkaClient, kafkaConnectionFromEnv } from '@dpp/kafka';
import { createLoggerOptions, Metrics } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { pino } from 'pino';
import { buildApp, SERVICE_NAME } from './app.js';
import { loadActivityConfig } from './config.js';
import { createActivityWorker } from './worker.js';

const config = loadActivityConfig();
const logger = pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL));

const database = createDatabase({
  connectionString: config.DATABASE_URL,
  applicationName: SERVICE_NAME,
  maxConnections: config.DATABASE_POOL_MAX,
  tlsCaPem: databaseTlsCaFromEnv(),
  onPoolError: (err) => logger.error({ err }, 'idle database client error'),
});
const kafka = createKafkaClient({ ...kafkaConnectionFromEnv(config), logger });
const metrics = new Metrics(SERVICE_NAME);
const { consumer, stats } = createActivityWorker({ kafka, db: database.db, logger, metrics });
const app = buildApp(logger, database, consumer, stats, metrics);

installGracefulShutdown({
  log: logger,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  steps: [
    // Finish the event in progress, commit offsets and leave the group.
    { name: 'consumer', run: () => consumer.stop() },
    { name: 'http', run: () => app.close() },
    { name: 'database', run: () => database.close() },
  ],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  await consumer.start();
  logger.info('activity service started');
} catch (err) {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
}
