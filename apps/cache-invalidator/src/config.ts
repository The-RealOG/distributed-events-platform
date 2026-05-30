import { baseEnvSchema, httpServerEnvSchema, loadConfig } from '@dpp/config';
import { kafkaEnvSchema } from '@dpp/kafka';
import { z } from 'zod';

const envSchema = baseEnvSchema
  .extend(httpServerEnvSchema.shape)
  .extend(kafkaEnvSchema.shape)
  .extend({
    // redis://… locally, rediss://… (TLS) for ElastiCache.
    REDIS_URL: z.string().regex(/^rediss?:\/\/[^\s]+$/, 'must be a redis:// or rediss:// URL'),
    CACHE_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(500),
  });

export type InvalidatorConfig = z.infer<typeof envSchema>;

export function loadInvalidatorConfig(
  env: Record<string, string | undefined> = process.env,
): InvalidatorConfig {
  return loadConfig(envSchema, env);
}
