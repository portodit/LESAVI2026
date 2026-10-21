#!/bin/bash
# Push schema DB ke database produksi — SENGAJA & TERPISAH dari deploy.
#
# Kenapa dipisah: DB produksi dibuat dari SQL migration + DDL aplikasi, bukan
# dari drizzle-kit push. Menjalankan push di tengah deploy berbahaya, karena
# drizzle akan DROP TABLE "user_sessions" (dipakai connect-pg-simple),
# DROP VIEW "accounts", drop constraint/index, dan mengubah precision kolom
# numerik performance_data.
#
# Perilaku script ini:
#   - non-interaktif; prompt dijawab dengan default aman
#   - opsi "truncate" SELALU ditolak
#   - ada statement data-loss (drop kolom/tabel berisi data) -> SELURUH push
#     dibatalkan, tidak ada yang berubah
#   - output harus memuat penanda sukses, kalau tidak script gagal
#
# Jalankan:
#   bash /var/www/lesavi/scripts/db-push.sh
set -euo pipefail

APP_DIR="/var/www/lesavi"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "ERROR: $APP_DIR/.env tidak ada"
  exit 1
fi
if [ ! -f "$APP_DIR/packages/db/node_modules/drizzle-kit/bin.cjs" ]; then
  echo "ERROR: drizzle-kit belum terinstall"
  exit 1
fi

# Dry-run dulu: tampilkan SQL yang akan dijalankan, tanpa eksekusi.
# `--strict` + ESC (tolak truncate) + Enter (default = "No, abort").
echo "==> Dry-run: daftar perubahan yang akan dilakukan"
cd "$APP_DIR/packages/db"
{ ( sleep 8; printf '\033'; sleep 4; for ((i=0; i<30; i++)); do sleep 3; printf '\r'; done ) \
  | timeout 120 node --env-file="$APP_DIR/.env" ./node_modules/drizzle-kit/bin.cjs \
      push --config ./drizzle.config.cjs --strict --verbose; } 2>&1 \
  | sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | grep -E '^(ALTER|CREATE|DROP|TRUNCATE|DELETE)' || true

echo
read -r -p "Lanjutkan push? ketik 'yes' untuk lanjut: " ans
if [ "$ans" != "yes" ]; then
  echo "Dibatalkan."
  exit 0
fi

echo "==> Push"
set +e
DB_OUT=$(cd "$APP_DIR/packages/db" && { ( for ((i=0; i<50; i++)); do sleep 4; printf '\r'; done ) | timeout 200 node --env-file="$APP_DIR/.env" ./node_modules/drizzle-kit/bin.cjs push --config ./drizzle.config.cjs --verbose; } 2>&1)
DB_RC=$?
set -e
echo "$DB_OUT" | tail -30

if [ "$DB_RC" = "124" ]; then
  echo "ERROR: push timeout (menunggu persetujuan / hang). Tidak ada perubahan yang diterapkan."
  exit 1
fi
if [ "$DB_RC" != "0" ]; then
  echo "ERROR: push gagal (rc=$DB_RC)"
  exit 1
fi
if ! printf '%s' "$DB_OUT" | grep -qE "Changes applied|No changes detected"; then
  echo "ERROR: push tidak menghasilkan penanda sukses (SQL error atau di-abort). Tidak ada perubahan yang diterapkan."
  exit 1
fi
echo "==> Selesai"
