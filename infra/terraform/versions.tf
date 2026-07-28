terraform {
  required_version = "~> 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state is configured per environment at init time; never commit
  # credentials. Example:
  #
  #   terraform init \
  #     -backend-config="bucket=policy-twin-tfstate" \
  #     -backend-config="key=policy-twin/dev/terraform.tfstate" \
  #     -backend-config="region=eu-west-1" \
  #     -backend-config="dynamodb_table=policy-twin-tflock" \
  #     -backend-config="encrypt=true"
  #
  # backend "s3" {}
}
