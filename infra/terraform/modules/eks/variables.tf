variable "name_prefix" {
  description = "Prefix for all resource names (also the cluster name)."
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the cluster and node groups."
  type        = list(string)
}

variable "node_instance_types" {
  description = "Instance types for the default managed node group."
  type        = list(string)
}

variable "node_desired_size" {
  description = "Desired node count for the default managed node group."
  type        = number
}

variable "enable_gpu_node_group" {
  description = "Provision the tainted GPU managed node group."
  type        = bool
}

variable "gpu_instance_types" {
  description = "Instance types for the GPU managed node group."
  type        = list(string)
}
