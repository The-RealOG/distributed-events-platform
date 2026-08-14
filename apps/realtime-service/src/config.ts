import { hostname } from 'node:os';
import { baseEnvSchema, httpServerEnvSchema, loadConfig, withDatabaseUrl } from '@dpp/config';
import { kafkaEnvSchema } from '@dpp/kafka';
import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const envSchema = baseEnvSchema
  .extend(httpServerEnvSchema.shape)
  .extend(kafkaEnvSchema.shape)
  .extend({
    // Membership checks for subscriptions (read-only).
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: positiveInt.default(4),
    // Same token verification as the Project Service (no separate auth system).
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('dpp-local'),
    JWT_AUDIENCE: z.string().min(1).default('dpp-api'),
    // Identifies this replica's own consumer group (every replica reads every event; ADR-017).
    REALTIME_INSTANCE_ID: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,80}$/)
      .default(`${hostname()}-${process.pid}`.replace(/[^A-Za-z0-9._-]/g, '-')),
    REALTIME_MAX_BUFFERED_BYTES: positiveInt.default(1024 * 1024),
    REALTIME_HEARTBEAT_MS: positiveInt.min(1_000).default(15_000),
    REALTIME_AUTH_TIMEOUT_MS: positiveInt.default(5_000),
  });

export type RealtimeConfig = z.infer<typeof envSchema>;

export function loadRealtimeConfig(
  env: Record<string, string | undefined> = process.env,
): RealtimeConfig {
  return loadConfig(envSchema, withDatabaseUrl(env));
}
