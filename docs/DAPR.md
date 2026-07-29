# Dapr — scoped adoption (ADR-010)

Dapr (Distributed Application Runtime) is adopted **as a sidecar integration
shim**, not as an application framework. This document defines the boundary.

## What Dapr IS used for

| Building block | Component | Backend | Purpose |
|---|---|---|---|
| Pub/sub | `infra/dapr/components/pubsub.yaml` (`pubsub.kafka`) | Redpanda | Transport abstraction over the existing topic catalog (`infra/events/topics.json`). Backend swap (managed Kafka, etc.) becomes a YAML change, not a code change. |
| State | `infra/dapr/components/statestore.yaml` (`state.redis`) | Redis | Idempotency keys, scheduler cursors, connector checkpoints for the Python services. **Not** canonical data — that stays in MySQL/PostGIS. |
| Secrets (dev) | `infra/dapr/components/secretstores.yaml` (`secretstores.local.env`) | env vars | Uniform secret access in dev; staging/prod swap the component for the external-secrets-backed store (same `metadata.name`, zero code change). |
| Service invocation | sidecar-to-sidecar, mTLS-scoped via `dapr.io/app-id` | — | Authenticated service-to-service calls between the Python services where direct HTTP is already used. |

Adoption is **opt-in per service** via pod annotations. The annotated set
today: `simulation`, `ingestion`, `documents` (see
`infra/k8s/overlays/staging/dapr-patch.yaml` — shipped commented; follow the
enablement steps in its header).

## What Dapr is NOT used for

- **No application rewrite.** Existing direct clients keep working: the Node
  API talks to Redpanda directly (`api/utils/events.ts`), the Python services
  keep their current producers. Dapr runs alongside, scoped to the building
  blocks above.
- **No Dapr actors.** `actorStateStore` is explicitly `"false"`.
- **No Dapr Workflows.** Durable orchestration is Temporal's job (see
  `docs/TEMPORAL.md`); two workflow engines would be redundant.
- **No canonical state.** Dapr state is ephemeral/operational only.
- **No mandatory control plane in dev compose.** The compose stack runs
  without Dapr; sidecars appear only where the annotations are applied.

## Enabling on staging (summary)

1. Install the Dapr control plane (`dapr init -k` or Helm).
2. `kubectl apply -f infra/dapr/components/` (after swapping the dev secret
   store for the environment-appropriate one).
3. Enable the pod annotations — convert `infra/k8s/overlays/staging/dapr-patch.yaml`
   into kustomize patches or uncomment it into the overlay resources.
