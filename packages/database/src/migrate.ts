import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Applies pending SQL migrations. Drizzle takes an advisory lock, so concurrent runs are safe. */
export async function runMigrations(connectionString: string): Promise<void> {
  const database = createDatabase({
    connectionString,
    applicationName: 'migrate',
    maxConnections: 1,
  });
  try {
    await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await database.close();
  }
}
