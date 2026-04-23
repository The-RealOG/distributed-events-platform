# Private S3 buckets: attachments (future file-storage phase) and the web app's static files
# (served only through CloudFront Origin Access Control; see the edge module).
variable "name" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "force_destroy" { type = bool }

locals {
  buckets = {
    attachments = "${var.name}-attachments-${var.account_id}-${var.region}"
    web         = "${var.name}-web-${var.account_id}-${var.region}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each      = local.buckets
  bucket        = each.value
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "attachments" {
  bucket = aws_s3_bucket.this["attachments"].id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

# Attachments: TLS-only. (The web bucket's policy, which also grants CloudFront read access, is
# defined in the edge module; a bucket can have only one policy.)
resource "aws_s3_bucket_policy" "attachments" {
  bucket = aws_s3_bucket.this["attachments"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this["attachments"].arn, "${aws_s3_bucket.this["attachments"].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}

output "attachments_bucket" { value = aws_s3_bucket.this["attachments"].id }
output "attachments_bucket_arn" { value = aws_s3_bucket.this["attachments"].arn }
output "web_bucket" { value = aws_s3_bucket.this["web"].id }
output "web_bucket_arn" { value = aws_s3_bucket.this["web"].arn }
output "web_bucket_regional_domain" { value = aws_s3_bucket.this["web"].bucket_regional_domain_name }
