import { toRealtimeEnvelope } from '@dpp/contracts';
import { consumerMetricHooks, DomainEventConsumer, TOPICS } from '@dpp/kafka';
import type { Metrics } from '@dpp/observability';
import type { Kafka } from 'kafkajs';
import type { Logger } from 'pino';
import type { Hub } from './hub.js';

export const CONSUMER_NAME = 'realtime-service';

/**
 * Kafka → local WebSocket rooms (ADR-017). Each replica has its OWN consumer group
 * (`realtime-service.<instance>`) so every replica sees every event: WebSocket connections are
 * local to a replica, and a shared group would give each event to only one of them.
 * It starts at the latest offset: a (re)connecting client refetches first, so history is not
 * needed. Broadcasting never fails the message (it is best effort by design), so there is no
 * retry or DLQ here; malformed messages are logged and counted.
 */
export function createRealtimeWorker(options: {
  kafka: Kafka;
  hub: Hub;
  logger: Logger;
  instanceId: string;
  topics?: string[];
  metrics?: Metrics;
}) {
  const log = options.logger.child({ consumer: CONSUMER_NAME });
  return new DomainEventConsumer({
    kafka: options.kafka,
    logger: options.logger,
    groupId: `${CONSUMER_NAME}.${options.instanceId}`,
    topics: options.topics ?? [TOPICS.domainEvents.name],
    fromBeginning: false,
    ...(options.metrics ? { hooks: consumerMetricHooks(options.metrics, CONSUMER_NAME) } : {}),
    handler: async (event, metadata) => {
      const envelope = toRealtimeEnvelope(event);
      const recipients = options.hub.broadcast(envelope);
      log.info(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          correlationId: event.correlationId,
          projectId: envelope.projectId,
          partition: metadata.partition,
          offset: metadata.offset,
          recipients,
        },
        'realtime notification broadcast',
      );
    },
  });
}
