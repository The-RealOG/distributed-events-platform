import { hostname } from 'node:os';
import { baseEnvSchema, httpServerEnvSchema, loadConfig } from '@dpp/config';
import { kafkaEnvSchema } from '@dpp/kafka';
import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const envSchema = baseEnvSchema
  .extend(httpServerEnvSchema.shape)
  .extend(kafkaEnvSchema.shape)
  .extend({
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: positiveInt.default(4),
    // Most events claimed per cycle (at most one per project; see claimOutboxBatch).
    OUTBOX_BATCH_SIZE: positiveInt.max(1_000).default(50),
    // Sleep between cycles only when idle; while events are found the worker re-polls at once.
    OUTBOX_POLL_INTERVAL_MS: positiveInt.default(500),
    // Lease on claimed rows. Must exceed the longest publish attempt (KafkaJS connect + retries
    // ≈ 15 s); an expired lease lets another worker republish (a duplicate, never a loss).
    OUTBOX_LEASE_MS: positiveInt.min(1_000).default(60_000),
    OUTBOX_BACKOFF_BASE_MS: positiveInt.default(1_000),
    OUTBOX_BACKOFF_MAX_MS: positiveInt.default(60_000),
    // Identifies this replica in claimed_by. Unique per process by default.
    OUTBOX_WORKER_ID: z.string().min(1).max(100).default(`${hostname()}-${process.pid}`),
  })
  .refine((c) => c.OUTBOX_BACKOFF_MAX_MS >= c.OUTBOX_BACKOFF_BASE_MS, {
    path: ['OUTBOX_BACKOFF_MAX_MS'],
    message: 'must be at least OUTBOX_BACKOFF_BASE_MS',
  });

export type PublisherConfig = z.infer<typeof envSchema>;

export function loadPublisherConfig(
  env: Record<string, string | undefined> = process.env,
): PublisherConfig {
  return loadConfig(envSchema, env);
}
