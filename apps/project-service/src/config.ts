import { baseEnvSchema, httpServerEnvSchema, loadConfig, withDatabaseUrl } from '@dpp/config';
import { z } from 'zod';

const envSchema = baseEnvSchema
  .extend(httpServerEnvSchema.shape)
  .extend({
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
    // Shared board cache (ADR-015). Off unless configured: PostgreSQL alone is always correct.
    CACHE_ENABLED: z.stringbool().default(false),
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\/[^\s]+$/, 'must be a redis:// or rediss:// URL')
      .optional(),
    // Safety net only: Kafka-driven invalidation is what keeps entries fresh. Finite by design.
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
    CACHE_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(250),
  })
  .refine((c) => !c.CACHE_ENABLED || c.REDIS_URL !== undefined, {
    path: ['REDIS_URL'],
    message: 'is required when CACHE_ENABLED=true',
  });

export type ProjectServiceConfig = z.infer<typeof envSchema>;

export function loadProjectServiceConfig(
  env: Record<string, string | undefined> = process.env,
): ProjectServiceConfig {
  return loadConfig(envSchema, withDatabaseUrl(env));
}
