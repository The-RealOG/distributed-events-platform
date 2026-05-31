# Roles, one per responsibility:
#   execution      ECS agent: pull images, write logs, read the specific secrets it injects
#   task/<service> what the application code itself may do (ECS Exec channels; MSK access for
#                  the publisher and tools; nothing else)
#   github-deploy  GitHub Actions via OIDC: push images, register task definitions, run the
#                  migration task, roll services, publish the web build. No Terraform/IAM rights.
variable "name" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "secret_arns" { type = list(string) }
variable "log_group_arns" { type = list(string) }
variable "msk_cluster_arn" { type = string }
variable "ecr_repository_arns" { type = list(string) }
variable "web_bucket_arn" { type = string }
variable "distribution_arn" { type = string }
variable "cluster_arn" { type = string }
variable "ssm_parameter_arns" { type = list(string) }
variable "github_oidc_subject_repository" { type = string } # as it appears in the OIDC sub claim
variable "github_branch" { type = string }

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

# ---- execution role ----
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "InjectSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "inject-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ---- task roles ----
locals {
  msk_topics = "${replace(var.msk_cluster_arn, ":cluster/", ":topic/")}/*"
  msk_groups = "${replace(var.msk_cluster_arn, ":cluster/", ":group/")}/*"
  task_roles = ["api-gateway", "project-service", "outbox-publisher", "migrate", "kafka-tools", "activity-service", "cache-invalidator"]
  # Kafka consumers: each role may join only its own consumer group (= its logical name).
  msk_consumers = ["activity-service", "cache-invalidator"]
}

resource "aws_iam_role" "task" {
  for_each           = toset(local.task_roles)
  name               = "${var.name}-task-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "ecs_exec" {
  statement {
    sid = "EcsExecChannels"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"] # these actions do not support resource-level permissions
  }
}

resource "aws_iam_role_policy" "ecs_exec" {
  for_each = toset(["api-gateway", "project-service", "outbox-publisher", "activity-service", "cache-invalidator"])
  name     = "ecs-exec"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.ecs_exec.json
}

data "aws_iam_policy_document" "msk_publisher" {
  statement {
    actions   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster"]
    resources = [var.msk_cluster_arn]
  }
  statement {
    actions   = ["kafka-cluster:DescribeTopic", "kafka-cluster:WriteData"]
    resources = [local.msk_topics]
  }
}

data "aws_iam_policy_document" "msk_consumer" {
  for_each = toset(local.msk_consumers)
  statement {
    actions   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster"]
    resources = [var.msk_cluster_arn]
  }
  statement {
    actions   = ["kafka-cluster:DescribeTopic", "kafka-cluster:ReadData"]
    resources = [local.msk_topics]
  }
  statement {
    actions   = ["kafka-cluster:AlterGroup", "kafka-cluster:DescribeGroup"]
    resources = ["${replace(var.msk_cluster_arn, ":cluster/", ":group/")}/${each.key}"]
  }
}

resource "aws_iam_role_policy" "msk_consumer" {
  for_each = toset(local.msk_consumers)
  name     = "msk-consume"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.msk_consumer[each.key].json
}

resource "aws_iam_role_policy" "msk_publisher" {
  name   = "msk-produce"
  role   = aws_iam_role.task["outbox-publisher"].id
  policy = data.aws_iam_policy_document.msk_publisher.json
}

data "aws_iam_policy_document" "msk_tools" {
  statement {
    actions   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster"]
    resources = [var.msk_cluster_arn]
  }
  statement {
    actions = [
      "kafka-cluster:CreateTopic", "kafka-cluster:DescribeTopic", "kafka-cluster:DescribeTopicDynamicConfiguration",
      "kafka-cluster:WriteData", "kafka-cluster:ReadData",
    ]
    resources = [local.msk_topics]
  }
  statement {
    actions   = ["kafka-cluster:AlterGroup", "kafka-cluster:DescribeGroup"]
    resources = [local.msk_groups]
  }
}

resource "aws_iam_role_policy" "msk_tools" {
  name   = "msk-admin-probe"
  role   = aws_iam_role.task["kafka-tools"].id
  policy = data.aws_iam_policy_document.msk_tools.json
}

# ---- GitHub Actions (OIDC) ----
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only workflows running on this repository's main branch (push or workflow_dispatch).
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_oidc_subject_repository}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${var.name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = var.ecr_repository_arns
  }
  statement {
    sid       = "TaskDefinitions" # these actions do not support resource-level permissions
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
    resources = ["*"]
  }
  statement {
    # Rollout copies Terraform's tags onto the revisions it registers (no drift). Only this
    # environment's families, and only while registering them.
    sid       = "TagTaskDefinitionsOnRegister"
    actions   = ["ecs:TagResource"]
    resources = ["arn:aws:ecs:*:*:task-definition/${var.name}-*:*"]
    condition {
      test     = "StringEquals"
      variable = "ecs:CreateAction"
      values   = ["RegisterTaskDefinition"]
    }
  }
  statement {
    sid       = "RollServicesAndRunJobs"
    actions   = ["ecs:UpdateService", "ecs:DescribeServices", "ecs:RunTask", "ecs:DescribeTasks", "ecs:ListTasks"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }
  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = concat([aws_iam_role.execution.arn], [for r in aws_iam_role.task : r.arn])
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
  statement {
    sid       = "DeployConfig"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = var.ssm_parameter_arns
  }
  statement {
    sid       = "PublishWeb"
    actions   = ["s3:ListBucket", "s3:PutObject", "s3:DeleteObject"]
    resources = [var.web_bucket_arn, "${var.web_bucket_arn}/*"]
  }
  statement {
    sid       = "InvalidateCdn"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [var.distribution_arn]
  }
  statement {
    sid       = "ReadJobLogs"
    actions   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
    resources = [for arn in var.log_group_arns : "${arn}:*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

output "execution_role_arn" { value = aws_iam_role.execution.arn }
output "task_role_arns" { value = { for k, v in aws_iam_role.task : k => v.arn } }
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
