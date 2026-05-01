data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  name       = "dpp-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
  services   = ["api-gateway", "project-service", "outbox-publisher", "migrate", "kafka-tools"]
  images     = ["api-gateway", "project-service", "outbox-publisher", "kafka-tools"]

  # The deployed image tag (git SHA) lives in SSM: CI updates it, Terraform reads it back, so both
  # always agree on what runs. Until the first build it is "bootstrap" and services run 0 tasks.
  # A git SHA is not secret; SSM values are marked sensitive by default, which would hide the image
  # in every plan of the task definitions.
  image_tag = nonsensitive(aws_ssm_parameter.image_tag.value)
  deployed  = local.image_tag != "bootstrap"
  image     = { for k, url in module.ecr.repository_urls : k => "${url}:${local.image_tag}" }
  rds_ca    = "/app/certs/rds-global-bundle.pem"
}

resource "aws_ssm_parameter" "image_tag" {
  name        = "/${local.name}/image-tag"
  description = "Git SHA of the images currently deployed (written by the deploy workflow)"
  type        = "String"
  value       = "bootstrap"
  lifecycle { ignore_changes = [value] }
}

module "networking" {
  source = "../../modules/networking"
  name   = local.name
  cidr   = var.vpc_cidr
  azs    = local.azs
}

module "security" {
  source        = "../../modules/security"
  name          = local.name
  vpc_id        = module.networking.vpc_id
  redis_enabled = var.enable_redis
}

module "secrets" {
  source               = "../../modules/secrets"
  name                 = local.name
  recovery_window_days = 0 # dev: delete immediately on destroy (nothing lingers or bills)
}

module "rds" {
  source                = "../../modules/rds"
  name                  = local.name
  subnet_ids            = module.networking.data_subnet_ids
  security_group_id     = module.security.ids["rds"]
  engine_version        = var.postgres_version
  instance_class        = "db.t4g.micro"
  database_name         = "dpp"
  allocated_storage_gb  = 20
  backup_retention_days = 1
  skip_final_snapshot   = true
}

module "kafka" {
  source               = "../../modules/kafka"
  name                 = local.name
  kafka_version        = var.kafka_version
  broker_instance_type = "kafka.t3.small"
  subnet_ids           = module.networking.data_subnet_ids
  security_group_id    = module.security.ids["msk"]
  broker_volume_gb     = 10
}

module "redis" {
  source            = "../../modules/redis"
  name              = local.name
  enabled           = var.enable_redis
  subnet_ids        = module.networking.data_subnet_ids
  security_group_id = module.security.ids["redis"]
  node_type         = "cache.t4g.micro"
}

module "storage" {
  source        = "../../modules/object-storage"
  name          = local.name
  account_id    = local.account_id
  region        = var.aws_region
  force_destroy = true
}

module "ecr" {
  source       = "../../modules/ecr"
  name         = local.name
  repositories = local.images
  keep_images  = 15
  force_delete = true
}

module "logs" {
  source         = "../../modules/observability"
  name           = local.name
  services       = local.services
  retention_days = var.log_retention_days
}

module "cluster" {
  source = "../../modules/ecs-cluster"
  name   = local.name
  vpc_id = module.networking.vpc_id
}

module "alb" {
  source              = "../../modules/load-balancer"
  name                = local.name
  vpc_id              = module.networking.vpc_id
  subnet_ids          = module.networking.public_subnet_ids
  security_group_id   = module.security.ids["alb"]
  origin_verify_value = module.secrets.origin_verify_value
}

module "edge" {
  source                     = "../../modules/edge"
  name                       = local.name
  web_bucket                 = module.storage.web_bucket
  web_bucket_arn             = module.storage.web_bucket_arn
  web_bucket_regional_domain = module.storage.web_bucket_regional_domain
  alb_dns_name               = module.alb.dns_name
  origin_verify_value        = module.secrets.origin_verify_value
}

module "iam" {
  source                         = "../../modules/iam"
  name                           = local.name
  region                         = var.aws_region
  account_id                     = local.account_id
  secret_arns                    = [module.secrets.jwt_secret_arn, module.secrets.app_db_secret_arn, module.rds.master_secret_arn]
  log_group_arns                 = values(module.logs.log_group_arns)
  msk_cluster_arn                = module.kafka.arn
  ecr_repository_arns            = values(module.ecr.repository_arns)
  web_bucket_arn                 = module.storage.web_bucket_arn
  distribution_arn               = module.edge.distribution_arn
  cluster_arn                    = module.cluster.cluster_arn
  ssm_parameter_arns             = [aws_ssm_parameter.image_tag.arn, aws_ssm_parameter.deploy_config.arn]
  github_oidc_subject_repository = var.github_oidc_subject_repository
  github_branch                  = "main"
}
