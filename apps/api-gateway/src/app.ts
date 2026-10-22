import { BlockList, isIPv6 } from 'node:net';
import {
  AuthenticationError,
  LocalJwtAuthProvider,
  parseBearerToken,
  type AuthProvider,
} from '@dpp/auth';
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
    // request.ip is the client's address only through the known proxies (see trustedProxies).
    trustProxy: trustedProxies(config),
  });
  const authProvider = new LocalJwtAuthProvider({
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    ttlSeconds: 60, // verification only; the gateway issues nothing
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
    keyGenerator: (request) => rateLimitKey(request, authProvider),
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
 * The rate-limit bucket: one per verified user, so many users behind one address are limited
 * independently. A missing, invalid or expired token gets the client's address instead, so
 * inventing tokens never yields a fresh bucket. Verifying here only picks the bucket: the request
 * is forwarded either way, and the services still make the authentication decision.
 */
export async function rateLimitKey(
  request: FastifyRequest,
  authProvider: AuthProvider,
): Promise<string> {
  const token = parseBearerToken(request.headers.authorization);
  if (token) {
    try {
      return `user:${(await authProvider.authenticate(token)).userId}`;
    } catch (err) {
      if (!(err instanceof AuthenticationError)) throw err;
    }
  }
  return `ip:${request.ip}`;
}

/**
 * X-Forwarded-For is caller-controlled except for the entries our own proxies append. It is read
 * only when the TCP peer is in TRUSTED_PROXY_CIDRS, and then only TRUSTED_PROXY_HOPS entries back
 * from the peer: behind CloudFront and the ALB, the entry CloudFront appended (the viewer's
 * address). Anything a caller put before it is ignored. A connection from anywhere else, such as a
 * task's public IP if its security group were opened, is keyed by its own TCP address.
 */
function trustedProxies(
  config: GatewayConfig,
): false | ((address: string, hop: number) => boolean) {
  if (config.TRUSTED_PROXY_CIDRS.length === 0) return false;
  const peers = new BlockList();
  for (const cidr of config.TRUSTED_PROXY_CIDRS) {
    const [network, prefix] = cidr.split('/');
    peers.addSubnet(network!, Number(prefix), 'ipv4');
  }
  return (address, hop) =>
    hop === 0
      ? peers.check(address, isIPv6(address) ? 'ipv6' : 'ipv4')
      : hop < config.TRUSTED_PROXY_HOPS;
}
