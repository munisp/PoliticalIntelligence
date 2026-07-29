# Edge perimeter: APISIX + open-appsec (feat-mw-edge-authz)

The platform gains an edge tier in front of the Hono app. It is **additive**:
the app, the base nginx ingress, and all in-app middleware are unchanged and
remain the fallback path.

## Traffic flow

```
 client (PWA / API consumers)
   │
   ▼  TLS (cert-manager, letsencrypt-prod)
 ┌───────────────────────────────────────────┐
 │ Ingress (nginx class) — edge host entry   │
 └───────────────────────────────────────────┘
   │
   ▼
 ┌───────────────────────────────────────────┐
 │ APISIX gateway (ns `edge`, :9080)         │
 │  plugins: open-appsec → [openid-connect]  │
 │           → limit-req → cors → prometheus │
 └───────────────────────────────────────────┘
   │                     │
   ▼ (inspection)        ▼ (proxy, allowed requests)
 ┌────────────────┐   ┌──────────────────────┐
 │ open-appsec    │   │ app Service (ns      │
 │ agent (WAF,    │   │ policy-twin, :3000)  │
 │ detect/learn)  │   │ Hono + tRPC, same as │
 └────────────────┘   │ before               │
                      └──────────────────────┘
```

1. The **ingress** terminates TLS exactly as today (same ClusterIssuer,
   same class) but points at `apisix-gateway` instead of `app`.
2. **APISIX** applies the perimeter plugin chain per route
   (`infra/k8s/edge/apisix-routes.yaml`):
   - `open-appsec` — hands each request to the WAF agent for inspection;
   - `openid-connect` — *commented template*: edge-level SSO against the
     Keycloak realm (`https://keycloak.<env>.example.gov.ng/realms/policy-twin`).
     Defense-in-depth only — the app still verifies Bearer JWTs itself
     (`AUTH_PROVIDER=keycloak`, api/utils/oidc.ts);
   - `limit-req` — 50 rps / burst 20 per IP (mirrors the nginx `limit-rps`);
   - `cors` — PWA origins only;
   - `prometheus` — gateway metrics at `/apisix/prometheus/metrics`.
3. **open-appsec** runs with a local policy in **detect mode on staging**
   (log + learn, never blocks). Promote to `prevent` in
   `infra/k8s/edge/openappsec.yaml` after false-positive review.
4. Allowed requests proxy to `app.policy-twin.svc:3000` — the same Hono
   application as before.

## What replaces what

| Concern | Before (base) | With edge tier |
| --- | --- | --- |
| TLS termination | nginx ingress + cert-manager | unchanged (same ingress/issuer) |
| Rate limiting | nginx `limit-rps` annotation | APISIX `limit-req` (annotation kept as fallback) |
| CORS | in-app | APISIX `cors` plugin (in-app headers harmless) |
| SSO at the edge | none (app-only JWT verify) | optional APISIX `openid-connect` vs Keycloak |
| WAF | none | open-appsec agent, detect→prevent |
| Gateway metrics | app `/metrics` only | + APISIX prometheus plugin |
| Application | Hono app :3000 | **unchanged** |

The **current ingress (`infra/k8s/base/ingress.yaml`) is kept** as the
fallback path: reverting the DNS/host switch (or not applying
`infra/k8s/edge` at all) returns traffic to client → nginx ingress → app
with zero code changes. If the edge is rolled back but WAF coverage must
remain, attach open-appsec to the nginx ingress via the annotations
documented in `infra/k8s/edge/openappsec.yaml`.

## Deploy

```bash
kubectl apply -k infra/k8s/edge          # APISIX + etcd + routes + WAF
kubectl -n edge get pods
# Secrets: APISIX_ADMIN_KEY is pulled from Vault by ESO
# (apisix-admin-apikey ExternalSecret); add the property to the
# policy-twin/platform Vault document.
```

Compose (dev): `docker compose -f infra/docker/docker-compose.yml --profile edge up apisix openappsec`
— gateway on http://localhost:9080, admin API on :9180, WAF in detect mode
with a local policy (`infra/docker/openappsec/local_policy.yaml`).
