import { outboxStatus, type DbExecutor } from '@dpp/database';
import { LATENCY_BUCKETS, type Metrics } from '@dpp/observability';
import type { PublisherObserver } from './publisher.js';

/**
 * Outbox metrics (ADR-020). The backlog gauges are read from PostgreSQL at scrape time, so they
 * describe the whole outbox (all publisher replicas), not this process's view.
 */
export function registerOutboxMetrics(metrics: Metrics, db: DbExecutor): PublisherObserver {
  metrics.gauge({
    name: 'outbox_pending_events',
    help: 'Committed events not yet acknowledged by Kafka',
    async collect() {
      this.set((await outboxStatus(db)).pending);
    },
  });
  metrics.gauge({
    name: 'outbox_oldest_pending_age_seconds',
    help: 'Age of the oldest unpublished event (0 when none)',
    async collect() {
      this.set((await outboxStatus(db)).oldestPendingAgeSeconds ?? 0);
    },
  });
  const published = metrics.counter({
    name: 'outbox_published_total',
    help: 'Events acknowledged by Kafka',
  });
  const failures = metrics.counter({
    name: 'outbox_publish_failures_total',
    help: 'Failed publish attempts (retried later with backoff)',
    labelNames: ['kind'],
  });
  const retried = metrics.counter({
    name: 'outbox_published_after_retry_total',
    help: 'Events that needed more than one attempt',
  });
  const stale = metrics.counter({
    name: 'outbox_stale_claims_recovered_total',
    help: 'Rows reclaimed after another worker’s lease expired',
  });
  const latency = metrics.histogram({
    name: 'outbox_publish_latency_seconds',
    help: 'Commit (outbox insert) to Kafka acknowledgement',
    buckets: [...LATENCY_BUCKETS, 30, 60, 300],
  });
  return {
    published(latencyMs, attempts) {
      published.inc();
      latency.observe(latencyMs / 1000);
      if (attempts > 1) retried.inc();
    },
    failed: (kind) => failures.inc({ kind }),
    staleClaimRecovered: () => stale.inc(),
  };
}
