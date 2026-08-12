import { createDatabase, databaseTlsCaFromEnv } from '@dpp/database';
import { createKafkaClient, DomainEventProducer, kafkaConnectionFromEnv } from '@dpp/kafka';
import { createLoggerOptions, Metrics } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { pino } from 'pino';
import { buildApp, SERVICE_NAME } from './app.js';
import { loadPublisherConfig } from './config.js';
import { registerOutboxMetrics } from './metrics.js';
import { OutboxPublisher } from './publisher.js';

const config = loadPublisherConfig();
const logger = pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL));

const database = createDatabase({
  connectionString: config.DATABASE_URL,
  applicationName: SERVICE_NAME,
  maxConnections: config.DATABASE_POOL_MAX,
  // RDS enforces TLS; the deployed image ships its CA bundle (unset locally).
  tlsCaPem: databaseTlsCaFromEnv(),
  onPoolError: (err) => logger.error({ err }, 'idle database client error'),
});
// Local plaintext broker or MSK with IAM auth, decided entirely by configuration.
const kafka = createKafkaClient({ ...kafkaConnectionFromEnv(config), logger });
const metrics = new Metrics(SERVICE_NAME);

const publisher = new OutboxPublisher({
  db: database.db,
  sink: new DomainEventProducer({ kafka, logger }),
  logger,
  workerId: config.OUTBOX_WORKER_ID,
  batchSize: config.OUTBOX_BATCH_SIZE,
  pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
  leaseMs: config.OUTBOX_LEASE_MS,
  backoff: { baseMs: config.OUTBOX_BACKOFF_BASE_MS, maxMs: config.OUTBOX_BACKOFF_MAX_MS },
  // No `faults`: fault injection exists only for tests that construct the publisher themselves.
  observer: registerOutboxMetrics(metrics, database.db),
});
const app = buildApp(logger, database, publisher, metrics);

installGracefulShutdown({
  log: logger,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  steps: [
    // Stop claiming, finish the event in flight, release leases, disconnect Kafka.
    { name: 'publisher', run: () => publisher.stop({ timeoutMs: config.SHUTDOWN_TIMEOUT_MS / 2 }) },
    { name: 'http', run: () => app.close() },
    { name: 'database', run: () => database.close() },
  ],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  publisher.start();
  logger.info({ workerId: config.OUTBOX_WORKER_ID }, 'outbox publisher started');
} catch (err) {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
}
