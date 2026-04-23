output "app_url" { value = "https://${module.edge.domain_name}" }
output "region" { value = var.aws_region }
output "vpc_id" { value = module.networking.vpc_id }
output "ecs_cluster_name" { value = module.cluster.cluster_name }
output "alb_dns_name" {
  value       = module.alb.dns_name
  description = "Not usable directly: admits only CloudFront requests carrying the origin header"
}
output "rds_address" { value = module.rds.address }
output "msk_cluster_name" { value = module.kafka.cluster_name }
output "msk_bootstrap_brokers_iam" { value = module.kafka.bootstrap_brokers_iam }
output "redis_endpoint" { value = module.redis.endpoint }
output "attachments_bucket" { value = module.storage.attachments_bucket }
output "web_bucket" { value = module.storage.web_bucket }
output "ecr_repository_urls" { value = module.ecr.repository_urls }
output "github_deploy_role_arn" { value = module.iam.github_deploy_role_arn }
output "deploy_config_parameter" { value = aws_ssm_parameter.deploy_config.name }
output "image_tag" { value = local.image_tag }
