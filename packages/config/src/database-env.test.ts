import { describe, expect, it } from 'vitest';
import { withDatabaseUrl } from './database-env.js';

describe('withDatabaseUrl', () => {
  it('builds DATABASE_URL from separate parts, encoding special characters', () => {
    const env = withDatabaseUrl({
      DB_HOST: 'db.internal',
      DB_NAME: 'dpp',
      DB_USER: 'dpp_app',
      DB_PASSWORD: 'p@ss:w/rd#?&',
    });
    const url = new URL(env['DATABASE_URL']!);
    expect(url.hostname).toBe('db.internal');
    expect(url.port).toBe('5432');
    expect(url.pathname).toBe('/dpp');
    expect(decodeURIComponent(url.username)).toBe('dpp_app');
    expect(decodeURIComponent(url.password)).toBe('p@ss:w/rd#?&');
  });

  it('leaves an explicit DATABASE_URL untouched', () => {
    const env = { DATABASE_URL: 'postgres://a:b@c:5432/d', DB_HOST: 'ignored' };
    expect(withDatabaseUrl(env)).toBe(env);
  });

  it('does nothing when parts are missing (validation then reports DATABASE_URL)', () => {
    expect(withDatabaseUrl({ DB_HOST: 'x' })['DATABASE_URL']).toBeUndefined();
  });
});
