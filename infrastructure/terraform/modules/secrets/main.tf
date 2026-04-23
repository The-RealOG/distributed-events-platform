# Application secrets, generated here and stored in Secrets Manager. Values never appear in
# source, variables or outputs; ECS injects them into containers at start. (Terraform state
# holds them, which is why the state bucket is private, encrypted and TLS-only.)
variable "name" { type = string }
variable "recovery_window_days" { type = number }

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "app_db" {
  length           = 40
  special          = true
  override_special = "-_.~!*"
}

# Shared between CloudFront and the ALB so the ALB serves only requests that came through this
# distribution (the CloudFront prefix list alone would admit any distribution).
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name}/jwt-signing-key"
  description             = "HS256 signing key for dev JWTs (project-service)"
  recovery_window_in_days = var.recovery_window_days
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "app_db" {
  name                    = "${var.name}/app-db-user"
  description             = "Least-privilege PostgreSQL role used by services (created by the migration job)"
  recovery_window_in_days = var.recovery_window_days
}

resource "aws_secretsmanager_secret_version" "app_db" {
  secret_id     = aws_secretsmanager_secret.app_db.id
  secret_string = jsonencode({ username = "dpp_app", password = random_password.app_db.result })
}

output "jwt_secret_arn" { value = aws_secretsmanager_secret.jwt.arn }
output "app_db_secret_arn" { value = aws_secretsmanager_secret.app_db.arn }
output "origin_verify_value" {
  value     = random_password.origin_verify.result
  sensitive = true
}
