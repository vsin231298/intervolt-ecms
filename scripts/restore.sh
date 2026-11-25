#!/bin/sh
# Restore a backup made by backup.sh. THIS REPLACES THE CURRENT DATABASE AND FILES.
# Usage (Docker):  docker compose stop app jobs
#                  sh scripts/restore.sh backups/db_2026-11-25_0200.dump backups/files_2026-11-25_0200.tar.gz
#                  docker compose start app jobs
set -eu
DB_DUMP="${1:?path to db_*.dump}"
FILES="${2:-}"
printf "This will overwrite the database and uploaded files. Type RESTORE to continue: "
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U intervolt -d intervolt' < "$DB_DUMP"
if [ -n "$FILES" ]; then
  docker compose run --rm -T --no-deps --entrypoint sh -u root app -c 'tar -xzf - -C /app/storage && chown -R node:node /app/storage' < "$FILES"
fi
echo "Restore complete."
