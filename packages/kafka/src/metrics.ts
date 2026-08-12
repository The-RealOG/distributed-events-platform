import type { Metrics } from '@dpp/observability';
import { LATENCY_BUCKETS } from '@dpp/observability';
import type { ConsumerHooks } from './consumer.js';

/**
 * Prometheus hooks for a DomainEventConsumer (ADR-020). `consumer` is the LOGICAL consumer name
 * (activity-service, …), never a per-replica group id, so the label stays low-cardinality.
 */
export function consumerMetricHooks(metrics: Metrics, consumer: string): Required<ConsumerHooks> {
  const events = metrics.counter({
    name: 'kafka_consumer_messages_total',
    help: 'Messages handled by a consumer, by result',
    labelNames: ['consumer', 'result'],
  });
  const duration = metrics.histogram({
    name: 'kafka_consumer_processing_seconds',
    help: 'Time to process one event (successful attempts)',
    labelNames: ['consumer'],
    buckets: LATENCY_BUCKETS,
  });
  const retries = metrics.counter({
    name: 'kafka_consumer_retries_total',
    help: 'In-process retries of failed events, by failure kind',
    labelNames: ['consumer', 'kind'],
  });
  const deadLetters = metrics.counter({
    name: 'kafka_consumer_dead_letters_total',
    help: 'Messages written to the DLQ, by category',
    labelNames: ['consumer', 'category'],
  });
  const dlqFailures = metrics.counter({
    name: 'kafka_consumer_dead_letter_failures_total',
    help: 'DLQ writes that failed (message left unacknowledged)',
    labelNames: ['consumer'],
  });
  return {
    onProcessed: (_event, _metadata, durationMs) => {
      events.inc({ consumer, result: 'processed' });
      duration.observe({ consumer }, durationMs / 1000);
    },
    onInvalidMessage: () => events.inc({ consumer, result: 'malformed' }),
    onRetry: (kind) => retries.inc({ consumer, kind }),
    onDeadLetter: (category) => {
      deadLetters.inc({ consumer, category });
      events.inc({ consumer, result: 'dead_lettered' });
    },
    onDeadLetterFailure: () => dlqFailures.inc({ consumer }),
  };
}
