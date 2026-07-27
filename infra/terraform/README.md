# Terraform — Foundational Infrastructure (stubs)

Stub root module for the platform's foundational cloud resources:

| Module            | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `network`         | VPC/VNet with public (ingress) + private (workload/data) subnets |
| `object_storage`  | Versioned, encrypted bucket for documents, Iceberg lakehouse, backups |
| `kubernetes`      | Managed K8s cluster (system / worker / GPU node groups)          |

These modules are intentionally **provider-neutral stubs**: `./modules/*`
directories are not vendored here. Before the first `terraform apply`,
implement each module for the chosen cloud (`var.cloud_provider`) or swap
`source` for a vetted registry module (e.g. `terraform-aws-modules/vpc/aws`,
`terraform-aws-modules/eks/aws`).

## Usage

```bash
cd infra/terraform
terraform init
terraform plan -var="environment=dev" -var="region=<your-region>"
terraform apply -var="environment=dev" -var="region=<your-region>"
```

## Conventions

- No credentials in this repo. Use environment variables or a CI OIDC role.
- Remote state with locking (see commented `backend` block in `main.tf`).
- One state per environment: `dev`, `staging`, `prod` workspaces or
  separate state keys — never share state across environments.
- Sovereign deployments: set `var.region` to an in-country region and keep
  state in-country as well.
- GPU node pools are tainted (`workload=gpu:NoSchedule`) and sized per
  `docs/MODEL_STRATEGY.md`; data services (MySQL, OpenSearch, Neo4j, PostGIS,
  Redpanda) run as managed services or in-cluster per `docs/DEPLOYMENT.md`.
