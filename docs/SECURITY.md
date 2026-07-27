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

---

## feat-llm-events additions

### Sovereign IdP option (Keycloak OIDC, SEC-1)

`AUTH_PROVIDER` selects the identity plane: `kimi` (default — Kimi OAuth,
unchanged) or `keycloak` (sovereign IdP). With `keycloak`, the API resolves
sessions from Keycloak-issued Bearer JWTs (`api/utils/oidc.ts`): discovery
via `${OIDC_ISSUER}/.well-known/openid-configuration`, JWKS verification via
`jose` (issuer + audience = `OIDC_CLIENT_ID` enforced). Keycloak realm roles
map onto the six platform roles
(`executive-consumer→executive`, `policy-analyst→policy_analyst`,
`legal-analyst→legal_analyst`, `data-steward→data_steward`,
`simulation-specialist→simulation_specialist`,
`platform-administrator→platform_admin`); users are provisioned on first
login as `oidc:<sub>`, so both issuers coexist in one users table.

Realm import (`infra/docker/keycloak/realm-import/policy-twin-realm.json`):
realm `policy-twin`; client `policy-twin-web` (public, Authorization Code +
PKCE S256, redirect URIs `http://localhost:3000/*`); client `policy-twin-api`
(bearer-only resource server + audience mapper); the six platform realm
roles with descriptions; default group `/policy-twin-users` with per-role
subgroups; one demo user per role (`demo-executive`, `demo-policy-analyst`,
`demo-legal-analyst`, `demo-data-steward`, `demo-simulation-specialist`,
`demo-platform-admin`) — **all passwords are `CHANGE-ME`** (dev only; rotate
before any shared environment). Session/SSO timeouts: SSO idle 30 min,
max 10 h; access tokens 15 min.

### PII redaction (AI-11)

`api/utils/pii.ts` redacts before generation and before durable storage:
(a) copilot/query inputs — tRPC input middleware in `api/middleware.ts`
redacts `query`/`question`/`prompt` fields before the AI bridge;
(b) document/field-data ingestion payloads — redacted in the
`ingest.raw.received` consumer (`api/consumers.ts`); (c) audit payloads —
derived from the same redacted inputs. Patterns (configurable +
`PII_EXTRA_PATTERNS` JSON extension): email, Nigerian phone formats
(`+234/234/0` prefixes), standalone 11-digit BVN/NIN, labeled names in free
text. Redaction events log **counts only** — matched PII is never logged,
stored, or emitted. Disable with `PII_REDACTION=off` (synthetic dev only).

### WORM audit export (SEC-4, DM-7)

`api/utils/worm.ts`: hourly interval (started with the consumers) plus the
on-demand procedure surface (`exportWormNow()` in `api/utils/worm.ts`,
exposed to operators; wiring into the auditLog router is a one-line call).
Each export
writes an append-only JSONL file + sha256 manifest
(`./artifacts/audit-worm/audit-worm-<from>-<to>.{jsonl,manifest.json}`,
`WORM_EXPORT_DIR`), chained via the running hash head which is also
checkpointed in the `audit_worm_exports` table. Files are written once
(`wx` flag) and never rewritten (WORM). `verifyWormExports()` reads back
every file and validates manifest sha256, per-event entry-hash recomputation,
and chain continuity **within and across** exports (gap detection). S3
Object Lock adapter (env-gated): `WORM_S3_BUCKET` + `@aws-sdk/client-s3`
PUTs with `ObjectLockMode=COMPLIANCE` and `WORM_RETENTION_YEARS` (default 7);
alternatively `WORM_S3_PRESIGN_URL_TEMPLATE` (with `{key}`) enables a
boto-style presigned-PUT flow with plain fetch. Retention target: 7 years.

### Event consumers & DLQ (EVT-1, EVT-2)

`createConsumer(topic, handler, {group})` in `api/utils/events.ts`: Kafka
consumer groups when `KAFKA_BROKERS` is set (exhausted messages republished
to `<topic>.dlq` and recorded in `event_dlq`), otherwise a polled
outbox-mode consumer with identical semantics (3 attempts, exponential
backoff, dead-letter rows in `event_dlq`). Real consumers wired from boot
(`EVENT_CONSUMERS=1` default): `simulations.run.completed` (recalibration
trigger + notification stub), `ingest.raw.received` (loader hook with PII
redaction), `recommendations.generated` (audit trail; webhook fan-out
already on emit), `audit.events` (throttled WORM export kick). Consumers
dedup by event id. Job hardening: the runner's lifecycle writes
`job_heartbeats`; a sweeper auto-fails jobs with no heartbeat for 10 min and
emits `ops.alerts`.
