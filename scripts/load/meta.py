#!/usr/bin/env python3
"""Prints what a load run measured against: each long-running service's running/desired count,
task size and task-definition revision, plus project-service's cache flag. No other environment
values are printed (secrets are references, but the rule is: print only what is named here).
  scripts/load/meta.py <cluster> <service>...
"""
import json
import os
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


# Host CPU and Node version of the CPU-bound services: a 0.25 vCPU Fargate task runs on whichever
# CPU generation it lands on, which can change with every new task.
env = dict(os.environ, PATH=os.path.expanduser('~/.local/bin') + ':' + os.environ['PATH'])
for svc in ['project-service', 'api-gateway']:
    task = subprocess.check_output(['aws', 'ecs', 'list-tasks', '--cluster', cluster, '--service-name', svc,
                                    '--desired-status', 'RUNNING', '--query', 'taskArns[0]', '--output', 'text'], text=True).strip()
    out = subprocess.run(['aws', 'ecs', 'execute-command', '--cluster', cluster, '--task', task, '--container', svc, '--interactive',
                          '--command', "sh -c 'grep -m1 model.name /proc/cpuinfo; node -v'"],
                         stdin=subprocess.DEVNULL, capture_output=True, text=True, env=env).stdout
    model = next((l.split(':', 1)[1].strip() for l in out.splitlines() if l.startswith('model name')), 'unknown')
    node = next((l.strip() for l in out.splitlines() if l.strip().startswith('v2')), 'unknown')
    print('host %s: task %s, cpu "%s", node %s' % (svc, task.rsplit('/', 1)[-1][:12], model, node))
