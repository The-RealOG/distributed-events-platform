import { outboxStatus, type DatabaseHandle } from '@dpp/database';
import {
  registerHttpMetrics,
  registerPoolMetrics,
  registerRequestContext,
  requestIdOptions,
  type Metrics,
} from '@dpp/observability';
import { closeConnectionsWhenDraining } from '@dpp/runtime';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { OutboxPublisher } from './publisher.js';

export const SERVICE_NAME = 'outbox-publisher';

/**
 * Probes for the worker. /ready means "can do useful work": the database answers and Kafka is
 * accepting publishes. It concerns only this process: the Project Service's readiness never
 * depends on it (the request path writes to the outbox and returns).
 */
export function buildApp(
  logger: FastifyBaseLogger,
  database: DatabaseHandle,
  publisher: OutboxPublisher,
  metrics?: Metrics,
): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    ...requestIdOptions(),
  });
  registerRequestContext(app);
  closeConnectionsWhenDraining(app);
  if (metrics) {
    registerHttpMetrics(app, metrics);
    registerPoolMetrics(metrics, database.pool);
  }

  app.get('/health', () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) =>
    publisher.ready ? { status: 'ready' } : reply.code(503).send({ status: 'not_ready' }),
  );
  // Operational view of the backlog (pending count, oldest pending age, failing rows).
  app.get('/status', async () => ({
    ready: publisher.ready,
    outbox: await outboxStatus(database.db),
  }));
  return app;
}
