import type { FastifyInstance } from 'fastify';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
} from 'prom-client';

/**
 * Prometheus metrics (ADR-020). One registry per process, labelled with `service` by default.
 *
 * Cardinality policy: labels are small closed sets (method, route TEMPLATE, status class,
 * outcome, reason, consumer, event type). Never user, project, task, request or event IDs:
 * each distinct label value is a separate time series kept in memory by every Prometheus that
 * scrapes it. `assertLowCardinality` enforces the name part of this at registration time.
 */
export class Metrics {
  readonly registry = new Registry();

  constructor(readonly service: string) {
    this.registry.setDefaultLabels({ service });
    collectDefaultMetrics({ register: this.registry });
  }

  counter<L extends string>(config: Omit<CounterConfiguration<L>, 'registers'>): Counter<L> {
    assertLowCardinality(config.name, config.labelNames);
    return new Counter<L>({ ...config, registers: [this.registry] });
  }

  gauge<L extends string>(config: Omit<GaugeConfiguration<L>, 'registers'>): Gauge<L> {
    assertLowCardinality(config.name, config.labelNames);
    return new Gauge<L>({ ...config, registers: [this.registry] });
  }

  histogram<L extends string>(config: Omit<HistogramConfiguration<L>, 'registers'>): Histogram<L> {
    assertLowCardinality(config.name, config.labelNames);
    return new Histogram<L>({ ...config, registers: [this.registry] });
  }

  text(): Promise<string> {
    return this.registry.metrics();
  }
}

/** Label names that would identify individual entities: forbidden. */
const FORBIDDEN_LABELS =
  /(^|_)(user|project|task|workspace|request|event|correlation|comment|attachment)_?id$|^(url|path|key|email)$/i;

export function assertLowCardinality(name: string, labelNames: readonly string[] = []): void {
  for (const label of labelNames) {
    if (FORBIDDEN_LABELS.test(label)) {
      throw new Error(`metric ${name}: label "${label}" is high-cardinality (see ADR-020)`);
    }
  }
}

/** Latency buckets in seconds: 5 ms … 10 s. */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * HTTP metrics for a Fastify app plus GET /metrics. The route label is the route TEMPLATE
 * (`/projects/:id/board`), never the concrete URL; unmatched requests are "unmatched".
 * /metrics, /health and /ready are not counted.
 */
export function registerHttpMetrics(app: FastifyInstance, metrics: Metrics): void {
  const requests = metrics.counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled',
    labelNames: ['method', 'route', 'status_class'],
  });
  const duration = metrics.histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status_class'],
    buckets: LATENCY_BUCKETS,
  });
  const skip = new Set(['/metrics', '/health', '/ready']);

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    if (skip.has(route)) return;
    const labels = {
      method: request.method,
      route,
      status_class: `${Math.floor(reply.statusCode / 100)}xx`,
    };
    requests.inc(labels);
    duration.observe(labels, reply.elapsedTime / 1000);
  });

  // Internal: not routed by the gateway, and the ALB only reaches the gateway via CloudFront's
  // /api/* behaviour, so no /metrics endpoint is reachable from the internet.
  app.get('/metrics', async (_request, reply) => {
    void reply.header('content-type', metrics.registry.contentType);
    return metrics.text();
  });
}

/** Connection-pool gauges (pg.Pool exposes these counts directly). */
export function registerPoolMetrics(
  metrics: Metrics,
  pool: { totalCount: number; idleCount: number; waitingCount: number },
): void {
  metrics.gauge({
    name: 'db_pool_connections',
    help: 'Database pool connections by state',
    labelNames: ['state'],
    collect() {
      this.set({ state: 'total' }, pool.totalCount);
      this.set({ state: 'idle' }, pool.idleCount);
      this.set({ state: 'active' }, pool.totalCount - pool.idleCount);
    },
  });
  metrics.gauge({
    name: 'db_pool_waiting_requests',
    help: 'Requests waiting for a database connection',
    collect() {
      this.set(pool.waitingCount);
    },
  });
}
