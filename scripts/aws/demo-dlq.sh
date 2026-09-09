#!/usr/bin/env bash
# Poison handling on MSK (ADR-019), from inside the VPC: inject one malformed message, then a
# valid event right behind it, and show that (a) the malformed one is dead-lettered with its
# source partition/offset, (b) the consumer moved past both (no lag), (c) nothing else went to
# the DLQ.   npm run aws:demo:dlq
source "$(dirname "$0")/lib.sh"
require_aws_auth
tools="node --disable-warning=TimeoutNegativeWarning dist/cli.js"
run_task kafka-tools sh -c "
  echo '--- DLQ before'; $tools dlq-list;
  echo '--- inject'; $tools produce-malformed --kind bad-payload && $tools produce-sample --type task.created;
  sleep 20;
  echo '--- DLQ after'; $tools dlq-list;
  echo '--- consumer groups'; $tools groups"
