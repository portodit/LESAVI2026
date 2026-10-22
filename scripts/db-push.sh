#!/bin/bash
# Sinkronkan schema DB dengan DDL kanonik — SENGAJA & TERPISAH dari deploy.
#
# Kenapa dipisah: perubahan schema tidak boleh diam-diam ikut deploy. Skrip ini
# dijalankan manual, setelah di-review, dan selalu idempotent.
#
# PERINGATAN: jangan pakai `drizzle-kit push` lagi. Push membandingkan schema
# dengan DB live dan bisa menjatuhkan tabel/constraint yang masih dipakai
# (mis. user_sessions untuk login). Alur resmi sekarang:
#
#   sumber kebenaran : packages/db/src/schema/*.ts
#   DDL kanonik      : packages/db/sql/001_schema.sql  (dari node scripts/db-gen-ddl.mjs)
#   sinkronisasi     : node scripts/db-sync.mjs --apply
#   verifikasi       : node scripts/db-sync.mjs --check
#
# Jalankan:
#   bash /var/www/lesavi/scripts/db-push.sh            # cek dulu (read-only)
#   bash /var/www/lesavi/scripts/db-push.sh --apply    # terapkan
set -euo pipefail

APP_DIR="/var/www/lesavi"
cd "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: $APP_DIR/.env tidak ada"
  exit 1
fi

MODE="${1:---check}"

echo "==> Mode: $MODE"
node --env-file="$APP_DIR/.env" "$APP_DIR/scripts/db-sync.mjs" "$MODE"
