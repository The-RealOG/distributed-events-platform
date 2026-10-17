#!/usr/bin/env python3
"""Summarizes one load run from its raw evidence:
  <dir>/before/*.prom, <dir>/after/*.prom   Prometheus expositions from every service
  <dir>/summary.json, stdout.txt            k6 output (downloaded artifact)
  <dir>/window.txt                          ISO start/end of the k6 run
and fetches CloudWatch for that window (ECS CPU/memory per service, RDS, ElastiCache).
Writes <dir>/report.md and <dir>/cloudwatch.json.   scripts/load/report.py <dir>

Counters are deltas (after − before); they include the run's setup/seed traffic. Gauges are
the value at the 'after' snapshot. Hit rate = hits / (hits + misses); errors excluded.
"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

d = sys.argv[1]
LINE = re.compile(r'^([a-zA-Z_:][\w:]*)(\{([^}]*)\})?\s+([-+eE\d.]+|NaN)$')


def load(side):
    out = {}
    folder = os.path.join(d, side)
    for f in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not f.endswith('.prom'):
            continue
        svc = f[:-5]
        for line in open(os.path.join(folder, f)):
            m = LINE.match(line.strip())
            if not m:
                continue
            labels = dict(re.findall(r'(\w+)="([^"]*)"', m.group(3) or ''))
            labels.pop('service', None)
            key = (svc, m.group(1), tuple(sorted(labels.items())))
            out[key] = float(m.group(4))
    return out


before, after = load('before'), load('after')


def delta(svc, name, **match):
    total = 0.0
    for (s, n, labels), v in after.items():
        if s != svc or n != name or any(dict(labels).get(k) != val for k, val in match.items()):
            continue
        total += v - before.get((s, n, labels), 0.0)
    return total


def gauge(svc, name, **match):
    vals = [v for (s, n, l), v in after.items() if s == svc and n == name and all(dict(l).get(k) == val for k, val in match.items())]
    return sum(vals) if vals else None


def by_label(svc, name, label):
    acc = defaultdict(float)
    for (s, n, labels), v in after.items():
        if s == svc and n == name:
            acc[dict(labels).get(label, '')] += v - before.get((s, n, labels), 0.0)
    return dict(acc)


lines = [f"# Load run `{os.path.basename(d.rstrip('/'))}`", '']
if os.path.exists(os.path.join(d, 'stdout.txt')):
    k6 = open(os.path.join(d, 'stdout.txt')).read()
    lines += ['## k6 (load generator view)', '', '```', k6.strip()[-6000:], '```', '']

lines += ['## Service metrics (deltas over the run)', '']
hits = delta('project-service', 'cache_operations_total', result='hit')
misses = delta('project-service', 'cache_operations_total', result='miss')
errors = delta('project-service', 'cache_operations_total', result='error')
if hits + misses:
    lines.append(f"- Board cache (server): hits {hits:.0f}, misses {misses:.0f}, errors {errors:.0f} → hit rate **{100 * hits / (hits + misses):.1f} %**")
http_ps = by_label('project-service', 'http_requests_total', 'status_class')
lines.append(f"- project-service HTTP responses by class: {', '.join(f'{k} {v:.0f}' for k, v in sorted(http_ps.items()))}")
pub = delta('outbox-publisher', 'outbox_published_total')
lines.append(f"- Outbox: published {pub:.0f}; failures {sum(by_label('outbox-publisher', 'outbox_publish_failures_total', 'kind').values()):.0f}; "
             f"pending after {gauge('outbox-publisher', 'outbox_pending_events')}; oldest pending age after {gauge('outbox-publisher', 'outbox_oldest_pending_age_seconds')} s")
for svc in ['activity-service', 'cache-invalidator', 'realtime-service']:
    res = by_label(svc, 'kafka_consumer_messages_total', 'result')
    if res:
        lines.append(f"- {svc} consumer messages: {', '.join(f'{k} {v:.0f}' for k, v in sorted(res.items()))}; "
                     f"retries {sum(by_label(svc, 'kafka_consumer_retries_total', 'kind').values()):.0f}; "
                     f"dead-lettered {sum(by_label(svc, 'kafka_consumer_dead_letters_total', 'category').values()):.0f}")
act = by_label('activity-service', 'activity_events_total', 'outcome')
if act:
    lines.append(f"- activity outcomes: {', '.join(f'{k} {v:.0f}' for k, v in sorted(act.items()))}")
hub = by_label('realtime-service', 'realtime_hub_events_total', 'result')
if hub:
    lines.append(f"- realtime hub: {', '.join(f'{k} {v:.0f}' for k, v in sorted(hub.items()))}; connections now {gauge('realtime-service', 'realtime_connections')}")
for svc in ['project-service', 'outbox-publisher', 'activity-service', 'realtime-service']:
    waiting = gauge(svc, 'db_pool_waiting_requests')
    if waiting is not None:
        lines.append(f"- {svc} DB pool at end: {', '.join(f'{st} {gauge(svc, 'db_pool_connections', state=st):.0f}' for st in ['total', 'idle'] if gauge(svc, 'db_pool_connections', state=st) is not None)}; waiting {waiting:.0f}")
pgb, pga = (os.path.join(d, side, 'pgstats.json') for side in ('before', 'after'))
if os.path.exists(pgb) and os.path.exists(pga):
    b, a = json.load(open(pgb)), json.load(open(pga))
    secs = (datetime.fromisoformat(a['at'].replace('Z', '+00:00')) - datetime.fromisoformat(b['at'].replace('Z', '+00:00'))).total_seconds()
    dd = {k: a[k] - b[k] for k in a if k not in ('at', 'numbackends')}
    lines.append(f"- PostgreSQL (pg_stat_database, includes setup/seed): {dd['xact_commit']:.0f} commits "
                 f"({dd['xact_commit'] / secs:.1f}/s over {secs:.0f} s between snapshots), rollbacks {dd['xact_rollback']:.0f}; "
                 f"tuples returned {dd['tup_returned']:.0f}, fetched {dd['tup_fetched']:.0f}, inserted {dd['tup_inserted']:.0f}, "
                 f"updated {dd['tup_updated']:.0f}, deleted {dd['tup_deleted']:.0f}; blocks read {dd['blks_read']:.0f}, hit {dd['blks_hit']:.0f}")
for svc in ['project-service', 'api-gateway', 'realtime-service']:
    rss = gauge(svc, 'process_resident_memory_bytes')
    heap = gauge(svc, 'nodejs_heap_size_used_bytes')
    if rss:
        lines.append(f"- {svc} memory at end: RSS {rss / 2**20:.0f} MiB, heap used {(heap or 0) / 2**20:.0f} MiB")

# ---- CloudWatch for the run window
window = os.path.join(d, 'window.txt')
if os.path.exists(window):
    start_s, end_s = open(window).read().split()
    start = datetime.fromisoformat(start_s.replace('Z', '+00:00')) - timedelta(minutes=1)
    end = datetime.fromisoformat(end_s.replace('Z', '+00:00')) + timedelta(minutes=1)
    cfg = json.loads(subprocess.check_output(['aws', 'ssm', 'get-parameter', '--name', '/dpp-dev/deploy-config', '--query', 'Parameter.Value', '--output', 'text']))

    def cw(ns, metric, dims, stat='Average'):
        out = json.loads(subprocess.check_output([
            'aws', 'cloudwatch', 'get-metric-statistics', '--namespace', ns, '--metric-name', metric,
            '--dimensions', *[f'Name={k},Value={v}' for k, v in dims.items()],
            '--start-time', start.isoformat(), '--end-time', end.isoformat(), '--period', '60',
            '--statistics', stat, '--output', 'json']))
        pts = sorted(out['Datapoints'], key=lambda p: p['Timestamp'])
        return [round(p[stat], 2) for p in pts]

    series = {}
    for svc in cfg['services']:
        for m in ['CPUUtilization', 'MemoryUtilization']:
            series[f'ecs/{svc}/{m}'] = cw('AWS/ECS', m, {'ClusterName': cfg['cluster'], 'ServiceName': svc}, 'Maximum')
    rds = cfg['rds']['identifier']
    for m in ['CPUUtilization', 'DatabaseConnections', 'ReadIOPS', 'WriteIOPS']:
        series[f'rds/{m}'] = cw('AWS/RDS', m, {'DBInstanceIdentifier': rds}, 'Maximum')
    try:
        clusters = json.loads(subprocess.check_output(['aws', 'elasticache', 'describe-cache-clusters', '--output', 'json']))['CacheClusters']
        for c in clusters:
            if c['CacheClusterId'].startswith('dpp-dev'):
                for m in ['EngineCPUUtilization', 'CurrConnections']:
                    series[f"redis/{c['CacheClusterId']}/{m}"] = cw('AWS/ElastiCache', m, {'CacheClusterId': c['CacheClusterId']}, 'Maximum')
    except subprocess.CalledProcessError:
        pass
    json.dump(series, open(os.path.join(d, 'cloudwatch.json'), 'w'), indent=1)
    lines += ['', '## CloudWatch (per-minute maxima over the window)', '', '| series | max | per-minute values |', '|---|---|---|']
    for k, v in series.items():
        if v:
            lines.append(f"| {k} | {max(v)} | {' '.join(str(x) for x in v)} |")

open(os.path.join(d, 'report.md'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
