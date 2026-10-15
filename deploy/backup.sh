#!/bin/sh
# Daily backup of the database + chat attachments (spec 005).
# Runs inside the `backup` service (postgres image → pg_dump is available).
#   /backups/<YYYY-MM-DD>/db.dump         pg_dump custom format (restore with pg_restore)
#   /backups/<YYYY-MM-DD>/uploads.tar.gz  the attachments volume
# Keeps BACKUP_KEEP_DAYS days. `sh /backup.sh now` makes one immediately.
set -u
KEEP=${BACKUP_KEEP_DAYS:-14}
HOUR=${BACKUP_HOUR_UTC:-1}   # 01:00 UTC ≈ 03:00/04:00 Kyiv

backup() {
  d=$(date -u +%F)
  tmp="/backups/.tmp-$d"
  rm -rf "$tmp" && mkdir -p "$tmp" || return 1
  if pg_dump -Fc -f "$tmp/db.dump" && tar -C /uploads -czf "$tmp/uploads.tar.gz" . ; then
    rm -rf "/backups/$d" && mv "$tmp" "/backups/$d"
    echo "[backup] $d ok: $(du -sh "/backups/$d" | cut -f1)"
  else
    echo "[backup] $d FAILED" >&2
    rm -rf "$tmp"
    return 1
  fi
  # rotate: drop dated folders older than KEEP days
  find /backups -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime +"$KEEP" -exec rm -rf {} +
}

if [ "${1:-}" = "now" ]; then backup; exit $?; fi

echo "[backup] daily at ${HOUR}:00 UTC, keeping ${KEEP} days"
while :; do
  d=$(date -u +%F)
  h=$(date -u +%H); h=${h#0}
  if [ ! -d "/backups/$d" ] && [ "$h" -ge "$HOUR" ]; then backup || true; fi
  sleep 600
done
