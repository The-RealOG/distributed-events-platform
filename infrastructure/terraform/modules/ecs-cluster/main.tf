# Fargate-only ECS cluster plus a private DNS namespace for service discovery
# (project-service.<name>.internal resolves to the task's private IP inside the VPC).
variable "name" { type = string }
variable "vpc_id" { type = string }

resource "aws_ecs_cluster" "this" {
  name = var.name
  # Container Insights adds per-metric CloudWatch charges; application metrics come from Prometheus instead.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "${var.name}.internal"
  description = "Service discovery for ${var.name}"
  vpc         = var.vpc_id
}

output "cluster_name" { value = aws_ecs_cluster.this.name }
output "cluster_arn" { value = aws_ecs_cluster.this.arn }
output "namespace_id" { value = aws_service_discovery_private_dns_namespace.this.id }
output "namespace_name" { value = aws_service_discovery_private_dns_namespace.this.name }
