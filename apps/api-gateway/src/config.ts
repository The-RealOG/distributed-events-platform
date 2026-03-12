import { baseEnvSchema, httpServerEnvSchema, loadConfig } from '@dpp/config';
import { z } from 'zod';

const envSchema = baseEnvSchema.extend(httpServerEnvSchema.shape).extend({
  // Internal address; never exposed to the browser.
  PROJECT_SERVICE_URL: z.url(),
  UPSTREAM_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  // Must exceed the Project Service's own statement timeout so that its 503 arrives first.
  UPSTREAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  // Comma-separated browser origins allowed to call the API, e.g. http://localhost:8080
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),
});

export type GatewayConfig = z.infer<typeof envSchema>;

export function loadGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig {
  return loadConfig(envSchema, env);
}
