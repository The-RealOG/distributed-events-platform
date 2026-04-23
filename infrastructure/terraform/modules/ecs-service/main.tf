# One Fargate task definition, and optionally a long-running service for it. One-shot jobs
# (migrations, kafka-tools) use the task definition only, launched by scripts/aws via RunTask.
variable "name" { type = string }           # full family name, e.g. dpp-dev-project-service
variable "container_name" { type = string } # e.g. project-service
variable "image" { type = string }
variable "cpu" { type = number }
variable "memory" { type = number }
variable "port" {
  type    = number
  default = null
}
variable "command" {
  type    = list(string)
  default = null
}
variable "environment" {
  type    = map(string)
  default = {}
}
# env var name → Secrets Manager reference ("<arn>" or "<arn>:<json-key>::")
variable "secrets" {
  type    = map(string)
  default = {}
}
variable "health_check_path" {
  type    = string
  default = null
}
variable "execution_role_arn" { type = string }
variable "task_role_arn" { type = string }
variable "log_group_name" { type = string }
variable "region" { type = string }
variable "stop_timeout_seconds" {
  type    = number
  default = 30
}

# Service (omit for one-shot task families)
variable "create_service" {
  type    = bool
  default = false
}
variable "cluster_arn" {
  type    = string
  default = null
}
variable "desired_count" {
  type    = number
  default = 1
}
variable "subnet_ids" {
  type    = list(string)
  default = []
}
variable "security_group_id" {
  type    = string
  default = null
}
variable "target_group_arn" {
  type    = string
  default = null
}
variable "discovery_namespace_id" {
  type    = string
  default = null
}
# Explicit flags: whether an ARN is null is not known at plan time when the ARN is being created.
variable "register_in_discovery" {
  type    = bool
  default = false
}
variable "attach_to_load_balancer" {
  type    = bool
  default = false
}
variable "capacity_provider" {
  type    = string
  default = "FARGATE"
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = var.container_name
    image        = var.image
    essential    = true
    command      = var.command
    stopTimeout  = var.stop_timeout_seconds
    portMappings = var.port == null ? [] : [{ containerPort = var.port, protocol = "tcp", name = "http" }]
    environment  = [for k, v in var.environment : { name = k, value = v }]
    secrets      = [for k, v in var.secrets : { name = k, valueFrom = v }]
    # Liveness only (/health). Readiness (/ready) is what the load balancer checks, so a
    # dependency outage takes a task out of rotation without ECS killing it.
    healthCheck = var.health_check_path == null ? null : {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.port}${var.health_check_path} >/dev/null || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    linuxParameters = { initProcessEnabled = true } # required for ECS Exec
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = var.log_group_name
        awslogs-region        = var.region
        awslogs-stream-prefix = var.container_name
      }
    }
  }])
}

resource "aws_service_discovery_service" "this" {
  count = var.create_service && var.register_in_discovery ? 1 : 0
  name  = var.container_name
  dns_config {
    namespace_id   = var.discovery_namespace_id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  # No health_check_custom_config: ECS registers/deregisters task IPs itself, and the (empty)
  # block is not read back by the provider, which forced a replacement on every apply.
}

resource "aws_ecs_service" "this" {
  count                  = var.create_service ? 1 : 0
  name                   = var.container_name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.desired_count
  enable_execute_command = true
  propagate_tags         = "SERVICE"
  wait_for_steady_state  = false

  capacity_provider_strategy {
    capacity_provider = var.capacity_provider
    weight            = 1
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = true # outbound to AWS APIs without a NAT gateway; no inbound (see SGs)
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  # A deployment whose tasks never become healthy is rolled back automatically.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = var.attach_to_load_balancer ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = var.container_name
      container_port   = var.port
    }
  }
  health_check_grace_period_seconds = var.attach_to_load_balancer ? 60 : null

  dynamic "service_registries" {
    for_each = aws_service_discovery_service.this
    content { registry_arn = service_registries.value.arn }
  }
}

output "family" { value = aws_ecs_task_definition.this.family }
output "task_definition_arn" { value = aws_ecs_task_definition.this.arn }
output "service_name" { value = var.create_service ? aws_ecs_service.this[0].name : null }
