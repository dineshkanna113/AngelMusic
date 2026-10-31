#!/usr/bin/env bash
# Nightly database backup. Install with:  crontab -e  ->
#   30 3 * * * /srv/angelmusic/app/deploy/backup.sh >> /var/log/angelmusic-backup.log 2>&1
# The music itself is backed up by EBS snapshots (see DEPLOY.md), not by this script.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

stamp=$(date -u +%Y%m%dT%H%M%SZ)
data_dir=${DATA_DIR:-/srv/angelmusic/data}
mkdir -p "$data_dir/backups"

# A consistent snapshot taken through SQLite's backup API while the server keeps running.
docker compose exec -T app python -m app.manage backup "/data/backups/app-$stamp.db"
gzip -f "$data_dir/backups/app-$stamp.db"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp --only-show-errors "$data_dir/backups/app-$stamp.db.gz" "${BACKUP_S3_URI%/}/app-$stamp.db.gz"
fi

# Keep two weeks locally; S3 retention is set by a lifecycle rule on the bucket.
find "$data_dir/backups" -name 'app-*.db.gz' -mtime +14 -delete
echo "$(date -u) backup app-$stamp.db.gz ok"
