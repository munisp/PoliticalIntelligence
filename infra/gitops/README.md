# GitOps — Argo CD

`argocd-app.yaml` declares the two Argo CD `Application` resources that
give the platform continuous delivery (ENV-4):

| Application | Source | Sync policy |
| --- | --- | --- |
| `policy-twin-staging` | `infra/k8s/overlays/staging` @ `main` | **automated** (prune + self-heal) |
| `policy-twin-prod` | `infra/k8s/overlays/prod` @ `main` | **manual** sync only |

## Relationship to CI

`.github/workflows/ci.yml` has the matching imperative path:

1. `release-gate` (main only) requires every test/build/security job green.
2. `deploy-staging` builds + pushes `ghcr.io/.../policy-twin-<svc>:sha-<sha>`
   images and runs `kubectl apply -k infra/k8s/overlays/staging`
   (requires the `KUBECONFIG_STAGING` secret in the `staging` environment;
   the step reports honestly and skips when it is absent — no fake deploy).
3. `deploy-prod` needs the manual-approval `production` GitHub environment
   and refuses to run without `KUBECONFIG_PROD`.

When Argo CD is installed, prefer it over the CI `kubectl apply` steps
(set the Argo CD Applications up and let staging auto-sync); the CI deploy
jobs remain as the bootstrap/fallback path.

## Bootstrap

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# Edit repoURL in argocd-app.yaml to the real repository, then:
kubectl apply -f infra/gitops/argocd-app.yaml
```

Image tags: use `argoproj-labs/argocd-image-updater` with an
`allow-tags: regexp:^sha-` annotation on the staging Application to track
CI-built images automatically; production tags are changed by reviewed PR.
