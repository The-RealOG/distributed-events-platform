import { createHash } from 'node:crypto';
import {
  createLoggerOptions,
  registerHttpMetrics,
  registerRequestContext,
  requestIdOptions,
  type Metrics,
} from '@dpp/observability';
import { closeConnectionsWhenDraining } from '@dpp/runtime';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { GatewayConfig } from './config.js';
import { registerErrorHandling } from './errors.js';
import { API_PREFIX, registerProjectServiceProxy } from './proxy.js';
import { REALTIME_PATH, registerRealtimeProxy } from './realtime-proxy.js';

export const SERVICE_NAME = 'api-gateway';

export interface AppState {
  ready: boolean;
}

export async function buildApp(
  config: GatewayConfig,
  state: AppState,
  metrics?: Metrics,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL),
    ...requestIdOptions(),
    bodyLimit: config.BODY_LIMIT_BYTES,
    // X-Forwarded-For is not trusted: it would let callers spoof their address. Behind the ALB,
    // request.ip is therefore the load balancer's (see rateLimitKey).
    trustProxy: false,
  });
  registerRequestContext(app);
  registerErrorHandling(app);
  closeConnectionsWhenDraining(app);
  // /metrics lives outside /api, so CloudFront (which only forwards /api/*) never reaches it.
  if (metrics) registerHttpMetrics(app, metrics);

  // The browser boundary: only configured origins may call the API from a page.
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // Every non-safelisted header the web client sends must be listed, or the browser's preflight
    // fails: cache-control (read-your-writes reads) and idempotency-key (retry-safe creates).
    allowedHeaders: [
      'authorization',
      'cache-control',
      'content-type',
      'idempotency-key',
      'x-correlation-id',
    ],
    exposedHeaders: ['x-request-id', 'x-correlation-id'],
    maxAge: 600,
  });
  // Per client and per gateway task (in-memory; with N tasks a client gets up to N × max).
  // Probes, preflights and the WebSocket upgrade are not counted: realtime connections are
  // authenticated and bounded by the realtime service itself.
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    keyGenerator: rateLimitKey,
    allowList: (request) =>
      request.method === 'OPTIONS' ||
      !request.url.startsWith(`${API_PREFIX}/`) ||
      request.url.startsWith(REALTIME_PATH),
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      message: `Too many requests; retry after ${context.after}`,
    }),
  });
  // JSON API: no HTML is served, so a deny-everything CSP costs nothing.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });

  app.get('/health', () => ({ status: 'ok' }));

  // Readiness reflects only the gateway itself. If the Project Service is down, the gateway
  // still answers quickly with 503s; removing it from the load balancer would not help.
  app.get('/ready', async (_request, reply) =>
    state.ready ? { status: 'ready' } : reply.code(503).send({ status: 'not_ready' }),
  );

  if (config.REALTIME_SERVICE_URL) {
    registerRealtimeProxy(app, {
      upstreamUrl: config.REALTIME_SERVICE_URL,
      allowedOrigins: config.CORS_ORIGINS,
    });
  }

  await registerProjectServiceProxy(app, {
    upstreamUrl: config.PROJECT_SERVICE_URL,
    connectTimeoutMs: config.UPSTREAM_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: config.UPSTREAM_REQUEST_TIMEOUT_MS,
    bodyLimit: config.BODY_LIMIT_BYTES,
  });

  return app;
}

/**
 * The rate-limit bucket: one per bearer token (a hash, never the token itself), so many users
 * behind one address are limited independently. The gateway does not verify the token (the
 * Project Service does), so the bucket is per token, not per verified user: a client that sends a
 * different made-up token on every request gets a fresh bucket each time. Those requests are
 * rejected with 401 upstream, but they are not limited here. Requests without a token fall back
 * to the caller's address, which behind the ALB is the load balancer's (trustProxy is off), so
 * unauthenticated requests then share one bucket.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return `user:${createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32)}`;
  }
  return `ip:${request.ip}`;
}
