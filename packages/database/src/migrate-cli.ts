import { loadConfig } from '@dpp/config';
import { z } from 'zod';
import { runMigrations } from './migrate.js';

// Run as a one-shot job before services start (a Compose service locally, an ECS task later).
const config = loadConfig(z.object({ DATABASE_URL: z.url() }));

try {
  await runMigrations(config.DATABASE_URL);
  process.stdout.write(JSON.stringify({ level: 'info', msg: 'migrations applied' }) + '\n');
} catch (err) {
  process.stderr.write(
    JSON.stringify({ level: 'error', msg: 'migration failed', err: String(err) }) + '\n',
  );
  process.exit(1);
}
