#!/usr/bin/env bash
# restore.sh — verified restore of a backup produced by scripts/backup.sh
# into a SCRATCH database, with integrity checks. Never restores over the
# live database: point DATABASE_URL at the scratch DB for the drill.
#
# Usage:
#   scripts/restore.sh backups/20250101-000000
#
# Env:
#   DATABASE_URL          — source backup coordinates fallback (host/user/pass)
#   RESTORE_DATABASE_URL  — scratch target (default: same server, db name
#                           "<source>_restore_check"); must NOT equal the live DB
#
# Checks performed:
#   1. manifest.sha256 verifies for every backup file
#   2. dump loads into the scratch DB
#   3. row-count assertions on core tables (> 0 rows where seed guarantees data)
#   4. audit hash chain replay (scripts/verify-audit-chain against scratch DB)
set -euo pipefail

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "usage: scripts/restore.sh <backup-dir>"

# Prefer the mysql client; fall back to the zero-binary Node loader
# (scripts/tidb-dump.mjs) for TiDB Cloud sandboxes / slim containers.
USE_TIDB_DUMP=0
if ! command -v mysql >/dev/null; then
  log "mysql client not found — using scripts/tidb-dump.mjs fallback"
  USE_TIDB_DUMP=1
fi
TIDB_DUMP="$(dirname "$0")/tidb-dump.mjs"

# mysql_exec <db-or-empty> <sql> — run SQL, rows as TSV on stdout.
# (Credentials below are parsed before this is ever called.)
mysql_exec() {
  local db="$1" sql="$2"
  if [ "$USE_TIDB_DUMP" -eq 1 ]; then
    DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/" \
      node "$TIDB_DUMP" exec "${db:-information_schema}" "$sql" 2>/dev/null
  else
    mysql -N -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${db:+"$db"} -e "$sql"
  fi
}

log "verifying manifest"
( cd "$SRC" && sha256sum --check manifest.sha256 ) || die "manifest verification failed"

DUMP="$(ls "$SRC"/mysql-*.sql.gz 2>/dev/null | head -n 1)"
[ -n "$DUMP" ] || die "no mysql dump found in $SRC"

# Parse source credentials from DATABASE_URL.
DB_URL="${DATABASE_URL:-}"
[ -n "$DB_URL" ] || die "DATABASE_URL is required (source host credentials)"
DB_USER="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://([^:/]+)(:([^@]*))?@.*$|\1|')"
DB_PASS="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://([^:/]+)(:([^@]*))?@.*$|\3|')"
DB_HOST="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+)(:([0-9]+))?/.*$|\1|')"
DB_PORT="$(printf '%s' "$DB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+)(:([0-9]+))?/.*$|\3|')"
DB_PORT="${DB_PORT:-3306}"
SRC_DB="$(basename "$DUMP" | sed -E 's/^mysql-(.*)\.sql\.gz$/\1/')"

# Scratch target: explicit RESTORE_DATABASE_URL wins; else derived name.
if [ -n "${RESTORE_DATABASE_URL:-}" ]; then
  TARGET_DB="$(printf '%s' "$RESTORE_DATABASE_URL" | sed -E 's|^mysql://[^/]+/([^?]+).*$|\1|')"
else
  TARGET_DB="${SRC_DB}_restore_check"
fi
[ "$TARGET_DB" != "$SRC_DB" ] || die "refusing to restore over the live database ($SRC_DB)"

export MYSQL_PWD="$DB_PASS"
trap 'unset MYSQL_PWD' EXIT

log "creating scratch database ${TARGET_DB} on ${DB_HOST}:${DB_PORT}"
mysql_exec "" "DROP DATABASE IF EXISTS \`${TARGET_DB}\`"
mysql_exec "" "CREATE DATABASE \`${TARGET_DB}\`"

log "loading dump (this is the timed RTO step in a drill)"
if [ "$USE_TIDB_DUMP" -eq 1 ]; then
  DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/" \
    node "$TIDB_DUMP" load "$TARGET_DB" "$DUMP"
else
  gunzip -c "$DUMP" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$TARGET_DB"
fi

log "row-count assertions"
fail=0
for table in jurisdictions admin_units sector_metrics opportunities users audit_events; do
  n="$(mysql_exec "$TARGET_DB" "SELECT COUNT(*) FROM \`${table}\`;" || echo ERR)"
  if [ "$n" = "ERR" ]; then
    printf '[restore]   table %-20s MISSING\n' "$table"
    fail=1
  else
    printf '[restore]   table %-20s %s rows\n' "$table" "$n"
    [ "$n" -gt 0 ] || fail=1
  fi
done
[ "$fail" -eq 0 ] || die "row-count assertions failed"

log "replaying audit hash chain against scratch DB"
RESTORE_URL="mysql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${TARGET_DB}"
# Temp .mts placed in the repo root so the relative import resolves.
VERIFY_MTS="./.restore-verify-$$.mts"
trap 'unset MYSQL_PWD; rm -f "$VERIFY_MTS"' EXIT
cat > "$VERIFY_MTS" <<'EOF'
import { verifyAuditChain } from "./api/utils/auditchain";
const r = await verifyAuditChain();
console.log("[restore]   audit chain:", JSON.stringify(r));
process.exit(r.chain_valid ? 0 : 1);
EOF
if DATABASE_URL="$RESTORE_URL" npx tsx "$VERIFY_MTS"; then
  log "audit chain intact"
else
  die "audit chain verification failed (tamper-evidence check)"
fi

log "verified restore complete — scratch DB: ${TARGET_DB}"
log "drill teardown: mysql -e 'DROP DATABASE \`${TARGET_DB}\`'"
