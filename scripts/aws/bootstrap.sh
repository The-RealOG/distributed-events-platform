#!/usr/bin/env bash
# Creates (or verifies) the Terraform remote-state bucket. Idempotent. Never destroyed by
# aws:destroy; see destroy-bootstrap.sh.
#   npm run aws:bootstrap
source "$(dirname "$0")/lib.sh"
require_aws_auth
bucket="$(state_bucket)"

if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
  info "state bucket $bucket exists"
else
  info "creating state bucket $bucket"
  if [[ "$AWS_REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$bucket" >/dev/null
  else
    aws s3api create-bucket --bucket "$bucket" \
      --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
fi

# Re-applied every run so the settings converge even if someone changed them.
aws s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-ownership-controls --bucket "$bucket" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-policy --bucket "$bucket" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*",
 "Action":"s3:*","Resource":["arn:aws:s3:::$bucket","arn:aws:s3:::$bucket/*"],
 "Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}
JSON
)"
aws s3api put-bucket-tagging --bucket "$bucket" --tagging \
  "TagSet=[{Key=Project,Value=$PROJECT},{Key=ManagedBy,Value=scripts/aws/bootstrap.sh},{Key=Purpose,Value=terraform-state}]"
info "state bucket ready: s3://$bucket (versioned, encrypted, public access blocked, TLS only)"
info "locking: Terraform S3 native lockfile (use_lockfile); no DynamoDB table needed"
