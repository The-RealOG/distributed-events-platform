# Valkey (Redis-compatible) on ElastiCache for the shared board cache (ADR-015). Created only when
# `enabled` (the dev environment's enable_redis, true by default); a node costs money every hour.
variable "name" { type = string }
variable "enabled" { type = bool }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "node_type" { type = string }

resource "aws_elasticache_subnet_group" "this" {
  count      = var.enabled ? 1 : 0
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  count                      = var.enabled ? 1 : 0
  replication_group_id       = var.name
  description                = "dpp board cache"
  engine                     = "valkey"
  node_type                  = var.node_type
  num_cache_clusters         = 1
  subnet_group_name          = aws_elasticache_subnet_group.this[0].name
  security_group_ids         = [var.security_group_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = false
  apply_immediately          = true
}

output "endpoint" { value = var.enabled ? aws_elasticache_replication_group.this[0].primary_endpoint_address : null }
