import { LocalJwtAuthProvider } from '@dpp/auth';
import { createRedisClient, SharedCache } from '@dpp/cache';
import { createDatabase, databaseTlsCaFromEnv } from '@dpp/database';
import { createLoggerOptions } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { pino } from 'pino';
import { buildApp, SERVICE_NAME, type AppState } from './app.js';
import { loadProjectServiceConfig } from './config.js';
import { BoardCache } from './modules/projects/board-cache.js';

const config = loadProjectServiceConfig();
const state: AppState = { ready: false };

const authProvider = new LocalJwtAuthProvider({
  secret: config.JWT_SECRET,
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  ttlSeconds: config.JWT_TTL_SECONDS,
});

const database = createDatabase({
  connectionString: config.DATABASE_URL,
  applicationName: 'project-service',
  maxConnections: config.DATABASE_POOL_MAX,
  // RDS enforces TLS; the deployed image ships its CA bundle (unset locally).
  tlsCaPem: databaseTlsCaFromEnv(),
  onPoolError: (err) => app.log.error({ err }, 'idle database client error'),
});

// Optional shared cache. Redis never participates in writes, and its absence never fails a read.
const redis =
  config.CACHE_ENABLED && config.REDIS_URL
    ? createRedisClient({
        url: config.REDIS_URL,
        logger: pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL)),
        commandTimeoutMs: config.CACHE_COMMAND_TIMEOUT_MS,
      })
    : undefined;
const boardCache = redis
  ? new BoardCache(
      new SharedCache(redis, {
        logger: pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL)),
        ttlSeconds: config.CACHE_TTL_SECONDS,
      }),
    )
  : undefined;

const app = buildApp(
  {
    config,
    database,
    authProvider,
    devTokenIssuer: config.AUTH_DEV_LOGIN_ENABLED ? authProvider : undefined,
    boardCache,
  },
  state,
);
const log = app.log;
if (config.AUTH_DEV_LOGIN_ENABLED) {
  log.warn('dev login is enabled: POST /auth/dev-login issues tokens without a password');
}

installGracefulShutdown({
  log,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  onStart: () => {
    state.ready = false;
  },
  // Drain HTTP first; in-flight requests still need the pool.
  steps: [
    { name: 'http', run: () => app.close() },
    { name: 'database', run: () => database.close() },
    ...(redis
      ? [
          {
            name: 'redis',
            run: async () => void (await redis.quit().catch(() => redis.disconnect())),
          },
        ]
      : []),
  ],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  state.ready = true;
} catch (err) {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
}
