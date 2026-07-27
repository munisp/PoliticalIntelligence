output "vpc_id" {
  description = "ID of the platform VPC/VNet."
  value       = module.network.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs for workloads and data services."
  value       = module.network.private_subnet_ids
}

output "object_storage_bucket" {
  description = "Name/ARN of the data bucket (documents, Iceberg, backups)."
  value       = module.object_storage.bucket_id
}

output "kubernetes_cluster_name" {
  description = "Name of the managed Kubernetes cluster."
  value       = module.kubernetes.cluster_name
}

output "kubernetes_cluster_endpoint" {
  description = "API endpoint of the managed Kubernetes cluster."
  value       = module.kubernetes.cluster_endpoint
  sensitive   = true
}
