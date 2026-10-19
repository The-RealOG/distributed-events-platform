# PostgreSQL on RDS, private, encrypted, TLS enforced, master password managed by RDS in
# Secrets Manager (never in Terraform source). Sized and configured for a disposable dev env.
variable "name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "engine_version" { type = string }
variable "instance_class" { type = string }
variable "database_name" { type = string }
variable "allocated_storage_gb" { type = number }
variable "backup_retention_days" { type = number }
variable "skip_final_snapshot" { type = bool }

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_db_parameter_group" "this" {
  name   = var.name
  family = "postgres${split(".", var.engine_version)[0]}"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
    # How RDS records this parameter; declaring it avoids a perpetual diff.
    apply_method = "pending-reboot"
  }
  # Diagnostics: log any statement slower than 1 s and any lock wait longer than deadlock_timeout
  # (1 s), so a slow minute under load shows which statement and which lock. Bind parameters are
  # not logged (they carry user data such as task titles and email addresses).
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  parameter {
    name  = "log_lock_waits"
    value = "1"
  }
  parameter {
    name  = "log_parameter_max_length"
    value = "0"
  }
}

resource "aws_db_instance" "this" {
  identifier                  = var.name
  engine                      = "postgres"
  engine_version              = var.engine_version
  instance_class              = var.instance_class
  db_name                     = var.database_name
  username                    = "dpp_owner"
  manage_master_user_password = true
  allocated_storage           = var.allocated_storage_gb
  storage_type                = "gp3"
  storage_encrypted           = true
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [var.security_group_id]
  parameter_group_name        = aws_db_parameter_group.this.name
  publicly_accessible         = false
  multi_az                    = false
  backup_retention_period     = var.backup_retention_days
  # Dev is disposable: no final snapshot (it would keep costing after destroy) and no deletion
  # protection. Both are variables so a longer-lived environment can flip them.
  skip_final_snapshot          = var.skip_final_snapshot
  final_snapshot_identifier    = var.skip_final_snapshot ? null : "${var.name}-final"
  deletion_protection          = !var.skip_final_snapshot
  auto_minor_version_upgrade   = true
  apply_immediately            = true
  performance_insights_enabled = false
  copy_tags_to_snapshot        = true
}

output "address" { value = aws_db_instance.this.address }
output "port" { value = aws_db_instance.this.port }
output "database_name" { value = aws_db_instance.this.db_name }
output "identifier" { value = aws_db_instance.this.identifier }
output "master_secret_arn" { value = aws_db_instance.this.master_user_secret[0].secret_arn }
