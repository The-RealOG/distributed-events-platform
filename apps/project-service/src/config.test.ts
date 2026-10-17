import { describe, expect, it } from 'vitest';
import { loadProjectServiceConfig } from './config.js';

const base = {
  PORT: '3001',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
  JWT_SECRET: 'x'.repeat(32),
};

describe('dev login guard', () => {
  it('refuses dev login when the environment is production or undeclared', () => {
    expect(() => loadProjectServiceConfig({ ...base, AUTH_DEV_LOGIN_ENABLED: 'true' })).toThrow(
      /AUTH_DEV_LOGIN_ENABLED/,
    );
    expect(() =>
      loadProjectServiceConfig({
        ...base,
        AUTH_DEV_LOGIN_ENABLED: 'true',
        DEPLOYMENT_ENVIRONMENT: 'production',
      }),
    ).toThrow(/AUTH_DEV_LOGIN_ENABLED/);
  });

  it('allows dev login only where the environment declares itself non-production', () => {
    for (const env of ['local', 'test', 'dev'] as const) {
      const c = loadProjectServiceConfig({
        ...base,
        AUTH_DEV_LOGIN_ENABLED: 'true',
        DEPLOYMENT_ENVIRONMENT: env,
      });
      expect(c.AUTH_DEV_LOGIN_ENABLED).toBe(true);
    }
  });

  it('keeps production working with dev login off', () => {
    expect(loadProjectServiceConfig(base).AUTH_DEV_LOGIN_ENABLED).toBe(false);
  });
});
