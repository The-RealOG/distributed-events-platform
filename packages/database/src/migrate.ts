import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface MigrationOptions {
  tlsCaPem?: string | undefined;
  /**
   * If given, ensure this least-privilege login role exists with this password and has data
   * access (no DDL) to the application tables. Services connect as it; the migration job
   * connects as the database owner.
   */
  appUser?: { name: string; password: string } | undefined;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Applies pending SQL migrations. Drizzle takes an advisory lock, so concurrent runs are safe. */
export async function runMigrations(
  connectionString: string,
  options: MigrationOptions = {},
): Promise<void> {
  const database = createDatabase({
    connectionString,
    applicationName: 'migrate',
    maxConnections: 1,
    tlsCaPem: options.tlsCaPem,
  });
  try {
    await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
    if (options.appUser) await ensureAppUser(database.db, options.appUser);
  } finally {
    await database.close();
  }
}

async function ensureAppUser(
  db: ReturnType<typeof createDatabase>['db'],
  user: { name: string; password: string },
) {
  if (!ROLE_NAME.test(user.name)) throw new Error('invalid application role name');
  // DDL cannot take bind parameters; format(%I, %L) quotes the identifier and the password
  // safely inside PostgreSQL, so neither is ever concatenated into SQL text here.
  await db.transaction(async (tx) => {
    const exists = await tx.execute(sql`SELECT 1 FROM pg_roles WHERE rolname = ${user.name}`);
    const verb = exists.rows.length > 0 ? 'ALTER' : 'CREATE';
    const statement = await tx.execute<{ ddl: string }>(
      sql`SELECT format(${`${verb} ROLE %I WITH LOGIN PASSWORD %L`}, ${user.name}::text, ${user.password}::text) AS ddl`,
    );
    await tx.execute(sql.raw(statement.rows[0]!.ddl));
    const grants = [
      'GRANT CONNECT ON DATABASE %I TO %I',
      'GRANT USAGE ON SCHEMA public TO %2$I',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %2$I',
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %2$I',
      // Tables created by future migrations get the same rights automatically.
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %2$I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %2$I',
    ];
    for (const template of grants) {
      const ddl = await tx.execute<{ ddl: string }>(
        sql`SELECT format(${template}, current_database(), ${user.name}::text) AS ddl`,
      );
      await tx.execute(sql.raw(ddl.rows[0]!.ddl));
    }
  });
}
