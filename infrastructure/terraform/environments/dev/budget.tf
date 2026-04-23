module "budget" {
  source            = "../../modules/budget"
  name              = local.name
  monthly_limit_usd = var.monthly_budget_usd
  alert_email       = var.budget_alert_email
}
