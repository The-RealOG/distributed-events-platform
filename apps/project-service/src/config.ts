import { baseEnvSchema, httpServerEnvSchema, loadConfig } from '@dpp/config';
import { z } from 'zod';

const envSchema = baseEnvSchema.extend(httpServerEnvSchema.shape).extend({
  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('dpp-local'),
  JWT_AUDIENCE: z.string().min(1).default('dpp-api'),
  JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 60 * 60),
  // Passwordless login by email, for local development and tests only. Off unless explicitly set.
  AUTH_DEV_LOGIN_ENABLED: z.stringbool().default(false),
});

export type ProjectServiceConfig = z.infer<typeof envSchema>;

export function loadProjectServiceConfig(
  env: Record<string, string | undefined> = process.env,
): ProjectServiceConfig {
  return loadConfig(envSchema, env);
}
