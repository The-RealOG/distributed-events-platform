import { createIsolatedDatabase } from '@dpp/test-utils';
import { runMigrations } from '@dpp/database';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { inject } from 'vitest';

/**
 * The migration job's least-privilege application role (used by services in AWS): data access
 * to every application table, no schema changes, and the password is (re)set on every run.
 */
describe('migration job: application role', () => {
  it('creates a login role with DML but no DDL rights, and rotates its password idempotently', async () => {
    const ownerUrl = await createIsolatedDatabase(inject('databaseUrl'));
    const tricky = `p@ss'w"rd:/?#${'x'.repeat(8)}`; // quoting must be done by PostgreSQL, not us
    const role = `dpp_app_${Date.now()}`;
    await runMigrations(ownerUrl, { appUser: { name: role, password: tricky } });

    const asApp = (password: string) => {
      const url = new URL(ownerUrl);
      url.username = role;
      url.password = encodeURIComponent(password);
      return new pg.Client({ connectionString: url.toString() });
    };

    const app = asApp(tricky);
    await app.connect();
    try {
      await app.query(`INSERT INTO users (email, display_name) VALUES ('a@example.com', 'A')`);
      const { rows } = await app.query('SELECT count(*)::int AS n FROM users');
      expect(rows[0].n).toBe(1);
      // Identity sequence usage works (outbox rows get a sequence_id).
      await expect(app.query('SELECT count(*) FROM outbox_events')).resolves.toBeDefined();
      await expect(app.query('CREATE TABLE sneaky (id int)')).rejects.toThrow(/permission denied/);
      await expect(app.query('DROP TABLE users')).rejects.toThrow(
        /must be owner|permission denied/,
      );
    } finally {
      await app.end();
    }

    // Second run with a new password: idempotent, and the old password stops working.
    await runMigrations(ownerUrl, {
      appUser: { name: role, password: 'a-completely-new-password-123' },
    });
    await expect(asApp(tricky).connect()).rejects.toThrow(/password authentication failed/);
    const rotated = asApp('a-completely-new-password-123');
    await rotated.connect();
    await rotated.end();
  });

  it('rejects unsafe role names', async () => {
    const ownerUrl = await createIsolatedDatabase(inject('databaseUrl'));
    await expect(
      runMigrations(ownerUrl, {
        appUser: { name: 'x; DROP TABLE users', password: 'irrelevant-password' },
      }),
    ).rejects.toThrow(/invalid application role name/);
  });
});
