# Internet-facing ALB in front of api-gateway. It is not meant to be used directly: the security
# group admits only CloudFront, and the listener forwards only requests carrying the secret origin
# header that this distribution adds. Everything else gets 403.
variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "origin_verify_value" {
  type      = string
  sensitive = true
}

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = var.subnet_ids
  security_groups            = [var.security_group_id]
  drop_invalid_header_fields = true
  idle_timeout               = 60
}

resource "aws_lb_target_group" "gateway" {
  name                 = "${var.name}-gateway"
  target_type          = "ip"
  port                 = 3000
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  deregistration_delay = 15
  health_check {
    path                = "/ready"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10
  condition {
    http_header {
      http_header_name = "x-origin-verify"
      values           = [var.origin_verify_value]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

output "dns_name" { value = aws_lb.this.dns_name }
output "arn_suffix" { value = aws_lb.this.arn_suffix }
output "target_group_arn" { value = aws_lb_target_group.gateway.arn }
