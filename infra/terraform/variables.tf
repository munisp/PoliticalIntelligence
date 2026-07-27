variable "project" {
  description = "Project name used as a resource name prefix."
  type        = string
  default     = "policy-twin"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "cloud_provider" {
  description = "Target cloud for the foundational resources (aws | azure | gcp). Modules are stubs; wire the matching provider block before apply."
  type        = string
  default     = "aws"
  validation {
    condition     = contains(["aws", "azure", "gcp"], var.cloud_provider)
    error_message = "cloud_provider must be one of: aws, azure, gcp."
  }
}

variable "region" {
  description = "Cloud region. For sovereign deployments use an in-country region."
  type        = string
  default     = ""
}

variable "vpc_cidr_block" {
  description = "CIDR for the platform VPC/VNet."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for subnets."
  type        = list(string)
  default     = ["a", "b", "c"]
}

variable "object_storage_bucket_name" {
  description = "Object storage bucket/container for documents, Iceberg lakehouse, and backups."
  type        = string
  default     = "policy-twin-data"
}

variable "kubernetes_version" {
  description = "Managed Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "system_node_instance_types" {
  description = "Instance types for the system node group."
  type        = list(string)
  default     = ["t3.large"]
}

variable "worker_node_instance_types" {
  description = "Instance types for general workload nodes."
  type        = list(string)
  default     = ["m5.2xlarge"]
}

variable "worker_node_min" {
  type    = number
  default = 2
}

variable "worker_node_max" {
  type    = number
  default = 8
}

variable "worker_node_desired" {
  type    = number
  default = 3
}

variable "gpu_node_instance_types" {
  description = "GPU instance types for vLLM/Ray Serve pools (see docs/MODEL_STRATEGY.md sizing)."
  type        = list(string)
  default     = ["g5.4xlarge"]
}

variable "gpu_node_max" {
  description = "Maximum GPU nodes (interactive + premium + specialist + batch pools)."
  type        = number
  default     = 4
}

variable "cost_center" {
  description = "Cost allocation tag."
  type        = string
  default     = "policy-twin"
}
