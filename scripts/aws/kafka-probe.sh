#!/usr/bin/env bash
# Produces a valid event to MSK and consumes it back from inside the VPC (MSK is private), then
# verifies schema, eventId and correlationId.   npm run aws:kafka:probe
source "$(dirname "$0")/lib.sh"
require_aws_auth
run_task kafka-tools node --disable-warning=TimeoutNegativeWarning dist/cli.js probe
