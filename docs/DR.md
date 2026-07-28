# Disaster Recovery Runbook

**Targets:** RPO ≤ 24h (worst-case loss = one daily backup cycle), RTO ≤ 8h
(full platform restoration in a secondary location). These targets come from
`docs/DEPLOYMENT.md`; this runbook is the executable procedure plus the drill
checklist that proves them.

| Component | Backup | Frequency | Retention |
| --------- | ------ | --------- | --------- |
| MySQL (operational DB) | `scripts/backup.sh` → `mysqldump --single-transaction` + gzip (falls back to the zero-binary Node dumper `scripts/tidb-dump.mjs` when mysqldump/mysql are absent, e.g. TiDB Cloud sandboxes) | Daily (cron/GitOps scheduler) | 7 daily + 4 weekly |
| Audit log | WORM export (`audit-worm-export.sql.gz` inside every backup) + sha256 manifest | With every backup | 7 years (object-lock on the upload bucket) |
| Artifacts (ingestion JSONL, exports) | `artifacts.tar.gz` inside every backup | Daily | Same rotation |
| Iceberg/S3, Neo4j, OpenSearch, PostGIS | Per `docs/DEPLOYMENT.md` (versioning/replication; rebuildable from replay) | Continuous/Daily | ≥35 days |

Every backup directory contains `manifest.sha256`; restore *refuses* to run
when verification fails.

## Roles

| Role | Responsibility |
| ---- | -------------- |
| Incident commander (platform_admin on-call) | Declares DR, coordinates, owns the RTO clock |
| Data steward | Runs backup/restore, verifies the audit chain, signs off data integrity |
| Comms lead (executive sponsor) | Stakeholder/user communication during outage |
| Scribe | Timestamps every step for the post-drill/post-incident report |

## Scenario 1 — Database loss (primary MySQL corrupt/gone)

1. Declare DR; stop ingest and the API to prevent split-brain writes.
2. Identify the newest good backup: `ls backups/ | tail -1` (local) or list the
   upload bucket (`rclone ls <BACKUP_UPLOAD_URI>`).
3. Provision a fresh MySQL 8 instance in the recovery location.
4. Verified restore (integrity-checked):
   ```bash
   DATABASE_URL=mysql://user:pass@<recovery-host>:3306/<db> \
   RESTORE_DATABASE_URL=mysql://user:pass@<recovery-host>:3306/<db> \
     scripts/restore.sh backups/<timestamp>
   ```
   In a real incident the scratch guard is overridden by pointing
   `RESTORE_DATABASE_URL` at the new production DB name after the drill-style
   verification into `<db>_restore_check` has passed.
5. Re-point `DATABASE_URL` (Vault secret) to the recovery instance, restart the
   API, confirm `/healthz` and `/v1/health`.
6. Rebuild derived stores: replay events from `event_outbox`/audit trail into
   Neo4j/OpenSearch projections (see DEPLOYMENT.md restore order); re-run
   ingest for sources fresher than the backup (closes the RPO gap).
7. Run the smoke gate: `node tests/e2e/e2e.mjs` and
   `node tests/perf/local-bench.mjs --smoke` against the recovered stack.
8. Data steward replays the audit chain (`auditLog.verify`) and countersigns.

## Scenario 2 — Region loss (whole primary site unavailable)

1. Declare DR; fail DNS/ingress to the warm-standby site (Terraform modules in
   the DR region per `docs/DEPLOYMENT.md`).
2. Object storage (Iceberg/artifacts/backups) is already replicated; databases
   restore from the newest replicated backup as in Scenario 1, steps 3–8.
3. Rotate secrets if the region loss is security-relevant (Vault: DB and S3
   credentials), redeploy Keycloak realm config from the weekly config export.
4. Expected timing: infrastructure 1–2h, DB restore ≤2h, replay/rebuild ≤3h,
   verification ≤1h — inside the 8h RTO.

## Scenario 3 — Service corruption (bad deploy / data poisoning, DB intact)

1. Roll back the deployment (GitOps: revert the release tag; Argo CD sync).
2. If canonical data was corrupted: identify the corruption window from the
   audit trail, restore into a scratch DB (`scripts/restore.sh`, default
   `<db>_restore_check` target), and surgically copy back unaffected rows —
   or replay ingest from provenance (every canonical row carries
   `origin`/`source_url`/`fetched_at`).
3. Verify: audit chain replay + `tests/e2e/e2e.mjs` green before reopening
   traffic.

## Quarterly DR drill checklist (timed against RTO)

- [ ] Pick the newest backup; record its age (must be ≤ 24h → proves RPO).
- [ ] `sha256sum --check manifest.sha256` passes.
- [ ] `scripts/restore.sh` into a scratch DB completes; record wall time.
- [ ] Row-count assertions pass (script output).
- [ ] Audit hash chain replay reports `chain_valid: true`; WORM export file
      hash matches the manifest (7-year retention evidence).
- [ ] API started against the scratch DB; `node tests/e2e/e2e.mjs` green.
- [ ] `node tests/perf/local-bench.mjs --smoke` meets NFR thresholds.
- [ ] Drill report filed: backup age, restore time vs 8h RTO, gaps, actions.

## Automation

`scripts/backup.sh` is designed for a daily cron / Kubernetes CronJob:

```bash
DATABASE_URL=... BACKUP_UPLOAD_URI=s3:policy-twin-backups/prod \
  scripts/backup.sh
```

Upload failures never remove the local copy; retention rotation (7 daily,
4 weekly) runs at the end of every successful backup.
