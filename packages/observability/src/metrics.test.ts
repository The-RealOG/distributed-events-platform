import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  assertLowCardinality,
  Metrics,
  registerHttpMetrics,
  registerPoolMetrics,
} from './metrics.js';

describe('metrics', () => {
  it('counts requests by route template and status class, and observes a duration histogram', async () => {
    const metrics = new Metrics('test-service');
    const app = Fastify();
    registerHttpMetrics(app, metrics);
    app.get('/projects/:id/board', async () => ({ ok: true }));
    app.get('/health', async () => ({ ok: true }));
    await app.inject({
      method: 'GET',
      url: '/projects/11111111-1111-1111-1111-111111111111/board',
    });
    await app.inject({
      method: 'GET',
      url: '/projects/22222222-2222-2222-2222-222222222222/board',
    });
    await app.inject({ method: 'GET', url: '/nope' });
    await app.inject({ method: 'GET', url: '/health' });

    const text = (await app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(text).toContain(
      'http_requests_total{method="GET",route="/projects/:id/board",status_class="2xx",service="test-service"} 2',
    );
    expect(text).toContain('route="unmatched",status_class="4xx"');
    expect(text).toContain(
      'http_request_duration_seconds_count{service="test-service",method="GET",route="/projects/:id/board",status_class="2xx"} 2',
    );
    // No concrete IDs in any series, and probes are not counted.
    expect(text).not.toContain('11111111');
    expect(text).not.toContain('route="/health"');
    await app.close();
  });

  it('refuses high-cardinality label names', () => {
    for (const label of [
      'projectId',
      'project_id',
      'userId',
      'eventId',
      'requestId',
      'url',
      'correlationId',
    ]) {
      expect(() => assertLowCardinality('m', [label]), label).toThrow('high-cardinality');
    }
    expect(() =>
      assertLowCardinality('m', ['route', 'status_class', 'consumer', 'reason']),
    ).not.toThrow();
  });

  it('reports pool gauges at scrape time', async () => {
    const metrics = new Metrics('pool-test');
    const pool = { totalCount: 5, idleCount: 2, waitingCount: 1 };
    registerPoolMetrics(metrics, pool);
    const text = await metrics.text();
    expect(text).toContain('db_pool_connections{state="active",service="pool-test"} 3');
    expect(text).toContain('db_pool_waiting_requests{service="pool-test"} 1');
  });
});
