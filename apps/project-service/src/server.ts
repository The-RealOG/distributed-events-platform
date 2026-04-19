import { LocalJwtAuthProvider } from '@dpp/auth';
import { createDatabase, databaseTlsCaFromEnv } from '@dpp/database';
import { installGracefulShutdown } from '@dpp/runtime';
import { buildApp, type AppState } from './app.js';
import { loadProjectServiceConfig } from './config.js';

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

const app = buildApp(
  {
    config,
    database,
    authProvider,
    devTokenIssuer: config.AUTH_DEV_LOGIN_ENABLED ? authProvider : undefined,
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
  ],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  state.ready = true;
} catch (err) {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
}
