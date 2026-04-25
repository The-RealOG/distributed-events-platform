#!/usr/bin/env bash
# aws:destroy plus the Terraform state bucket (all versions).   npm run aws:destroy:all
source "$(dirname "$0")/lib.sh"
require_aws_auth
"$(dirname "$0")/destroy.sh"
bucket="$(state_bucket)"
aws s3api head-bucket --bucket "$bucket" 2>/dev/null || { info "no state bucket"; exit 0; }
confirm_destructive "DELETE the Terraform state bucket $bucket (all versions); the environment can no longer be managed until re-bootstrapped"
python3 - "$bucket" <<'PY'
import json, subprocess, sys
bucket = sys.argv[1]
while True:
    out = json.loads(subprocess.check_output(["aws","s3api","list-object-versions","--bucket",bucket,"--max-items","500","--output","json"]) or b"{}")
    objs = [{"Key": o["Key"], "VersionId": o["VersionId"]} for o in out.get("Versions", []) + out.get("DeleteMarkers", [])]
    if not objs: break
    subprocess.check_call(["aws","s3api","delete-objects","--bucket",bucket,"--delete",json.dumps({"Objects":objs,"Quiet":True})])
PY
aws s3api delete-bucket --bucket "$bucket"
info "state bucket deleted"
