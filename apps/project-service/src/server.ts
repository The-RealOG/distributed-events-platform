import { LocalJwtAuthProvider } from '@dpp/auth';
import { createRedisClient, SharedCache } from '@dpp/cache';
import { createDatabase, databaseTlsCaFromEnv } from '@dpp/database';
import { createLoggerOptions, Metrics } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { pino } from 'pino';
import { buildApp, SERVICE_NAME, type AppState } from './app.js';
import { loadProjectServiceConfig } from './config.js';
import { AttachmentService } from './modules/attachments/service.js';
import { BoardCache } from './modules/projects/board-cache.js';
import { S3ObjectStorage } from '@dpp/storage';
import { sql } from '@dpp/database';

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

// Attachments: the object store is used only by attachment requests (never by task CRUD).
// In AWS the SDK uses the task role; locally the S3-compatible endpoint's keys come from env.
const attachments = config.STORAGE_ENABLED
  ? new AttachmentService(
      database.db,
      new S3ObjectStorage({
        bucket: config.STORAGE_BUCKET!,
        region: config.STORAGE_REGION,
        endpoint: config.STORAGE_ENDPOINT,
        publicEndpoint: config.STORAGE_PUBLIC_ENDPOINT,
        forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
      }),
      {
        maxBytes: config.ATTACHMENT_MAX_BYTES,
        uploadUrlTtlSeconds: config.ATTACHMENT_UPLOAD_URL_TTL_SECONDS,
        downloadUrlTtlSeconds: config.ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS,
        pendingTtlSeconds: config.ATTACHMENT_PENDING_TTL_SECONDS,
      },
      pino(createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL)),
    )
  : undefined;

const app = buildApp(
  {
    config,
    database,
    authProvider,
    devTokenIssuer: config.AUTH_DEV_LOGIN_ENABLED ? authProvider : undefined,
    boardCache,
    metrics: new Metrics(SERVICE_NAME),
    attachments,
  },
  state,
);
const log = app.log;
if (config.AUTH_DEV_LOGIN_ENABLED) {
  log.warn('dev login is enabled: POST /auth/dev-login issues tokens without a password');
}

// Converge attachment metadata and objects. One replica at a time: a transaction-scoped advisory
// lock (released on commit) skips the run if another replica is sweeping.
const SWEEP_LOCK = 4_217_001;
const sweep = setInterval(() => {
  if (!attachments) return;
  void database.db
    .transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK}) AS locked`,
      );
      if (lock.rows[0]?.locked) await attachments.sweep();
    })
    .catch((err: unknown) => log.warn({ err }, 'attachment sweep failed; will retry'));
}, config.ATTACHMENT_SWEEP_INTERVAL_MS);
sweep.unref();

installGracefulShutdown({
  log,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  onStart: () => {
    state.ready = false;
  },
  // Drain HTTP first; in-flight requests still need the pool.
  steps: [
    { name: 'attachment-sweep', run: async () => clearInterval(sweep) },
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
