import type { AuthProvider } from '@dpp/auth';
import type { DatabaseHandle } from '@dpp/database';
import { registerCacheMetrics } from '@dpp/cache';
import {
  createLoggerOptions,
  registerHttpMetrics,
  registerPoolMetrics,
  registerRequestContext,
  requestIdOptions,
  type Metrics,
} from '@dpp/observability';
import { closeConnectionsWhenDraining } from '@dpp/runtime';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ProjectServiceConfig } from './config.js';
import { registerPrincipal } from './http/authenticate.js';
import { registerErrorHandling } from './http/errors.js';
import { activityRoutes } from './modules/activity/routes.js';
import { attachmentRoutes } from './modules/attachments/routes.js';
import type { AttachmentService } from './modules/attachments/service.js';
import { ActivityService } from './modules/activity/service.js';
import { devLoginRoutes, identityRoutes } from './modules/identity/routes.js';
import { IdentityService, type TokenIssuer } from './modules/identity/service.js';
import type { BoardCache } from './modules/projects/board-cache.js';
import { projectRoutes } from './modules/projects/routes.js';
import { ProjectService } from './modules/projects/service.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { TaskService } from './modules/tasks/service.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { WorkspaceService } from './modules/workspaces/service.js';

export const SERVICE_NAME = 'project-service';

const READINESS_TIMEOUT_MS = 2_000;

export interface AppState {
  /** Flipped to false at the start of shutdown so load balancers drain traffic first. */
  ready: boolean;
}

export interface AppDependencies {
  config: ProjectServiceConfig;
  database: DatabaseHandle;
  authProvider: AuthProvider;
  /** Present only when dev login is enabled. */
  devTokenIssuer?: TokenIssuer | undefined;
  /** Present only when the shared cache is enabled (ADR-015). */
  boardCache?: BoardCache | undefined;
  metrics?: Metrics | undefined;
  /** Present only when object storage is configured (ADR-021). */
  attachments?: AttachmentService | undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function buildApp(deps: AppDependencies, state: AppState): FastifyInstance {
  const { config, database, authProvider } = deps;

  const app = Fastify({
    logger: createLoggerOptions(SERVICE_NAME, config.LOG_LEVEL),
    ...requestIdOptions(),
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerRequestContext(app);
  registerPrincipal(app);
  registerErrorHandling(app);
  closeConnectionsWhenDraining(app);
  if (deps.metrics) {
    registerHttpMetrics(app, deps.metrics);
    registerPoolMetrics(deps.metrics, database.pool);
    if (deps.boardCache) registerCacheMetrics(deps.metrics, deps.boardCache.shared.stats);
  }

  app.get('/health', () => ({ status: 'ok' }));

  // PostgreSQL is this service's only hard dependency: without it no request can succeed.
  app.get('/ready', async (request, reply) => {
    if (!state.ready) return reply.code(503).send({ status: 'not_ready', reason: 'shutting_down' });
    try {
      await withTimeout(database.ping(), READINESS_TIMEOUT_MS);
      return { status: 'ready' };
    } catch (err) {
      request.log.warn({ err }, 'readiness check failed: database');
      return reply.code(503).send({ status: 'not_ready', reason: 'database_unavailable' });
    }
  });

  // Internal diagnostics (not routed by the gateway): cache effectiveness counters.
  app.get('/status', () => ({ cache: deps.boardCache ? deps.boardCache.shared.stats : null }));

  const identity = new IdentityService(database.db);
  if (deps.devTokenIssuer) {
    void app.register(devLoginRoutes, { service: identity, issuer: deps.devTokenIssuer });
  }
  void app.register(identityRoutes, { service: identity, authProvider });
  void app.register(workspaceRoutes, { service: new WorkspaceService(database.db), authProvider });
  void app.register(projectRoutes, {
    service: new ProjectService(database.db, deps.boardCache),
    authProvider,
  });
  void app.register(taskRoutes, { service: new TaskService(database.db), authProvider });
  void app.register(activityRoutes, { service: new ActivityService(database.db), authProvider });
  if (deps.attachments) {
    void app.register(attachmentRoutes, { service: deps.attachments, authProvider });
  }

  return app;
}
