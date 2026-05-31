variable "aws_region" {
  type    = string
  default = "us-east-2"
}

variable "environment" {
  type    = string
  default = "dev"
  validation {
    condition     = var.environment == "dev"
    error_message = "This configuration is the disposable dev environment only."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "github_repository" {
  type        = string
  default     = "The-RealOG/distributed-events-platform"
  description = "owner/name of the repository (tags, docs)"
}

variable "github_oidc_subject_repository" {
  type = string
  # GitHub's immutable subject format includes the owner and repository IDs
  # (gh api repos/OWNER/REPO/actions/oidc/customization/sub → sub_claim_prefix). A renamed,
  # deleted-and-recreated or transferred repository with the same name cannot match it.
  default     = "The-RealOG@168302805/distributed-events-platform@1388724647"
  description = "repository part of the GitHub OIDC sub claim allowed to assume the deploy role (main branch only)"
}

# The only value that must be provided by the developer (kept out of Git in local.auto.tfvars).
variable "budget_alert_email" {
  type        = string
  description = "Where AWS Budgets sends cost alerts"
}

variable "monthly_budget_usd" {
  type    = number
  default = 50
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "postgres_version" {
  type    = string
  default = "17.11" # matches the local/CI PostgreSQL 17
}

variable "kafka_version" {
  type = string
  # 4.x (KRaft) on MSK does not offer kafka.t3.small ("Unsupported InstanceType"); 3.9 is the
  # newest version that does. KafkaJS and the application behave the same against 3.9 and 4.1.
  default = "3.9.x"
}

variable "enable_redis" {
  type        = bool
  default     = true
  description = "ElastiCache Valkey (cache.t4g.micro) for the Phase 7 board cache; false removes it"
}
