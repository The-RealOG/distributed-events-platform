#!/usr/bin/env bash
# Creates/verifies domain.events (3 partitions) and domain.events.dlq (1) on MSK, replication 2.
# Idempotent; refuses to "fix" a partition-count mismatch.   npm run aws:kafka:init
source "$(dirname "$0")/lib.sh"
require_aws_auth
run_task kafka-tools
