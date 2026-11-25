#!/bin/sh
# Backup: compressed PostgreSQL dump + tarball of uploaded files, with rotation.
# Usage: backup.sh [BACKUP_DIR] [STORAGE_DIR]
# Uses standard PG* environment variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE) or DATABASE_URL.
# Copy ./backups to Google Drive / OneDrive (free) for an off-site copy — see README.
set -eu
DIR="${1:-./backups}"
STORAGE="${2:-./storage}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DIR"

if [ -n "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  pg_dump --format=custom --no-owner --file="$DIR/db_$STAMP.dump" "$DATABASE_URL"
else
  pg_dump --format=custom --no-owner --file="$DIR/db_$STAMP.dump"
fi

if [ -d "$STORAGE" ]; then
  tar -czf "$DIR/files_$STAMP.tar.gz" -C "$STORAGE" .
fi

# Remove backups older than $KEEP days
find "$DIR" -maxdepth 1 -type f \( -name 'db_*.dump' -o -name 'files_*.tar.gz' \) -mtime +"$KEEP" -exec rm -f {} \;
echo "Backup complete: $DIR/db_$STAMP.dump $( [ -d "$STORAGE" ] && echo "$DIR/files_$STAMP.tar.gz" )"
