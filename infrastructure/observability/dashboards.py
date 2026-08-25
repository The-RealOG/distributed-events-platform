"""Generates the Grafana dashboards (python3 infrastructure/observability/dashboards.py).
Every query uses histograms/counters correctly: percentiles come from histogram_quantile over
bucket rates, ratios are ratios of rates (never averages of averages)."""
import json, pathlib

def panel(i, title, exprs, unit='short', kind='timeseries', legend=None):
    return {
        'id': i, 'type': kind, 'title': title,
        'gridPos': {'x': (i - 1) % 2 * 12, 'y': (i - 1) // 2 * 8, 'w': 12, 'h': 8},
        'datasource': {'type': 'prometheus', 'uid': 'prometheus'},
        'fieldConfig': {'defaults': {'unit': unit}, 'overrides': []},
        'targets': [{'refId': chr(65 + n), 'expr': e, 'legendFormat': (legend or [None] * len(exprs))[n] or '__auto'} for n, e in enumerate(exprs)],
    }

DASHBOARDS = {
    'system-overview': ('System overview', [
        ('Request rate by service', ['sum by (service) (rate(http_requests_total[1m]))'], 'reqps'),
        ('Error rate (5xx share) by service', ['sum by (service) (rate(http_requests_total{status_class="5xx"}[5m])) / sum by (service) (rate(http_requests_total[5m]))'], 'percentunit'),
        ('p95 latency by service', ['histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))'], 's'),
        ('p95 latency by route (project-service)', ['histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{service="project-service"}[5m])))'], 's'),
        ('Database pool', ['sum by (service, state) (db_pool_connections)', 'sum by (service) (db_pool_waiting_requests)'], 'short'),
        ('Process memory (RSS)', ['sum by (service) (process_resident_memory_bytes)'], 'bytes'),
    ]),
    'event-pipeline': ('Event pipeline', [
        ('Outbox backlog (pending events)', ['max(outbox_pending_events)'], 'short'),
        ('Oldest pending event age', ['max(outbox_oldest_pending_age_seconds)'], 's'),
        ('Outbox publish rate and failures', ['sum(rate(outbox_published_total[5m]))', 'sum by (kind) (rate(outbox_publish_failures_total[5m]))'], 'ops'),
        ('p95 commit → Kafka ack', ['histogram_quantile(0.95, sum by (le) (rate(outbox_publish_latency_seconds_bucket[5m])))'], 's'),
        ('Consumer throughput by result', ['sum by (consumer, result) (rate(kafka_consumer_messages_total[5m]))'], 'ops'),
        ('p95 event processing by consumer', ['histogram_quantile(0.95, sum by (le, consumer) (rate(kafka_consumer_processing_seconds_bucket[5m])))'], 's'),
        ('Consumer retries by kind', ['sum by (consumer, kind) (rate(kafka_consumer_retries_total[5m]))'], 'ops'),
        ('Dead-lettered (last hour) and DLQ write failures', ['sum by (consumer, category) (increase(kafka_consumer_dead_letters_total[1h]))', 'sum by (consumer) (increase(kafka_consumer_dead_letter_failures_total[1h]))'], 'short'),
        ('Activity outcomes (processed vs duplicate)', ['sum by (outcome) (rate(activity_events_total[5m]))'], 'ops'),
        ('Stale outbox claims recovered', ['sum(increase(outbox_stale_claims_recovered_total[1h]))'], 'short'),
    ]),
    'cache': ('Board cache', [
        ('Hit rate', ['sum(rate(cache_operations_total{result="hit"}[5m])) / sum(rate(cache_operations_total{result=~"hit|miss"}[5m]))'], 'percentunit'),
        ('Operations by result', ['sum by (result) (rate(cache_operations_total[5m]))'], 'ops'),
        ('Errors (reads served from PostgreSQL)', ['sum(rate(cache_operations_total{result="error"}[5m]))'], 'ops'),
        ('Invalidations and stale write-backs refused', ['sum(rate(cache_operations_total{result="invalidation"}[5m]))', 'sum(rate(cache_operations_total{result="stale_write_skipped"}[5m]))'], 'ops'),
        ('p95 board read latency', ['histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{route="/projects/:id/board"}[5m])))'], 's'),
    ]),
    'realtime': ('Realtime', [
        ('Open WebSocket connections', ['sum(realtime_connections)'], 'short'),
        ('Projects with subscribers', ['sum(realtime_rooms)'], 'short'),
        ('Notifications sent', ['sum(rate(realtime_hub_events_total{result="broadcast"}[5m]))'], 'ops'),
        ('Disconnects: slow clients and missed heartbeats', ['sum by (result) (rate(realtime_hub_events_total{result=~"slow_client_disconnect|heartbeat_termination|send_failure"}[5m]))'], 'ops'),
        ('Connections opened / closed', ['sum(rate(realtime_connections_opened_total[5m]))', 'sum(rate(realtime_connections_closed_total[5m]))'], 'ops'),
        ('Refused: authentication and subscriptions', ['sum by (reason) (rate(realtime_auth_failures_total[5m]))', 'sum by (reason) (rate(realtime_subscriptions_denied_total[5m]))'], 'ops'),
    ]),
}

out = pathlib.Path(__file__).parent / 'grafana' / 'dashboards'
for uid, (title, panels) in DASHBOARDS.items():
    doc = {
        'uid': f'dpp-{uid}', 'title': title, 'schemaVersion': 39, 'version': 1, 'editable': True,
        'time': {'from': 'now-1h', 'to': 'now'}, 'refresh': '10s', 'tags': ['dpp'],
        'panels': [panel(i + 1, t, e, u) for i, (t, e, u) in enumerate(panels)],
    }
    (out / f'{uid}.json').write_text(json.dumps(doc, indent=2) + '\n')
print('wrote', len(DASHBOARDS), 'dashboards')
