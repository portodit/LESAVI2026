#!/bin/bash
# Deploy LESAVI ke VPS.
#   bash /var/www/lesavi/scripts/deploy.sh
# Branch: RELEASE_BRANCH (default: fresh-upload)
#
# CATATAN PENTING:
#  Dashboard (vite build) TIDAK dibangun di server. Server hanya punya RAM 1.9GB
#  tanpa swap, dan vite build akan kena OOM-killer (exit 137) yang sempat
#  mengosongkan folder public/ => situs produksi mati. Build dashboard berjalan
#  di GitHub Actions runner, lalu dikirim sebagai .incoming/dashboard.tar.gz.
#  Deploy manual: tar -czf /tmp/dashboard.tar.gz -C apps/dashboard/dist/public .
#  lalu taruh di /var/www/lesavi/.incoming/ sebelum menjalankan script ini.
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

# Aset dashboard TIDAK di-build di server (RAM 1.9GB tanpa swap -> vite build
# kena OOM-killer). Sumbernya salah satu:
#   1. tarball dari GitHub Actions di .incoming/dashboard.tar.gz (preferred), atau
#   2. apps/dashboard/dist/public yang ada di git (fallback untuk deploy manual).
ASSET_TARBALL="$APP_DIR/.incoming/dashboard.tar.gz"
ASSET_DIR="$APP_DIR/apps/dashboard/dist/public"

echo "==> [5/7] Siapkan aset dashboard"
rm -rf "$ASSET_DIR"
mkdir -p "$ASSET_DIR"
if [ -f "$ASSET_TARBALL" ]; then
  echo "    memakai aset dari GitHub Actions"
  tar xzf "$ASSET_TARBALL" -C "$ASSET_DIR" --strip-components=1
elif git cat-file -e "HEAD:apps/dashboard/dist/public/index.html" 2>/dev/null; then
  echo "    memakai aset dari git (deploy manual)"
  git checkout HEAD -- apps/dashboard/dist/public 2>/dev/null || true
else
  echo "    ERROR: tidak ada aset dashboard."
  echo "    Untuk deploy manual: pnpm --filter @workspace/dashboard run build"
  echo "    lalu commit apps/dashboard/dist/public, atau tar lalu taruh di $ASSET_TARBALL"
  exit 1
fi

if [ ! -f "$ASSET_DIR/index.html" ] || [ ! -d "$ASSET_DIR/assets" ]; then
  echo "    ERROR: aset dashboard tidak lengkap, abort (situs lama tidak disentuh)"
  exit 1
fi
# Tarball baru dibuang setelah aset dipastikan lengkap, supaya deploy yang
# gagal masih bisa diulang tanpa mengirim ulang.
rm -f "$ASSET_TARBALL"

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
cp -r "$ASSET_DIR" "$STAGE"
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
