locals {
  discovery_domain = module.cluster.namespace_name
  app_db = {
    DB_USER     = "${module.secrets.app_db_secret_arn}:username::"
    DB_PASSWORD = "${module.secrets.app_db_secret_arn}:password::"
  }
  db_env = {
    DB_HOST              = module.rds.address
    DB_PORT              = tostring(module.rds.port)
    DB_NAME              = module.rds.database_name
    DATABASE_TLS_CA_FILE = local.rds_ca
  }
  kafka_env = {
    KAFKA_BROKERS = module.kafka.bootstrap_brokers_iam
    KAFKA_SSL     = "true"
    KAFKA_AUTH    = "aws-iam"
    AWS_REGION    = var.aws_region
  }
  common_env = { NODE_ENV = "production", LOG_LEVEL = "info", HOST = "0.0.0.0" }
}

module "project_service" {
  source             = "../../modules/ecs-service"
  name               = "${local.name}-project-service"
  container_name     = "project-service"
  image              = local.image["project-service"]
  cpu                = 256
  memory             = 512
  port               = 3001
  health_check_path  = "/health"
  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arns["project-service"]
  log_group_name     = module.logs.log_group_names["project-service"]
  region             = var.aws_region
  environment = merge(local.common_env, local.db_env, {
    PORT = "3001"
    # Dev login is how the smoke test and demo sign in. The environment is short-lived and its URL
    # unpublished; a real environment would use an identity provider (AuthProvider interface).
    AUTH_DEV_LOGIN_ENABLED = "true"
  })
  secrets                = merge(local.app_db, { JWT_SECRET = module.secrets.jwt_secret_arn })
  create_service         = true
  cluster_arn            = module.cluster.cluster_arn
  desired_count          = local.deployed ? 1 : 0
  subnet_ids             = module.networking.public_subnet_ids
  security_group_id      = module.security.ids["project_service"]
  discovery_namespace_id = module.cluster.namespace_id
  register_in_discovery  = true
}

module "api_gateway" {
  source             = "../../modules/ecs-service"
  name               = "${local.name}-api-gateway"
  container_name     = "api-gateway"
  image              = local.image["api-gateway"]
  cpu                = 256
  memory             = 512
  port               = 3000
  health_check_path  = "/health"
  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arns["api-gateway"]
  log_group_name     = module.logs.log_group_names["api-gateway"]
  region             = var.aws_region
  environment = merge(local.common_env, {
    PORT                = "3000"
    PROJECT_SERVICE_URL = "http://project-service.${local.discovery_domain}:3001"
    CORS_ORIGINS        = "https://${module.edge.domain_name}"
  })
  create_service          = true
  cluster_arn             = module.cluster.cluster_arn
  desired_count           = local.deployed ? 1 : 0
  subnet_ids              = module.networking.public_subnet_ids
  security_group_id       = module.security.ids["gateway"]
  target_group_arn        = module.alb.target_group_arn
  attach_to_load_balancer = true
}

module "outbox_publisher" {
  source             = "../../modules/ecs-service"
  name               = "${local.name}-outbox-publisher"
  container_name     = "outbox-publisher"
  image              = local.image["outbox-publisher"]
  command            = ["node", "--disable-warning=TimeoutNegativeWarning", "dist/server.js"]
  cpu                = 256
  memory             = 512
  port               = 3002
  health_check_path  = "/health"
  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arns["outbox-publisher"]
  log_group_name     = module.logs.log_group_names["outbox-publisher"]
  region             = var.aws_region
  environment = merge(local.common_env, local.db_env, local.kafka_env, {
    PORT            = "3002"
    KAFKA_CLIENT_ID = "outbox-publisher"
  })
  secrets           = local.app_db
  create_service    = true
  cluster_arn       = module.cluster.cluster_arn
  desired_count     = local.deployed ? 1 : 0
  subnet_ids        = module.networking.public_subnet_ids
  security_group_id = module.security.ids["outbox_publisher"]
}

# One-shot: apply migrations as the database owner, then (re)create the least-privilege app role.
module "migrate" {
  source             = "../../modules/ecs-service"
  name               = "${local.name}-migrate"
  container_name     = "migrate"
  image              = local.image["project-service"]
  command            = ["node", "/app/packages/database/dist/migrate-cli.js"]
  cpu                = 256
  memory             = 512
  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arns["migrate"]
  log_group_name     = module.logs.log_group_names["migrate"]
  region             = var.aws_region
  environment        = merge(local.db_env, { APP_DB_USER = "dpp_app" })
  secrets = {
    DB_USER         = "${module.rds.master_secret_arn}:username::"
    DB_PASSWORD     = "${module.rds.master_secret_arn}:password::"
    APP_DB_PASSWORD = "${module.secrets.app_db_secret_arn}:password::"
  }
}

# One-shot: kafka-tools (init-topics by default; the probe overrides the command).
module "kafka_tools" {
  source             = "../../modules/ecs-service"
  name               = "${local.name}-kafka-tools"
  container_name     = "kafka-tools"
  image              = local.image["kafka-tools"]
  command            = ["node", "--disable-warning=TimeoutNegativeWarning", "dist/cli.js", "init-topics"]
  cpu                = 256
  memory             = 512
  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arns["kafka-tools"]
  log_group_name     = module.logs.log_group_names["kafka-tools"]
  region             = var.aws_region
  environment = merge(local.kafka_env, {
    LOG_LEVEL                = "info"
    KAFKA_CLIENT_ID          = "kafka-tools"
    KAFKA_REPLICATION_FACTOR = "2"
  })
}

# Non-secret facts the deploy workflow and scripts need, so neither needs Terraform state access.
resource "aws_ssm_parameter" "deploy_config" {
  name        = "/${local.name}/deploy-config"
  description = "Non-secret deployment facts for scripts/aws and the GitHub deploy workflow"
  type        = "String"
  value = jsonencode({
    region          = var.aws_region
    cluster         = module.cluster.cluster_name
    app_url         = "https://${module.edge.domain_name}"
    distribution_id = module.edge.distribution_id
    web_bucket      = module.storage.web_bucket
    task_subnets    = module.networking.public_subnet_ids
    ecr             = module.ecr.repository_urls
    services        = ["project-service", "api-gateway", "outbox-publisher"]
    families = {
      "project-service"  = module.project_service.family
      "api-gateway"      = module.api_gateway.family
      "outbox-publisher" = module.outbox_publisher.family
      "migrate"          = module.migrate.family
      "kafka-tools"      = module.kafka_tools.family
    }
    security_groups = {
      "project-service"  = module.security.ids["project_service"]
      "api-gateway"      = module.security.ids["gateway"]
      "outbox-publisher" = module.security.ids["outbox_publisher"]
      "migrate"          = module.security.ids["tools"]
      "kafka-tools"      = module.security.ids["tools"]
    }
    log_groups = module.logs.log_group_names
    rds = {
      identifier = module.rds.identifier
      address    = module.rds.address
      port       = module.rds.port
    }
    msk_cluster = module.kafka.cluster_name
  })
}
