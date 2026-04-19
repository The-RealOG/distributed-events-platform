import { loadConfig, withDatabaseUrl } from '@dpp/config';
import { z } from 'zod';
import { runMigrations } from './migrate.js';
import { databaseTlsCaFromEnv } from './tls.js';

// One-shot job before services start: a Compose service locally, an ECS RunTask in AWS.
const config = loadConfig(
  z.object({
    DATABASE_URL: z.url(),
    APP_DB_USER: z.string().min(1).optional(),
    APP_DB_PASSWORD: z.string().min(16).optional(),
  }),
  withDatabaseUrl(process.env),
);
const log = (level: string, msg: string, extra: object = {}) =>
  process.stdout.write(`${JSON.stringify({ level, service: 'migrate', msg, ...extra })}\n`);

try {
  const appUser =
    config.APP_DB_USER && config.APP_DB_PASSWORD
      ? { name: config.APP_DB_USER, password: config.APP_DB_PASSWORD }
      : undefined;
  await runMigrations(config.DATABASE_URL, { tlsCaPem: databaseTlsCaFromEnv(), appUser });
  log('info', 'migrations applied', { appUser: appUser?.name ?? null });
} catch (err) {
  // The message only: connection errors can embed the URL.
  log('error', 'migration failed', {
    error:
      err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, '<url>') : 'unknown',
  });
  process.exit(1);
}
