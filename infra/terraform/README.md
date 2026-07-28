# Terraform — AWS foundational infrastructure

Working AWS root module for the Policy Twin platform. Provisions:

| Module        | Purpose                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| `modules/vpc` | VPC with public subnets (ingress/NAT) and private subnets (EKS nodes, data services)         |
| `modules/eks` | EKS cluster + managed node groups: general-purpose pool and a tainted GPU pool (`g5.xlarge`) |
| `modules/s3`  | Artifacts bucket — versioning, encryption, public-access block, Object Lock (COMPLIANCE, default 7-year retention for the audit-retention NFR) |

**Status: reviewed, not applied.** No `terraform apply` has been run from
this repository yet; first apply is an ops action against a real account
(state backend + credentials below).

## Quickstart

```bash
cd infra/terraform

# 1. Init with remote state (S3 + DynamoDB lock — create them once by hand
#    or via a bootstrap stack; never commit credentials).
terraform init \
  -backend-config="bucket=policy-twin-tfstate" \
  -backend-config="key=policy-twin/dev/terraform.tfstate" \
  -backend-config="region=eu-west-1" \
  -backend-config="dynamodb_table=policy-twin-tflock" \
  -backend-config="encrypt=true"

# 2. Plan / apply per environment.
terraform plan  -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars

# prod is a separate state key and, in CI, a manual-approval environment:
terraform init -reconfigure \
  -backend-config="key=policy-twin/prod/terraform.tfstate" ...
terraform plan -var-file=environments/prod.tfvars
```

Credentials come from the environment (instance role, `AWS_PROFILE`, or CI
OIDC via `aws-actions/configure-aws-credentials`) — nothing is stored here.

## Notes

- `terraform fmt -check -recursive` / `terraform validate` were not run in
  the authoring sandbox (no terraform binary available); files are
  hand-formatted to `terraform fmt` conventions. Run both before the first
  apply.
- The S3 Object-Lock default retention cannot be lowered or disabled once
  objects are written under COMPLIANCE mode — that is the point (7-year
  WORM audit retention).
- The GPU node group carries a `nvidia.com/gpu=true:NoSchedule` taint;
  AI serving pods must tolerate it and request `nvidia.com/gpu`.
