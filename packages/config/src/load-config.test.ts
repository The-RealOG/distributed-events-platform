import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, baseEnvSchema, httpServerEnvSchema, loadConfig } from './index.js';

const schema = baseEnvSchema.extend(httpServerEnvSchema.shape).extend({
  JWT_SECRET: z.string().min(32),
});

describe('loadConfig', () => {
  it('parses, coerces and applies defaults', () => {
    const config = loadConfig(schema, { PORT: '3001', JWT_SECRET: 'x'.repeat(32) });

    expect(config).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      HOST: '0.0.0.0',
      PORT: 3001,
      SHUTDOWN_TIMEOUT_MS: 10_000,
      JWT_SECRET: 'x'.repeat(32),
    });
  });

  it('reports every invalid variable at once', () => {
    let error: unknown;
    try {
      loadConfig(schema, { PORT: 'not-a-port', LOG_LEVEL: 'loud' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const paths = (error as ConfigError).issues.map((issue) => issue.split(':')[0]);
    expect(paths).toEqual(expect.arrayContaining(['PORT', 'LOG_LEVEL', 'JWT_SECRET']));
  });

  it('never includes received values in error messages', () => {
    const secret = 'short-but-secret';
    try {
      loadConfig(schema, { PORT: '3001', JWT_SECRET: secret });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
