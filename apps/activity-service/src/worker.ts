import { createIdempotentHandler, type ConsumerOutcome, type Database } from '@dpp/database';
import { consumerMetricHooks, DomainEventConsumer, TOPICS } from '@dpp/kafka';
import type { Metrics } from '@dpp/observability';
import type { Kafka } from 'kafkajs';
import type { Logger } from 'pino';
import { recordActivity } from './projection.js';

/**
 * The logical consumer name, shared by every replica and restart: the Kafka consumer group and
 * the processed_events identity (ADR-013). A constant, not configuration, so a deployment
 * cannot accidentally give replicas different identities.
 */
export const CONSUMER_NAME = 'activity-service';

export interface ActivityStats {
  processed: number;
  duplicate: number;
  failed: number;
  lastEventAt: string | null;
}

/**
 * Kafka → activity_events. Each event is applied through processEventOnce: the processed marker
 * and the activity row commit in one transaction, and only then is the offset committed.
 */
export function createActivityWorker(options: {
  kafka: Kafka;
  db: Database;
  logger: Logger;
  topics?: string[];
  metrics?: Metrics;
  /** Dead-letter topic override (tests); poison events go to domain.events.dlq by default. */
  deadLetterTopic?: string;
}) {
  const stats: ActivityStats = { processed: 0, duplicate: 0, failed: 0, lastEventAt: null };
  const outcomes = options.metrics?.counter({
    name: 'activity_events_total',
    help: 'Activity projection outcomes (processed = row written, duplicate = skipped)',
    labelNames: ['outcome'],
  });
  const count = (outcome: ConsumerOutcome) => {
    stats[outcome]++;
    outcomes?.inc({ outcome });
    if (outcome !== 'failed') stats.lastEventAt = new Date().toISOString();
  };
  const consumer = new DomainEventConsumer({
    kafka: options.kafka,
    logger: options.logger,
    groupId: CONSUMER_NAME,
    topics: options.topics ?? [TOPICS.domainEvents.name],
    // A new group starts at the beginning of the topic, so history published before the first
    // deployment (within Kafka retention) is projected too.
    fromBeginning: true,
    // Poison events (e.g. a row the projection can never insert) are retried a few times, then
    // dead-lettered; a database outage blocks the partition instead (ADR-019).
    deadLetter: options.deadLetterTopic ? { topic: options.deadLetterTopic } : {},
    ...(options.metrics ? { hooks: consumerMetricHooks(options.metrics, CONSUMER_NAME) } : {}),
    handler: createIdempotentHandler({
      db: options.db,
      consumerName: CONSUMER_NAME,
      logger: options.logger,
      handle: (event, tx) => recordActivity(tx, event),
      onOutcome: count,
    }),
  });
  return { consumer, stats };
}
