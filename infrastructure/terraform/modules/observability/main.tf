# CloudWatch log groups for ECS containers (structured JSON from Pino). Short retention: these are
# dev logs for debugging, not an archive. Metrics/dashboards remain Phase 10 (Prometheus/Grafana).
variable "name" { type = string }
variable "services" { type = list(string) }
variable "retention_days" { type = number }

resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(var.services)
  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.retention_days
}

output "log_group_names" { value = { for k, v in aws_cloudwatch_log_group.this : k => v.name } }
output "log_group_arns" { value = { for k, v in aws_cloudwatch_log_group.this : k => v.arn } }
