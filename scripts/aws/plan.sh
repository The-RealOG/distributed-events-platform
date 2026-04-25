#!/usr/bin/env bash
# terraform plan for the dev environment, saved for review/apply.   npm run aws:plan
source "$(dirname "$0")/lib.sh"
require_aws_auth
tf_init
terraform -chdir="$TF_DIR" fmt -check -recursive ../../ || die "terraform fmt needed: terraform -chdir=infrastructure/terraform fmt -recursive"
terraform -chdir="$TF_DIR" validate -no-color >/dev/null
terraform -chdir="$TF_DIR" plan -input=false -out=dev.tfplan "$@"
