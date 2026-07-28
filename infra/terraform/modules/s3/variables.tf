variable "bucket_name" {
  description = "Globally-unique artifacts bucket name."
  type        = string
}

variable "object_lock_retention_years" {
  description = "Default Object-Lock compliance-mode retention in years."
  type        = number
}
