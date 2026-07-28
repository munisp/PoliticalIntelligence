# Deployment & Operations

## Environment strategy

| Environment | Purpose                              | Data                              | Model tier          | Infra |
| ----------- | ------------------------------------ | --------------------------------- | ------------------- | ----- |
| Dev         | Feature work, prompt iteration       | Synthetic                         | Qwen3 dev tier      | `infra/docker` compose or `infra/k8s/overlays/dev` |
| Staging     | Release validation, canary, UAT      | Production-like (anonymized)      | Qwen3-32B           | `overlays/staging` + canary deployment |
| Prod        | Live service for government users    | Production                        | Qwen3-32B default; premium + DeepSeek-R1 specialist pools | `overlays/prod`, hardened |

Promotion: merge → dev auto-deploys; release-candidate tags → staging + canary; release tags → prod after manual approval (GitOps flow in `infra/k8s/README.md`).

## Secrets management

- All secrets live in **Vault**; Kubernetes consumes them via the External Secrets Operator (or sealed-secrets). `infra/k8s/base/secrets-template.yaml` documents required keys — real values are never committed.
- Local dev uses `infra/docker/.env` (gitignored; defaults in `.env.example`).
- Rotation: database and S3 credentials quarterly; Keycloak client secrets on personnel change; audit of Vault access enabled.

## Backup & restore

| Store        | Backup method                                             | Frequency | Retention |
| ------------ | --------------------------------------------------------- | --------- | --------- |
| MySQL        | `mysqldump`/physical snapshot to object storage           | Daily + binlog continuous | 35 days |
| Iceberg/S3   | Object versioning + cross-location replication            | Continuous | Per bucket policy (≥90 days) |
| Neo4j        | `neo4j-admin database dump`                               | Daily     | 35 days (rebuildable from lakehouse replay) |
| OpenSearch   | Snapshot to S3                                            | Daily     | 35 days (rebuildable) |
| PostGIS      | `pg_dump` + WAL archiving                                 | Daily + WAL | 35 days |
| Audit log    | Immutable, append-only export to WORM object storage      | Continuous | 7 years |
| Vault/Keycloak| Config export                                            | Weekly    | 90 days |

Restore runbook: restore object storage → MySQL/PostGIS dumps → replay events to rebuild Neo4j/OpenSearch projections → verify data source health console → resume ingest. Quarterly restore drills are mandatory.

## Disaster recovery

- **RPO ≤ 24h** (worst-case data loss one daily backup cycle; binlog/WAL + object versioning usually far better).
- **RTO ≤ 8h** for full platform restoration in a secondary location.
- Secondary site: warm-standby infrastructure definitions via Terraform (same modules, second region/in-country DR site); data replicated continuously for object storage, daily for databases.
- DR test: one full restore drill per quarter, timed against RTO.

## 90-day execution plan

### Days 1–30 — Platform bootstrap

- Environments: dev/staging clusters up via Terraform + kustomize overlays; CI/CD (`ci.yml`, CodeQL) green; Argo CD GitOps wired.
- Identity: Keycloak realms, RBAC roles, OIDC login to the PWA.
- Observability: Prometheus/Grafana/OTel stack, Platform Overview dashboard, alert rules, on-call rotation.
- MySQL + Drizzle migrations pipeline; Vault + External Secrets.

### Days 31–60 — Data backbone + document intake MVP

- Geography backbone (boundaries, hierarchy) into PostGIS/MySQL.
- Iceberg lakehouse + Trino + dbt scaffolding with data contracts.
- Redpanda topics per `EVENTS.md` with DLQs; ingest framework emitting `ingest.raw.received`.
- Document intake MVP: upload → parse → OpenSearch/Neo4j projections for bills and budgets.
- First three Nigerian sources through the onboarding checklist (`NIGERIA_PILOT.md`).

### Days 61–90 — AI serving + first opportunity workflow + e2e demo

- Qwen3-32B serving via vLLM + Ray Serve in staging with routing policy and telemetry.
- Hybrid retrieval (vector + graph + SQL) with citations.
- First end-to-end opportunity generation workflow (SME sector) incl. async jobs, `recommendations.generated`, governor dashboard cards.
- Executive brief generator alpha; data source health console live.
- **Exit demo:** a governor-facing end-to-end walkthrough on Nigerian pilot data — profile → opportunity generation → scenario → brief — with full audit trail.

## Backup/DR implementation status (added with the NFR evidence pack)

The backup/restore rows above now have concrete automation:

- `scripts/backup.sh` — daily MySQL dump (parsed from `DATABASE_URL`) +
  audit-log WORM export + artifacts tar, sha256 manifest per backup, optional
  rclone/S3 upload (`BACKUP_UPLOAD_URI`), retention rotation (7 daily, 4 weekly).
- `scripts/restore.sh` — verified restore into a scratch database
  (manifest check → load → row-count assertions → audit hash-chain replay);
  refuses to overwrite the live database.
- `docs/DR.md` — failure-scenario runbook (DB loss, region loss, service
  corruption), step-by-step recovery commands, roles, and the quarterly
  timed drill checklist used to prove RPO ≤ 24h / RTO ≤ 8h.

Remaining ops steps: schedule `scripts/backup.sh` (cron/CronJob), enable
object-lock on the backup bucket for the 7-year audit retention, and execute
the first quarterly drill.
