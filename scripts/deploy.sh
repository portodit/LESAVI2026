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

echo "==> [6/7] Push schema DB"
if [ ! -f "$APP_DIR/.env" ]; then
  echo "    WARNING: $APP_DIR/.env tidak ada, push schema dilewati"
elif [ ! -f "$APP_DIR/packages/db/node_modules/drizzle-kit/bin.cjs" ]; then
  echo "    WARNING: drizzle-kit belum terinstall, push schema dilewati"
else
  # `drizzle-kit push` bisa memunculkan prompt persetujuan (hanji). Default
  # yang ter-highlight di SEMUA prompt drizzle-kit push adalah opsi aman:
  #   - constraint unik  -> "No, add the constraint without truncating the table"
  #   - data-loss umum  -> "No, abort"
  # Jadi cukup kirim "\r" (Enter) berkala: constraint tetap ditambahkan tanpa
  # truncate, dan statement destruktif lain di-abort (tidak ada yang berubah).
  #
  # stdin TIDAK boleh ditutup (</dev/null) karena kalau ditutup prompt akan
  # menggantung selamanya tanpa pernah terjawab.
  #
  # CATATAN: drizzle-kit internal melakukan `try { ... } catch { console.error }`
  # sehingga SQL yang GAGAL tetap menghasilkan exit code 0. Karena itu exit code
  # saja tidak cukup; output juga harus memuat penanda sukses.
  #
  # .env dibaca lewat `node --env-file` (bukan `source`) supaya nilai rahasia
  # tidak ikut ter-parse sebagai shell.
  set +e
  DB_OUT=$(cd "$APP_DIR/packages/db" && { ( for ((i=0; i<50; i++)); do sleep 4; printf '\r'; done ) | timeout 200 node --env-file="$APP_DIR/.env" ./node_modules/drizzle-kit/bin.cjs push --config ./drizzle.config.cjs --verbose; } 2>&1)
  DB_RC=$?
  set -e
  echo "$DB_OUT" | tail -30
  if [ "$DB_RC" = "124" ]; then
    echo "    ERROR: drizzle push timeout (menunggu persetujuan / hang)."
    echo "    Tidak ada perubahan yang diterapkan. Tinjau manual:"
    echo "    cd $APP_DIR/packages/db && node --env-file=$APP_DIR/.env ./node_modules/drizzle-kit/bin.cjs push --config ./drizzle.config.cjs"
    exit 1
  fi
  if [ "$DB_RC" != "0" ]; then
    echo "    ERROR: drizzle push gagal (rc=$DB_RC), deploy dibatalkan"
    exit 1
  fi
  if ! printf '%s' "$DB_OUT" | grep -qE "Changes applied|No changes detected"; then
    echo "    ERROR: drizzle push tidak menghasilkan penanda sukses."
    echo "    Kemungkinan SQL error atau statement destruktif di-abort."
    echo "    Deploy dibatalkan agar tidak lanjut dengan schema yang tidak sinkron."
    exit 1
  fi
fi

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
