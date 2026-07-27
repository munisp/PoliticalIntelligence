# Kubernetes Manifests (Kustomize)

Environment manifests for the Jurisdiction Economic Intelligence & Policy Twin Platform.

## Layout

```
infra/k8s/
├── base/                  # Namespace, app/simulation/ai Deployments+Services,
│                          # ingress (OIDC annotations placeholder), ConfigMap,
│                          # secrets template
└── overlays/
    ├── dev/               # 1 replica, synthetic data, Qwen3 dev model tier
    ├── staging/           # production-like + app canary deployment
    └── prod/              # hardened: 3 app replicas, NetworkPolicies,
                           # isolated event brokers per workload domain
```

Render any environment locally:

```bash
kubectl kustomize infra/k8s/overlays/dev
kubectl apply -k infra/k8s/overlays/dev
```

## Secrets

`base/secrets-template.yaml` is a **template only**. Real secrets are never
committed: materialize `platform-secrets` from Vault using the External
Secrets Operator (or sealed-secrets) per `docs/DEPLOYMENT.md`.

## GitOps promotion with Argo CD

Each overlay maps to an Argo CD `Application` in the same cluster (or separate
clusters for prod isolation):

| Application       | Path                          | Sync policy                        |
| ----------------- | ----------------------------- | ---------------------------------- |
| `policy-twin-dev` | `infra/k8s/overlays/dev`      | auto-sync on merge to `main`       |
| `policy-twin-stg` | `infra/k8s/overlays/staging`  | auto-sync on release tag `v*-rc*`  |
| `policy-twin-prod`| `infra/k8s/overlays/prod`     | manual sync (approval gate) on `v*` release tags |

Promotion flow:

1. Merge to `main` → CI builds images tagged `dev`; dev auto-syncs.
2. Cut a release candidate tag (`v1.4.0-rc1`) → images tagged `staging`;
   staging syncs, canary deployment receives a slice of traffic; SLOs and
   smoke tests are checked in Grafana/Argo Rollouts-style analysis.
3. Tag the release (`v1.4.0`) → images tagged `stable`; a platform
   administrator approves the manual prod sync in Argo CD.

Rollback: use Argo CD "History & Rollback" to the previous healthy sync —
Git remains the source of truth, so rollback is a revert + sync.
