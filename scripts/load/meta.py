#!/usr/bin/env python3
"""Prints what a load run measured against: each long-running service's running/desired count,
task size and task-definition revision, plus project-service's cache flag. No other environment
values are printed (secrets are references, but the rule is: print only what is named here).
  scripts/load/meta.py <cluster> <service>...
"""
import json
import subprocess
import sys


def aws(*args):
    return json.loads(subprocess.check_output(['aws', *args, '--output', 'json']))


cluster, services = sys.argv[1], sys.argv[2:]
for s in aws('ecs', 'describe-services', '--cluster', cluster, '--services', *services)['services']:
    td = aws('ecs', 'describe-task-definition', '--task-definition', s['taskDefinition'])['taskDefinition']
    env = {e['name']: e['value'] for c in td['containerDefinitions'] for e in c.get('environment', [])}
    extra = ' CACHE_ENABLED=' + env.get('CACHE_ENABLED', 'unset') if s['serviceName'] == 'project-service' else ''
    print('service %s: running %d/%d, %s CPU units, %s MiB, %s:%d%s' % (
        s['serviceName'], s['runningCount'], s['desiredCount'], td['cpu'], td['memory'], td['family'], td['revision'], extra))
