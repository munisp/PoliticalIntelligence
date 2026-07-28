output "vpc_id" {
  description = "ID of the platform VPC."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs (EKS nodes, data services)."
  value       = module.vpc.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet IDs (load balancers, NAT)."
  value       = module.vpc.public_subnet_ids
}

output "eks_cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint."
  value       = module.eks.cluster_endpoint
}

output "eks_kubeconfig_command" {
  description = "Command to refresh local kubeconfig for the cluster."
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}"
}

output "artifacts_bucket_name" {
  description = "Artifacts bucket (documents, lakehouse, backups, WORM audit exports)."
  value       = module.s3.bucket_name
}

output "artifacts_bucket_arn" {
  description = "ARN of the artifacts bucket."
  value       = module.s3.bucket_arn
}
