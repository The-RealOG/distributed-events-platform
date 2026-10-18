# MSK provisioned: 2 × kafka.t3.small (the minimum for 2 AZs), IAM authentication only, TLS in
# transit, private data subnets. Topics are created by kafka-tools (auto-create disabled).
variable "name" { type = string }
variable "kafka_version" { type = string }
variable "broker_instance_type" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "broker_volume_gb" { type = number }

# min.insync.replicas=2 with replication factor 2: an acks=-1 publish succeeds only once both
# brokers have the event, so an acknowledged event survives the loss of either broker. The cost is
# availability: while a broker is down, publishes (and consumer offset commits) fail and are
# retried, so events wait in the outbox. HTTP writes are unaffected.
resource "aws_msk_configuration" "this" {
  # Versioned name: a version change creates the new configuration before deleting the old one.
  name              = "${var.name}-${replace(var.kafka_version, ".", "-")}"
  kafka_versions    = [var.kafka_version]
  server_properties = <<-PROPERTIES
    auto.create.topics.enable=false
    default.replication.factor=2
    min.insync.replicas=2
    num.partitions=3
    delete.topic.enable=true
  PROPERTIES
  lifecycle { create_before_destroy = true }
}

resource "aws_msk_cluster" "this" {
  cluster_name           = var.name
  kafka_version          = var.kafka_version
  number_of_broker_nodes = length(var.subnet_ids)

  broker_node_group_info {
    instance_type   = var.broker_instance_type
    client_subnets  = var.subnet_ids
    security_groups = [var.security_group_id]
    storage_info {
      ebs_storage_info { volume_size = var.broker_volume_gb }
    }
  }

  client_authentication {
    unauthenticated = false
    sasl { iam = true }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  configuration_info {
    arn      = aws_msk_configuration.this.arn
    revision = aws_msk_configuration.this.latest_revision
  }
}

output "arn" { value = aws_msk_cluster.this.arn }
output "cluster_name" { value = aws_msk_cluster.this.cluster_name }
output "bootstrap_brokers_iam" { value = aws_msk_cluster.this.bootstrap_brokers_sasl_iam }
