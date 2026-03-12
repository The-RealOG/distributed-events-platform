import { createLoggerOptions, registerRequestContext, requestIdOptions } from '@dpp/observability';
import { closeConnectionsWhenDraining } from '@dpp/runtime';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import type { GatewayConfig } from './config.js';
import { registerErrorHandling } from './errors.js';
import { registerProjectServiceProxy } from './proxy.js';

export const SERVICE_NAME = 'api-gateway';

export interface AppState {
  ready: boolean;
}

export async function buildApp(config: GatewayConfig, state: AppState): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL),
    ...requestIdOptions(),
    bodyLimit: config.BODY_LIMIT_BYTES,
    // Nothing sits in front of the gateway locally, so X-Forwarded-For from clients is not
    // trusted (it would let callers spoof their IP). Enable for the ALB in deployment.
    trustProxy: false,
  });
  registerRequestContext(app);
  registerErrorHandling(app);
  closeConnectionsWhenDraining(app);

  // The browser boundary: only configured origins may call the API from a page.
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-correlation-id'],
    exposedHeaders: ['x-request-id', 'x-correlation-id'],
    maxAge: 600,
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

  await registerProjectServiceProxy(app, {
    upstreamUrl: config.PROJECT_SERVICE_URL,
    connectTimeoutMs: config.UPSTREAM_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: config.UPSTREAM_REQUEST_TIMEOUT_MS,
    bodyLimit: config.BODY_LIMIT_BYTES,
  });

  return app;
}
