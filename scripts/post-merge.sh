#!/bin/bash
# Git post-merge hook untuk auto-deploy.
#
# Hook ini TIDAK melakukan build/copy sendiri — semua logika ada di
# scripts/deploy.sh (fetch, install, build API, push schema DB, swap aset
# dashboard, restart PM2, verifikasi, rollback otomatis).
#
# Dipasang di server dengan:
#   ln -sf /var/www/lesavi/scripts/post-merge.sh /var/www/lesavi/.git/hooks/post-merge
#   chmod +x /var/www/lesavi/scripts/post-merge.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$APP_DIR/scripts/deploy.sh"
