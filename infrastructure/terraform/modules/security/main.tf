# Security groups: one per role, least-privilege rules between them.
#
#   CloudFront ──80──▶ alb ──3000──▶ gateway ──3001──▶ project-service ──5432──▶ rds
#                                                    outbox-publisher ──5432──▶ rds
#                                                    outbox-publisher ──9098──▶ msk
#                                        tools (migrate, kafka-tools) ──5432/9098──▶ rds/msk
#
# Tasks may open outbound HTTPS (443) to reach AWS APIs (ECR, Secrets Manager, CloudWatch,
# SSM for ECS Exec). Data stores have no internet-facing rules and no egress rules.
variable "name" { type = string }
variable "vpc_id" { type = string }
variable "redis_enabled" { type = bool }

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

locals {
  groups = {
    alb              = "Application load balancer (CloudFront origin only)"
    gateway          = "api-gateway tasks"
    project_service  = "project-service tasks"
    outbox_publisher = "outbox-publisher tasks"
    tools            = "one-off tasks: migrations, kafka-tools"
    rds              = "PostgreSQL (RDS)"
    msk              = "Kafka brokers (MSK)"
    redis            = "Redis/Valkey (ElastiCache)"
  }
  # [from, to, port] pairs of SG-to-SG access.
  links = {
    alb_to_gateway     = ["alb", "gateway", 3000]
    gateway_to_project = ["gateway", "project_service", 3001]
    project_to_rds     = ["project_service", "rds", 5432]
    publisher_to_rds   = ["outbox_publisher", "rds", 5432]
    tools_to_rds       = ["tools", "rds", 5432]
    publisher_to_msk   = ["outbox_publisher", "msk", 9098]
    tools_to_msk       = ["tools", "msk", 9098]
    project_to_redis   = ["project_service", "redis", 6379]
  }
  https_egress = ["gateway", "project_service", "outbox_publisher", "tools"]
}

resource "aws_security_group" "this" {
  for_each    = local.groups
  name        = "${var.name}-${replace(each.key, "_", "-")}"
  description = each.value
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-${replace(each.key, "_", "-")}" }
}

resource "aws_vpc_security_group_ingress_rule" "link" {
  for_each                     = { for k, v in local.links : k => v if var.redis_enabled || v[1] != "redis" }
  security_group_id            = aws_security_group.this[each.value[1]].id
  referenced_security_group_id = aws_security_group.this[each.value[0]].id
  ip_protocol                  = "tcp"
  from_port                    = each.value[2]
  to_port                      = each.value[2]
  description                  = "from ${each.value[0]}"
}

resource "aws_vpc_security_group_egress_rule" "link" {
  for_each                     = { for k, v in local.links : k => v if var.redis_enabled || v[1] != "redis" }
  security_group_id            = aws_security_group.this[each.value[0]].id
  referenced_security_group_id = aws_security_group.this[each.value[1]].id
  ip_protocol                  = "tcp"
  from_port                    = each.value[2]
  to_port                      = each.value[2]
  description                  = "to ${each.value[1]}"
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.this["alb"].id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "CloudFront origin-facing addresses only"
}

resource "aws_vpc_security_group_egress_rule" "https" {
  for_each          = toset(local.https_egress)
  security_group_id = aws_security_group.this[each.key].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "AWS APIs (ECR, Secrets Manager, CloudWatch Logs, SSM)"
}

output "ids" { value = { for k, v in aws_security_group.this : k => v.id } }
