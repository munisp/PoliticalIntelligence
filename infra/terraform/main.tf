# Foundational infrastructure for the Policy Twin platform.
# Stub modules — no real provider credentials. Select a cloud by setting
# `cloud_provider` and filling in the matching provider block + module source.
terraform {
  required_version = ">= 1.7"

  # Remote state (example: S3 + DynamoDB lock). Configure per environment
  # via backend config files — never commit credentials.
  # backend "s3" {
  #   bucket         = "policy-twin-tfstate"
  #   key            = "foundation/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "policy-twin-tflock"
  # }
}

# ── Network ──────────────────────────────────────────────────
# One VPC/VNet with public (ingress) and private (workloads + data) subnets.
module "network" {
  source = "./modules/network"

  name_prefix        = local.name_prefix
  cidr_block         = var.vpc_cidr_block
  availability_zones = var.availability_zones
  tags               = local.common_tags
}

# ── Object storage ───────────────────────────────────────────
# Bucket/container for raw documents, lakehouse (Iceberg) data, and backups.
module "object_storage" {
  source = "./modules/object_storage"

  name_prefix          = local.name_prefix
  bucket_name          = var.object_storage_bucket_name
  versioning_enabled   = true
  encryption_at_rest   = true
  block_public_access  = true
  tags                 = local.common_tags
}

# ── Kubernetes cluster ───────────────────────────────────────
# Managed K8s (EKS/AKS/GKE depending on cloud_provider). Placeholder: the
# module exposes node group sizing inputs; GPU node pools for model serving
# are defined separately per docs/MODEL_STRATEGY.md.
module "kubernetes" {
  source = "./modules/kubernetes"

  name_prefix        = local.name_prefix
  cluster_version    = var.kubernetes_version
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  node_groups = {
    system = {
      instance_types = var.system_node_instance_types
      min_size       = 2
      max_size       = 4
      desired_size   = 2
    }
    workers = {
      instance_types = var.worker_node_instance_types
      min_size       = var.worker_node_min
      max_size       = var.worker_node_max
      desired_size   = var.worker_node_desired
    }
    # GPU pool placeholder for vLLM / Ray Serve (interactive + batch tiers).
    gpu = {
      instance_types = var.gpu_node_instance_types
      min_size       = 0
      max_size       = var.gpu_node_max
      desired_size   = 0
      taints         = ["workload=gpu:NoSchedule"]
    }
  }
  tags = local.common_tags
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    CostCenter  = var.cost_center
  }
}
