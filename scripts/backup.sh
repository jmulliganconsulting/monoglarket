#!/bin/sh
# Nightly database backup (NFR-08). On the club host, cron: 0 3 * * * /path/to/scripts/backup.sh
# Restore once per term to prove it works: pg_restore --clean --if-exists -d clubpredict <file>
set -eu
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-./data/backups}
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U postgres -d clubpredict --format=custom > "$DIR/clubpredict-$STAMP.dump"
# keep two weeks
find "$DIR" -name 'clubpredict-*.dump' -mtime +14 -delete
echo "backup: $DIR/clubpredict-$STAMP.dump"
