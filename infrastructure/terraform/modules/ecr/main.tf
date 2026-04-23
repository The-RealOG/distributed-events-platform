# One repository per deployable image. Tags are immutable (deployments reference a git SHA), and
# old images expire so a dev registry doesn't grow without bound.
variable "name" { type = string }
variable "repositories" { type = list(string) }
variable "keep_images" { type = number }
variable "force_delete" { type = bool }

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repositories)
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.force_delete
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep the newest ${var.keep_images} images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = var.keep_images }
      action       = { type = "expire" }
    }]
  })
}

output "repository_urls" { value = { for k, v in aws_ecr_repository.this : k => v.repository_url } }
output "repository_arns" { value = { for k, v in aws_ecr_repository.this : k => v.arn } }
