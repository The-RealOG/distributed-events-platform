import type { DatabaseHandle } from '@dpp/database';
import type { DomainEventConsumer } from '@dpp/kafka';
import {
  registerHttpMetrics,
  registerPoolMetrics,
  registerRequestContext,
  requestIdOptions,
  type Metrics,
} from '@dpp/observability';
import { closeConnectionsWhenDraining } from '@dpp/runtime';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { ActivityStats } from './worker.js';

export const SERVICE_NAME = 'activity-service';

/**
 * Probes for the worker (no public routes: the activity API is served by the Project Service,
 * which owns project authorization; ADR-014). /ready = in the consumer group and the database
 * answers. Nothing else's readiness depends on this service.
 */
export function buildApp(
  logger: FastifyBaseLogger,
  database: DatabaseHandle,
  consumer: DomainEventConsumer,
  stats: ActivityStats,
  metrics?: Metrics,
): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    ...requestIdOptions(),
  }) as unknown as FastifyInstance;
  registerRequestContext(app);
  closeConnectionsWhenDraining(app);
  if (metrics) {
    registerHttpMetrics(app, metrics);
    registerPoolMetrics(metrics, database.pool);
  }

  app.get('/health', () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    const databaseOk = await database.ping().then(
      () => true,
      () => false,
    );
    return consumer.running && databaseOk
      ? { status: 'ready' }
      : reply
          .code(503)
          .send({ status: 'not_ready', consumer: consumer.running, database: databaseOk });
  });
  app.get('/status', () => ({
    consumer: consumer.running,
    assignment: consumer.assignment,
    stats,
  }));
  return app;
}
