#!/usr/bin/env bash
# Single backup pass — invoked by `entrypoint.sh` on the configured schedule.
#
# Required env:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
#   RESTIC_REPOSITORY  RESTIC_PASSWORD
# Optional env:
#   RESTIC_KEEP_DAILY  (default 7)
#   RESTIC_KEEP_WEEKLY (default 4)
#   RESTIC_KEEP_MONTHLY(default 6)
#   BRANDING_DIR       (default /data/branding — mount the cv-branding volume here)

set -euo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set (e.g. s3:s3.amazonaws.com/bucket/cortexview)}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD must be set}"
: "${PGHOST:?PGHOST must be set}"
: "${PGUSER:?PGUSER must be set}"
: "${PGPASSWORD:?PGPASSWORD must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"

KEEP_DAILY="${RESTIC_KEEP_DAILY:-7}"
KEEP_WEEKLY="${RESTIC_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${RESTIC_KEEP_MONTHLY:-6}"
BRANDING_DIR="${BRANDING_DIR:-/data/branding}"

# Initialise repo on first run (no-op if it already exists).
restic snapshots > /dev/null 2>&1 || restic init

ts="$(date -u +%Y%m%dT%H%M%SZ)"
dump="/tmp/cv-${PGDATABASE}-${ts}.sql"

echo "[$(date -u +%FT%TZ)] dumping $PGDATABASE from $PGHOST..."
pg_dump --no-owner --no-acl --clean --if-exists -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" "$PGDATABASE" > "$dump"
size="$(wc -c < "$dump")"
echo "[$(date -u +%FT%TZ)] dump complete: ${size} bytes"

echo "[$(date -u +%FT%TZ)] restic backup (postgres dump + branding volume)..."
paths=("$dump")
if [ -d "$BRANDING_DIR" ]; then paths+=("$BRANDING_DIR"); fi

restic backup --tag "cortexview" --tag "ts=${ts}" "${paths[@]}"

echo "[$(date -u +%FT%TZ)] forget+prune (keep ${KEEP_DAILY}d/${KEEP_WEEKLY}w/${KEEP_MONTHLY}m)..."
restic forget \
  --keep-daily "$KEEP_DAILY" \
  --keep-weekly "$KEEP_WEEKLY" \
  --keep-monthly "$KEEP_MONTHLY" \
  --prune

rm -f "$dump"
echo "[$(date -u +%FT%TZ)] backup pass complete"
