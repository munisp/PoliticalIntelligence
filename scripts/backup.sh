#!/usr/bin/env bash
# backup.sh — timestamped platform backup with integrity manifest.
#
# Components:
#   1. MySQL logical dump (mysqldump) from DATABASE_URL
#   2. Audit log WORM export (audit_events dumped separately + sha256 manifest
#      so the hash chain can be replay-verified before/after archival)
#   3. Artifacts directory tar (ingestion JSONL, exports; ARTIFACTS_DIR)
#
# Output: ./backups/YYYYMMDD-HHMMSS/ with manifest.sha256 covering every file.
# Optional upload: set BACKUP_UPLOAD_URI to an rclone remote (s3:bucket/path)
# and have rclone configured; upload failures do not delete the local copy.
#
# Retention: keeps the newest 7 daily backups + the newest 4 weekly backups
# (a backup taken on Sunday also counts as the weekly one).
#
# Env: DATABASE_URL (required), BACKUP_DIR (default ./backups),
#      ARTIFACTS_DIR (default ./artifacts, skipped when absent),
#      BACKUP_UPLOAD_URI (optional rclone remote).
set -euo pipefail

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

BACKUP_ROOT="${BACKUP_DIR:-./backups}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-./artifacts}"
TS="$(date -u +%Y%m%d-%H%M%S)"
DEST="${BACKUP_ROOT}/${TS}"
mkdir -p "$DEST"

[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is required"

# Parse mysql://user:pass@host:port/db (password optional, port default 3306).
DB_URL="$DATABASE_URL"
DB_USER="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://([^:/]+)(:([^@]*))?@.*$|\1|')"
DB_PASS="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://([^:/]+)(:([^@]*))?@.*$|\3|')"
DB_HOST="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+)(:([0-9]+))?/.*$|\1|')"
DB_PORT="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+)(:([0-9]+))?/.*$|\3|')"
DB_NAME="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://[^/]+/([^?]+).*$|\1|')"
DB_PORT="${DB_PORT:-3306}"
[ -n "$DB_USER" ] && [ -n "$DB_HOST" ] && [ -n "$DB_NAME" ] \
  || die "could not parse DATABASE_URL (expected mysql://user:pass@host:port/db)"

# Prefer mysqldump; fall back to the zero-binary Node dumper
# (scripts/tidb-dump.mjs) for TiDB Cloud sandboxes / slim containers.
USE_TIDB_DUMP=0
if ! command -v mysqldump >/dev/null; then
  log "mysqldump not found — using scripts/tidb-dump.mjs fallback"
  USE_TIDB_DUMP=1
fi

# Credentials via env var, never on the command line (process list safe).
export MYSQL_PWD="$DB_PASS"
trap 'unset MYSQL_PWD' EXIT

log "dumping database ${DB_NAME} from ${DB_HOST}:${DB_PORT}"
if [ "$USE_TIDB_DUMP" -eq 1 ]; then
  DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/" \
    node "$(dirname "$0")/tidb-dump.mjs" dump "$DB_NAME" \
    | gzip > "${DEST}/mysql-${DB_NAME}.sql.gz"
else
  mysqldump --single-transaction --routines --triggers \
    -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" \
    | gzip > "${DEST}/mysql-${DB_NAME}.sql.gz"
fi

log "exporting audit log (WORM copy)"
if [ "$USE_TIDB_DUMP" -eq 1 ]; then
  DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/" \
    node "$(dirname "$0")/tidb-dump.mjs" dump "$DB_NAME" \
      --no-create-info --tables audit_events \
    | gzip > "${DEST}/audit-worm-export.sql.gz"
else
  mysqldump --single-transaction --no-create-info \
    -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" audit_events \
    | gzip > "${DEST}/audit-worm-export.sql.gz"
fi

if [ -d "$ARTIFACTS_DIR" ]; then
  log "archiving artifacts dir ${ARTIFACTS_DIR}"
  tar -czf "${DEST}/artifacts.tar.gz" -C "$(dirname "$ARTIFACTS_DIR")" \
    "$(basename "$ARTIFACTS_DIR")"
else
  log "artifacts dir ${ARTIFACTS_DIR} absent — skipped"
fi

log "writing sha256 manifest"
( cd "$DEST" && sha256sum -- * > manifest.sha256 )

cat > "${DEST}/backup.meta" <<META
timestamp_utc=${TS}
database=${DB_NAME}
host=${DB_HOST}
rpo_target=24h
rto_target=8h
components=mysql,audit-worm$( [ -d "$ARTIFACTS_DIR" ] && printf ',artifacts' )
META

if [ -n "${BACKUP_UPLOAD_URI:-}" ]; then
  if command -v rclone >/dev/null; then
    log "uploading to ${BACKUP_UPLOAD_URI}/${TS}"
    rclone copy "$DEST" "${BACKUP_UPLOAD_URI%/}/${TS}"
  else
    log "WARNING: BACKUP_UPLOAD_URI set but rclone not installed — local copy kept"
  fi
fi

# Retention: 7 daily + 4 weekly (Sunday = weekly, %u == 7).
log "applying retention policy (7 daily, 4 weekly)"
cd "$BACKUP_ROOT"
keep=""
# newest 7 directories
keep="$(ls -1d [0-9]* 2>/dev/null | sort -r | head -n 7 || true)"
# newest 4 directories whose stamp was a Sunday
weekly="$(for d in $(ls -1d [0-9]* 2>/dev/null | sort -r); do
  day="$(printf '%s' "$d" | cut -c1-8)"
  if [ "$(date -d "${day}" +%u 2>/dev/null || echo 0)" = "7" ]; then
    printf '%s\n' "$d"
  fi
done | head -n 4 || true)"
for d in $(ls -1d [0-9]* 2>/dev/null); do
  if ! printf '%s\n%s\n' "$keep" "$weekly" | grep -qx "$d"; then
    log "rotating out $d"
    rm -rf "$d"
  fi
done

log "backup complete: ${DEST}"
