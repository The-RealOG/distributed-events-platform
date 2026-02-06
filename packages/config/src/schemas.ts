import { z } from 'zod';

/** Variables every backend process reads. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** Variables for processes that expose an HTTP listener. */
export const httpServerEnvSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});
