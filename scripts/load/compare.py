#!/usr/bin/env python3
"""Compares repeated ladder runs, grouped by configuration, from their raw evidence.
  scripts/load/compare.py <out.md> "<title>" ON=tests/load/results/a,tests/load/results/b ...

Per group and ladder level it reports the MEDIAN across runs and the min–max range of:
  req/s and successful writes/s (count / step seconds), error rate, and k6's p50/p95/p99 of each
  run. Percentiles are per run (k6's own over that run's level samples); the table shows the
  median of the per-run values, labelled as such, never a pooled or averaged percentile.
Infrastructure per level comes from CloudWatch, sliced to the level's own minutes using the
MEASURE_T0 marker k6 prints after setup (stdout.txt) and the LADDER/STEP/WARMUP in meta.txt:
the per-minute maximum CPU of project-service and api-gateway and of RDS, over full minutes inside
the level. Database commits/s (pg_stat_database) are per run, setup included, so they are shown for
the whole run only. Fetched series are cached in <run>/levels.json.
"""
import json
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime, timedelta, timezone

out_path, title, *groups = sys.argv[1:]


def parse_env(meta):
    m = re.search(r'^k6_env=(.*)$', meta, re.M)
    return dict(kv.split('=', 1) for kv in (m.group(1).split() if m else []) if '=' in kv)


def seconds(d):
    m = re.fullmatch(r'(\d+)(s|m)', d)
    return int(m.group(1)) * (60 if m.group(2) == 'm' else 1)


def cw(ns, metric, dims, start, end):
    out = json.loads(subprocess.check_output([
        'aws', 'cloudwatch', 'get-metric-statistics', '--namespace', ns, '--metric-name', metric,
        '--dimensions', *[f'Name={k},Value={v}' for k, v in dims.items()],
        '--start-time', start.isoformat(), '--end-time', end.isoformat(), '--period', '60',
        '--statistics', 'Maximum', '--output', 'json']))
    return [p['Maximum'] for p in out['Datapoints']]


def run_levels(d):
    meta = open(os.path.join(d, 'meta.txt')).read()
    env = parse_env(meta)
    ladder = [int(v) for v in env['LADDER'].split(',')]
    step = seconds(env.get('STEP', '3m'))
    warm = seconds(env['WARMUP']) + 5 if env.get('WARMUP') else 0
    summary = json.load(open(os.path.join(d, 'summary.json')))['metrics']
    t0m = re.search(r'MEASURE_T0=(\S+?)"?(\s|$)', open(os.path.join(d, 'stdout.txt')).read())
    cache = os.path.join(d, 'levels.json')
    infra = json.load(open(cache)) if os.path.exists(cache) else {}
    rows = {}
    for i, vus in enumerate(ladder):
        v = lambda name: summary.get(name, {}).get('values', {})
        dur = v(f'http_req_duration{{level:{vus}}}')
        hits = v(f'board_cache{{level:{vus},result:hit}}').get('count', 0)
        misses = v(f'board_cache{{level:{vus},result:miss}}').get('count', 0)
        row = {
            'req/s': v(f'http_reqs{{level:{vus}}}').get('count', 0) / step,
            'writes/s': v(f'writes_ok{{level:{vus}}}').get('count', 0) / step,
            'errors %': 100 * v(f'http_req_failed{{level:{vus}}}').get('rate', 0),
            'p50 ms': dur.get('med'), 'p95 ms': dur.get('p(95)'), 'p99 ms': dur.get('p(99)'),
            'board p95 ms': v(f'http_req_duration{{level:{vus},op:board}}').get('p(95)'),
            '409s': v(f'version_conflicts{{level:{vus}}}').get('count', 0),
            'hit %': 100 * hits / (hits + misses) if hits + misses else None,
        }
        if t0m and str(vus) not in infra:
            t0 = datetime.fromisoformat(t0m.group(1).replace('Z', '+00:00'))
            start = t0 + timedelta(seconds=warm + i * (step + 5))
            # Full minutes inside the level only (CloudWatch periods are aligned to the start time).
            first = (start + timedelta(seconds=59)).replace(second=0, microsecond=0)
            last = (start + timedelta(seconds=step)).replace(second=0, microsecond=0)
            cfg = json.loads(subprocess.check_output(['aws', 'ssm', 'get-parameter', '--name', '/dpp-dev/deploy-config', '--query', 'Parameter.Value', '--output', 'text']))
            got = {}
            for svc in ['project-service', 'api-gateway']:
                pts = cw('AWS/ECS', 'CPUUtilization', {'ClusterName': cfg['cluster'], 'ServiceName': svc}, first, last)
                got[f'{svc} CPU %'] = max(pts) if pts else None
            pts = cw('AWS/RDS', 'CPUUtilization', {'DBInstanceIdentifier': cfg['rds']['identifier']}, first, last)
            got['RDS CPU %'] = max(pts) if pts else None
            infra[str(vus)] = got
        row.update(infra.get(str(vus), {}))
        rows[vus] = row
    json.dump(infra, open(cache, 'w'), indent=1)
    pg = None
    b, a = (os.path.join(d, s, 'pgstats.json') for s in ('before', 'after'))
    if os.path.exists(b) and os.path.exists(a):
        b, a = json.load(open(b)), json.load(open(a))
        secs = (datetime.fromisoformat(a['at'].replace('Z', '+00:00')) - datetime.fromisoformat(b['at'].replace('Z', '+00:00'))).total_seconds()
        pg = {'commits/s': (a['xact_commit'] - b['xact_commit']) / secs,
              'tuples returned/s': (a['tup_returned'] - b['tup_returned']) / secs}
    loc = ''
    rt = os.path.join(d, 'runner.txt')
    if os.path.exists(rt):
        m = re.search(r'^location: (.*)$', open(rt).read(), re.M)
        loc = m.group(1) if m else 'not recorded'
    sha = re.search(r'^deployed_sha=(\S+)', meta, re.M)
    return rows, pg, loc, sha.group(1)[:7] if sha else '?'


def fmt(vals):
    vals = [x for x in vals if x is not None]
    if not vals:
        return '–'
    med = statistics.median(vals)
    p = lambda x: f'{x:.0f}' if abs(x) >= 10 else f'{x:.2f}' if abs(x) < 1 else f'{x:.1f}'
    return p(med) if len(vals) == 1 else f'{p(med)} ({p(min(vals))}–{p(max(vals))})'


lines = [f'# {title}', '', 'Cells: median across runs (min–max). Latency columns are the median of each run\'s own k6 '
         'percentile, not a pooled percentile. CPU: per-minute maximum over the level\'s full minutes.', '']
metrics = ['req/s', 'writes/s', 'errors %', 'p50 ms', 'p95 ms', 'p99 ms', 'board p95 ms', 'hit %', '409s',
           'project-service CPU %', 'api-gateway CPU %', 'RDS CPU %']
for g in groups:
    name, dirs = g.split('=', 1)
    runs = [(d, *run_levels(d)) for d in dirs.split(',')]
    lines += [f'## {name} ({len(runs)} runs)', '']
    for d, _, pg, loc, sha in runs:
        pgs = f"; DB {pg['commits/s']:.0f} commits/s, {pg['tuples returned/s']:.0f} tuples returned/s (whole run incl. setup)" if pg else ''
        lines.append(f'- `{d}`: deployed {sha}; runner {loc}{pgs}')
    lines += ['', '| VUs | ' + ' | '.join(metrics) + ' |', '|' + '---|' * (len(metrics) + 1)]
    for vus in sorted({v for _, rows, *_ in runs for v in rows}):
        lines.append(f'| {vus} | ' + ' | '.join(fmt([rows.get(vus, {}).get(m) for _, rows, *_ in runs]) for m in metrics) + ' |')
    lines.append('')
open(out_path, 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
