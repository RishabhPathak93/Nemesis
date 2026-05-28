# Restic backup sidecar for CortexView. Runs `pg_dump` against the cv-db
# container, snapshots the resulting SQL into a restic repository, and
# repeats on a cron schedule. The branding-volume is also snapshotted.
FROM alpine:3.20

RUN apk add --no-cache restic postgresql16-client tini ca-certificates tzdata bash

COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
