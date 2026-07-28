variable "project" {
  description = "Project name used for resource naming and default tags."
  type        = string
  default     = "policy-twin"
}

variable "environment" {
  description = "Deployment environment (drives sizing and naming)."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the platform VPC."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "availability_zones" {
  description = "Availability zones to spread subnets and node groups across."
  type        = list(string)
  default     = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "at least two availability zones are required for EKS."
  }
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDRs (one per AZ) for EKS nodes and data services."
  type        = list(string)
  default     = ["10.20.1.0/24", "10.20.2.0/24", "10.20.3.0/24"]

  validation {
    condition     = length(var.private_subnet_cidrs) == length(var.availability_zones)
    error_message = "private_subnet_cidrs must have one CIDR per availability zone."
  }
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs (one per AZ) for load balancers and NAT."
  type        = list(string)
  default     = ["10.20.101.0/24", "10.20.102.0/24", "10.20.103.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == length(var.availability_zones)
    error_message = "public_subnet_cidrs must have one CIDR per availability zone."
  }
}

variable "eks_cluster_version" {
  description = "Kubernetes version for the EKS cluster."
  type        = string
  default     = "1.29"
}

variable "node_instance_types" {
  description = "Instance types for the default managed node group."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "node_desired_size" {
  description = "Desired node count for the default managed node group."
  type        = number
  default     = 3

  validation {
    condition     = var.node_desired_size >= 1
    error_message = "node_desired_size must be at least 1."
  }
}

variable "enable_gpu_node_group" {
  description = "Provision the tainted GPU managed node group (g5.xlarge) for AI inference workloads."
  type        = bool
  default     = true
}

variable "gpu_instance_types" {
  description = "Instance types for the GPU managed node group."
  type        = list(string)
  default     = ["g5.xlarge"]
}

variable "artifacts_bucket_name" {
  description = "Globally-unique name for the artifacts S3 bucket (documents, lakehouse, backups, WORM audit exports)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.artifacts_bucket_name))
    error_message = "artifacts_bucket_name must be a valid S3 bucket name."
  }
}

variable "object_lock_retention_years" {
  description = "Default Object-Lock compliance-mode retention for the artifacts bucket (audit WORM requirement: 7 years)."
  type        = number
  default     = 7

  validation {
    condition     = var.object_lock_retention_years >= 7
    error_message = "object_lock_retention_years must be >= 7 to satisfy the audit-retention NFR."
  }
}

variable "tags" {
  description = "Additional tags applied to every resource."
  type        = map(string)
  default     = {}
}
