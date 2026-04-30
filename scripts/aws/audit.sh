#!/usr/bin/env bash
# Read-only audit of live AWS state + JSON inventory.   npm run aws:audit [-- --out file.json]
source "$(dirname "$0")/lib.sh"
require_aws_auth
exec python3 "$(dirname "$0")/audit.py" "$@"
