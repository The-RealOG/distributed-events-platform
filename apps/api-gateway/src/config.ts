import { baseEnvSchema, httpServerEnvSchema, loadConfig } from '@dpp/config';
import { z } from 'zod';

const envSchema = baseEnvSchema.extend(httpServerEnvSchema.shape).extend({
  // Internal address; never exposed to the browser.
  PROJECT_SERVICE_URL: z.url(),
  // Realtime WebSockets are relayed only when this is set.
  REALTIME_SERVICE_URL: z.url().optional(),
  UPSTREAM_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  // Must exceed the Project Service's own statement timeout so that its 503 arrives first.
  UPSTREAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Same token verification as the Project Service, used only to key the rate limit: the gateway
  // still forwards every request and the services make the authentication decision.
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default('dpp-local'),
  JWT_AUDIENCE: z.string().min(1).default('dpp-api'),
  // Requests per client per window (a client is a verified user, else the client's IP).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // X-Forwarded-For is read only on connections from these networks (in AWS, the VPC, where the
  // ALB lives). Empty: it is ignored and the client is the TCP peer.
  TRUSTED_PROXY_CIDRS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((cidr) => cidr.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.cidrv4())),
  // Proxies in front of the gateway, counting the TCP peer. In AWS: CloudFront and the ALB (2),
  // each appending the address it received the request from to X-Forwarded-For.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().positive().default(1),
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
