terraform {
  required_version = ">= 1.10.0, < 2.0.0" # 1.10+: S3 backend native state locking

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  # Bucket/key/region are supplied by scripts/aws (bucket name includes the account ID, which is
  # discovered, not hardcoded). Locking uses an S3 lockfile; DynamoDB locking is deprecated.
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "dpp"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = var.github_repository
    }
  }
}
