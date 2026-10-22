#!/bin/bash
# Deploy LESAVI ke VPS.
#   bash /var/www/lesavi/scripts/deploy.sh
# Branch: RELEASE_BRANCH (default: fresh-upload)
#
# CATATAN PENTING:
#  Dashboard (vite build) TIDAK dibangun di server. Server hanya punya RAM 1.9GB
#  tanpa swap, dan vite build akan kena OOM-killer (exit 137) yang sempat
#  mengosongkan folder public/ => situs produksi mati. Build dashboard dilakukan
#  di laptop, hasilnya (apps/dashboard/dist/public) ikut di-commit & push.
set -euo pipefail

APP_DIR="/var/www/lesavi"
BRANCH="${RELEASE_BRANCH:-fresh-upload}"
cd "$APP_DIR"

echo "==> [1/7] Fetch origin/$BRANCH"
git fetch origin "$BRANCH"

echo "==> [2/7] Reset ke origin/$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> [3/7] Install dependencies"
pnpm install --no-frozen-lockfile

echo "==> [4/7] Build API"
pnpm --filter @workspace/api-server run build

if [ ! -f "$APP_DIR/apps/dashboard/dist/public/index.html" ]; then
  echo "    ERROR: apps/dashboard/dist/public tidak ada di git."
  echo "    Build dashboard di laptop dulu: pnpm --filter @workspace/dashboard run build"
  echo "    lalu commit + push apps/dashboard/dist/public."
  exit 1
fi
echo "==> [5/7] Dashboard build diambil dari git (tidak di-build di server)"

echo "==> [6/7] Schema DB: tidak di-push otomatis (lihat catatan di bawah)"
cat <<'NOTES'
    DB produksi TIDAK dikelola oleh drizzle-kit push. History-nya dibuat dari
    SQL migration + DDL yang dijalankan aplikasi, sehingga constraint, index,
    dan precision kolomnya berbeda dari file schema di repo.

    `drizzle-kit push` tidak boleh dipakai lagi: di DB produksi drizzle akan
    DROP TABLE "user_sessions" (dipakai connect-pg-simple untuk session login),
    DROP VIEW "accounts", drop 13 FK/unique constraint, drop 17 index, dan
    mengubah precision kolom numerik performance_data (numeric(24,10) ->
    numeric(20,4)) — itu berisiko merusak data.

    Alur resmi sekarang (sumber kebenaran: packages/db/src/schema/*.ts):
      node scripts/db-gen-ddl.mjs        # regenerate DDL kanonik (di laptop)
      bash /var/www/lesavi/scripts/db-push.sh            # cek (read-only)
      bash /var/www/lesavi/scripts/db-push.sh --apply    # terapkan
    db-sync hanya mengubah yang aman (ADD COLUMN, perluasan tipe) dan
    melewati perubahan berisiko untuk diperiksa manual.
NOTES

echo "==> [7/7] Swap aset dashboard ke nginx + restart API"
STAGE="$APP_DIR/public.new"
BACKUP="$APP_DIR/public.old"
rm -rf "$STAGE"
cp -r "$APP_DIR/apps/dashboard/dist/public" "$STAGE"
if [ ! -f "$STAGE/index.html" ] || [ ! -d "$STAGE/assets" ]; then
  echo "    ERROR: build dashboard tidak lengkap, abort (situs lama tidak disentuh)"
  exit 1
fi
rm -rf "$BACKUP"
mv "$APP_DIR/public" "$BACKUP"
mv "$STAGE" "$APP_DIR/public"

pm2 restart lesavi-api
sleep 3

echo "==> Verifikasi"
OK=1
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8081/api/healthz" || echo 000)
echo "    api /api/healthz -> $CODE"
[ "$CODE" = "200" ] || OK=0
CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://lesavi-suramadu.biz.id/" || echo 000)
echo "    situs           -> $CODE"
[ "$CODE" = "200" ] || OK=0

if [ "$OK" != "1" ]; then
  echo "==> VERIFIKASI GAGAL, rollback ke aset sebelumnya"
  rm -rf "$APP_DIR/public"
  mv "$BACKUP" "$APP_DIR/public"
  pm2 restart lesavi-api
  exit 1
fi

rm -rf "$BACKUP"
pm2 save
echo "==> Selesai. HEAD: $(git log --oneline -1)"
