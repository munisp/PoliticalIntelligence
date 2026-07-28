provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags,
  )
}

# Network: one VPC, public subnets (ingress/NAT) + private subnets (EKS
# nodes, data services).
module "vpc" {
  source = "./modules/vpc"

  name_prefix          = local.name_prefix
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  private_subnet_cidrs = var.private_subnet_cidrs
  public_subnet_cidrs  = var.public_subnet_cidrs
  cluster_name         = local.name_prefix
}

# Kubernetes: EKS with managed node groups — a general-purpose pool plus a
# tainted GPU pool (g5.xlarge) for AI inference, all on private subnets.
module "eks" {
  source = "./modules/eks"

  name_prefix           = local.name_prefix
  cluster_version       = var.eks_cluster_version
  private_subnet_ids    = module.vpc.private_subnet_ids
  node_instance_types   = var.node_instance_types
  node_desired_size     = var.node_desired_size
  enable_gpu_node_group = var.enable_gpu_node_group
  gpu_instance_types    = var.gpu_instance_types
}

# Artifacts: versioned, encrypted, Object-Locked (compliance mode, default
# 7-year retention) bucket for documents, lakehouse data, backups and WORM
# audit exports.
module "s3" {
  source = "./modules/s3"

  bucket_name                 = var.artifacts_bucket_name
  object_lock_retention_years = var.object_lock_retention_years
}
