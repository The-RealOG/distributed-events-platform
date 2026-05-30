import { boardCacheEntry, type SharedCache } from '@dpp/cache';
import type { DomainEvent, DomainEventType } from '@dpp/contracts';
import { DomainEventConsumer, TOPICS, type MessageMetadata } from '@dpp/kafka';
import type { Kafka } from 'kafkajs';
import type { Logger } from 'pino';

/** Logical consumer name and Kafka group, shared by all replicas (ADR-013/015). */
export const CONSUMER_NAME = 'cache-invalidator';

/**
 * Which events can change the cached board (project, board, columns, tasks, assignees).
 * comment.created cannot: the board representation carries no comments or comment counts.
 * An exhaustive map, so a new event type does not compile until someone decides.
 */
export const INVALIDATES_BOARD: Record<DomainEventType, boolean> = {
  'task.created': true,
  'task.updated': true,
  'task.moved': true,
  'task.deleted': true,
  'task.assigned': true,
  'task.unassigned': true,
  'comment.created': false,
};

export interface InvalidatorStats {
  invalidated: number;
  ignored: number;
  failed: number;
}

/**
 * Kafka → DEL board:{projectId}. No processed_events: invalidation is naturally idempotent
 * (deleting an absent key is a no-op, and a repeated generation bump only forces one extra miss),
 * so duplicate deliveries are harmless. A Redis failure throws, so the offset is not committed
 * and Kafka redelivers until the invalidation actually happened.
 */
export function createInvalidatorWorker(options: {
  kafka: Kafka;
  cache: SharedCache;
  logger: Logger;
  topics?: string[];
}) {
  const stats: InvalidatorStats = { invalidated: 0, ignored: 0, failed: 0 };
  const log = options.logger.child({ consumer: CONSUMER_NAME });

  const handler = async (event: DomainEvent, metadata: MessageMetadata) => {
    const where = {
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      projectId: event.payload.projectId,
      partition: metadata.partition,
      offset: metadata.offset,
    };
    if (!INVALIDATES_BOARD[event.eventType]) {
      stats.ignored++;
      return;
    }
    try {
      await options.cache.invalidate(boardCacheEntry(event.payload.projectId));
    } catch (err) {
      stats.failed++;
      log.warn(
        { ...where, err: err instanceof Error ? err.message : String(err) },
        'invalidation failed; will be redelivered',
      );
      throw err;
    }
    stats.invalidated++;
    log.debug(where, 'board cache invalidated');
  };

  const consumer = new DomainEventConsumer({
    kafka: options.kafka,
    logger: options.logger,
    groupId: CONSUMER_NAME,
    topics: options.topics ?? [TOPICS.domainEvents.name],
    // Replaying history is harmless (it only forces misses), while starting at "latest" would
    // be wrong: a partition with no committed offset yet (nothing consumed there before an
    // outage) would skip its whole backlog on restart, leaving stale entries until the TTL.
    fromBeginning: true,
    handler,
  });
  return { consumer, stats, handler };
}
