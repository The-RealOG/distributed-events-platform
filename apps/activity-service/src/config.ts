import { baseEnvSchema, httpServerEnvSchema, loadConfig, withDatabaseUrl } from '@dpp/config';
import { kafkaEnvSchema } from '@dpp/kafka';
import { z } from 'zod';

const envSchema = baseEnvSchema
  .extend(httpServerEnvSchema.shape)
  .extend(kafkaEnvSchema.shape)
  .extend({
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(4),
  });

export type ActivityConfig = z.infer<typeof envSchema>;

export function loadActivityConfig(
  env: Record<string, string | undefined> = process.env,
): ActivityConfig {
  return loadConfig(envSchema, withDatabaseUrl(env));
}
