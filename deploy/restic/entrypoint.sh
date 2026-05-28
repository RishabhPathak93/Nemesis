#!/usr/bin/env bash
# Loop forever, sleeping until the next BACKUP_SCHEDULE_SECONDS interval. We
# avoid bringing in cron specifically — keeping the image tiny + sticking to
# bash makes operator debugging easier.
#
# BACKUP_SCHEDULE_SECONDS default = 86400 (daily). Set to e.g. 3600 for hourly.
# RUN_ONCE=true skips the loop and exits after a single backup pass — handy
# for on-demand runs via `docker compose run --rm restic`.

set -euo pipefail

INTERVAL="${BACKUP_SCHEDULE_SECONDS:-86400}"
RUN_ONCE="${RUN_ONCE:-false}"

if [ "$RUN_ONCE" = "true" ]; then
  /usr/local/bin/backup.sh
  exit $?
fi

# Optional jitter so multiple clusters don't all hit the bucket at the same second.
JITTER="$((RANDOM % 30))"
echo "[restic-sidecar] starting; interval=${INTERVAL}s jitter=${JITTER}s"
sleep "$JITTER"

while :; do
  if /usr/local/bin/backup.sh; then
    echo "[restic-sidecar] sleeping ${INTERVAL}s before next pass..."
  else
    echo "[restic-sidecar] backup failed; will retry in ${INTERVAL}s"
  fi
  sleep "$INTERVAL"
done
