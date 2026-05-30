import type { DomainEventConsumer } from '@dpp/kafka';
import { registerRequestContext, requestIdOptions } from '@dpp/observability';
import { closeConnectionsWhenDraining } from '@dpp/runtime';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { InvalidatorStats } from './worker.js';

export const SERVICE_NAME = 'cache-invalidator';

/** Probes. /ready = in the consumer group and Redis answers. */
export function buildApp(
  logger: FastifyBaseLogger,
  redis: Redis,
  consumer: DomainEventConsumer,
  stats: InvalidatorStats,
): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    ...requestIdOptions(),
  }) as unknown as FastifyInstance;
  registerRequestContext(app);
  closeConnectionsWhenDraining(app);

  app.get('/health', () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    const redisOk = await redis.ping().then(
      () => true,
      () => false,
    );
    return consumer.running && redisOk
      ? { status: 'ready' }
      : reply.code(503).send({ status: 'not_ready', consumer: consumer.running, redis: redisOk });
  });
  app.get('/status', () => ({
    consumer: consumer.running,
    assignment: consumer.assignment,
    stats,
  }));
  return app;
}
