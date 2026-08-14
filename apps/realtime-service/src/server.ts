import { LocalJwtAuthProvider } from '@dpp/auth';
import { REALTIME_CLOSE } from '@dpp/contracts';
import { createDatabase, databaseTlsCaFromEnv } from '@dpp/database';
import { createKafkaClient, kafkaConnectionFromEnv } from '@dpp/kafka';
import { createLoggerOptions, Metrics } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { pino } from 'pino';
import { buildApp, SERVICE_NAME } from './app.js';
import { loadRealtimeConfig } from './config.js';
import { Hub } from './hub.js';
import { createRealtimeWorker } from './worker.js';

const config = loadRealtimeConfig();
const logger = pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL));
const metrics = new Metrics(SERVICE_NAME);

const database = createDatabase({
  connectionString: config.DATABASE_URL,
  applicationName: SERVICE_NAME,
  maxConnections: config.DATABASE_POOL_MAX,
  tlsCaPem: databaseTlsCaFromEnv(),
  onPoolError: (err) => logger.error({ err }, 'idle database client error'),
});
const authProvider = new LocalJwtAuthProvider({
  secret: config.JWT_SECRET,
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  ttlSeconds: 60, // verification only; this service issues nothing
});
const hub = new Hub({
  logger,
  maxBufferedBytes: config.REALTIME_MAX_BUFFERED_BYTES,
  heartbeatMs: config.REALTIME_HEARTBEAT_MS,
});
const kafka = createKafkaClient({ ...kafkaConnectionFromEnv(config), logger });
const consumer = createRealtimeWorker({
  kafka,
  hub,
  logger,
  instanceId: config.REALTIME_INSTANCE_ID,
  metrics,
});
const app = await buildApp({
  logger,
  database,
  authProvider,
  hub,
  consumer,
  authTimeoutMs: config.REALTIME_AUTH_TIMEOUT_MS,
  metrics,
});

installGracefulShutdown({
  log: logger,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  steps: [
    // Clients are told to reconnect (they will land on another replica and refetch).
    {
      name: 'websockets',
      run: async () => hub.closeAll(REALTIME_CLOSE.goingAway, 'server shutting down'),
    },
    { name: 'http', run: () => app.close() },
    { name: 'consumer', run: () => consumer.stop() },
    { name: 'database', run: () => database.close() },
  ],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  hub.startHeartbeat();
  await consumer.start();
  logger.info({ instanceId: config.REALTIME_INSTANCE_ID }, 'realtime service started');
} catch (err) {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
}
