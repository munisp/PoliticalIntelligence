# Security

## Identity & access

- **OIDC via Keycloak** is the single identity plane: the PWA, API, and admin consoles authenticate with Keycloak-issued tokens. Service-to-service calls (gateway → simulation/ai) use short-lived service tokens; no shared static API keys in production.
- **RBAC roles** (realm roles, enforced at the API gateway and re-checked per domain):

| Role                  | Capabilities |
| --------------------- | ------------ |
| Executive consumer    | Read dashboards, opportunities, briefs for their jurisdiction; no raw document upload, no admin |
| Policy analyst        | + run opportunity generation, create scenarios, generate briefs, upload documents |
| Legal analyst         | + legislation workbench: compare, annotate, DeepSeek-R1 specialist analyses |
| Data steward          | + source registry, onboarding checklist sign-off, quality scores, re-index triggers |
| Simulation specialist | + advanced scenario configuration (ensemble sizes, calibration overrides), run manifests |
| Platform administrator| + environment config, user/role management, DLQ replay, all jurisdictions |

- **Fine-grained policy checks** beyond role: every request is authorized against **dataset**, **document**, and **jurisdiction** level policies (attribute-based: actor's jurisdictions × resource's `jurisdiction_id` and privacy classification). Retrieval (vector/graph/SQL) applies the same filters *before* generation, so the LLM never sees out-of-scope evidence.

## Audit

- Every API call, job, generation (incl. model routing record), and administrative action writes to the immutable **audit log** (`audit.events` → WORM object storage), with `actor_id`, correlation ids, and before/after references where applicable.
- **Retention: 7 years**, append-only, tamper-evident (checksum-chained exports). Audit access is itself audited.

## Encryption

- **In transit:** TLS everywhere — ingress, service-to-service, and to all data stores. Dev compose uses plaintext only inside the local bridge network.
- **At rest:** encrypted object storage buckets, encrypted database volumes, encrypted backups; keys managed by the cloud KMS or Vault for on-prem/sovereign deployments.

## Environment isolation

- Dev uses synthetic data only; staging uses production-like anonymized data; production is a separate, hardened deployment with NetworkPolicies, isolated event brokers per workload domain, and separate Vault paths.
- No production data flows to lower environments except through the anonymization pipeline.

## NDPC privacy posture (Nigeria reference)

- Aggregate-first: statistics and facility data carry no personal data by design; personal data requires explicit justification, classification, and safeguards at source onboarding (see `NIGERIA_PILOT.md` checklist).
- Data residency: in-country object storage and databases; all model inference is self-hosted in-country — no personal or government data leaves the deployment to third-party model APIs.
- Data subject considerations: where personal data is unavoidable (e.g. user accounts), it is minimized, encrypted, access-logged, and erasable per NDPC guidance, with the immutable audit limited to pseudonymous `actor_id`s.
- Breach response: alerting via `ops.alerts`, incident runbook owned by the platform administrator + data protection advisor on the steering committee.

## Application security practices

- Dependency and container scanning in CI; CodeQL (JS/TS + Python) on every push/PR (`.github/workflows/codeql.yml`).
- Containers run non-root with read-only root filesystems and dropped capabilities (see k8s manifests).
- Rate limiting at ingress; idempotency keys prevent duplicate-side-effect abuse; structured error envelopes leak no internals.
