output "bucket_name" {
  description = "Artifacts bucket name."
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "Artifacts bucket ARN."
  value       = aws_s3_bucket.this.arn
}
