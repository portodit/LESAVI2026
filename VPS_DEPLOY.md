# VPS Deployment Guide — LESAVI-SURAMADU

## VPS Credentials
```
Host: 103.183.74.104
User: ivalora
Password: (lihat scripts/ssh_connect.py)
SSH Port: 22
```
> Password tidak ditulis di dokumen ini. Sumbernya `scripts/ssh_connect.py`.

## Layout Produksi (yang benar)
```
Project / git repo : /var/www/lesavi
Frontend (nginx)   : /var/www/lesavi/public
Branch rilis       : fresh-upload
PM2 process        : lesavi-api  (port 8081)
Nginx root         : /var/www/lesavi/public
Auto-deploy hook   : /var/www/lesavi/.git/hooks/post-merge
```

> Dokumen ini pernah memakai layout lama (`/home/ivalora/LESAVI-SURAMADU`, port
> 8080, pm2 `lesavi-suramadu`). Semua itu sudah tidak berlaku.

## Alur Deploy (otomatis)
```
laptop: git push origin fresh-upload
   ↓
server: git pull origin fresh-upload
   ↓ post-merge hook
server: scripts/deploy.sh
   1. git fetch origin fresh-upload
   2. git reset --hard origin/fresh-upload
   3. pnpm install --no-frozen-lockfile
   4. build API          (pnpm --filter @workspace/api-server run build)
   5. dashboard dari git (TIDAK di-build di server)
   6. push schema DB     (drizzle-kit push)
   7. swap aset dashboard + pm2 restart lesavi-api + verifikasi
```

Verifikasi otomatis: `GET /api/healthz` harus 200 dan `https://lesavi-suramadu.biz.id/`
harus 200. Kalau gagal, aset dashboard dikembalikan ke versi sebelumnya (rollback).

### Kenapa dashboard TIDAK di-build di server
VPS cuma punya RAM 1.9 GB tanpa swap. `vite build` di server pernah kena
OOM-killer (exit 137) yang mengosongkan `public/` → situs produksi 403/mati.
Karena itu build dashboard dilakukan di laptop, lalu hasilnya
(`apps/dashboard/dist/public`) ikut di-commit & di-push.

```bash
# di laptop, sebelum push
pnpm --filter @workspace/dashboard run build
git add apps/dashboard/dist/public
git commit -m "..."
```

### Hook post-merge di server
```bash
cd /var/www/lesavi
ln -sf /var/www/lesavi/scripts/post-merge.sh .git/hooks/post-merge
chmod +x scripts/post-merge.sh
```

## Schema DB (TIDAK di-push otomatis)
`drizzle-kit push` **tidak** dijalankan di tengah deploy. DB produksi dibuat
dari SQL migration + DDL aplikasi, jadi constraint/index/precision-nya
berbeda dari file schema di repo. Preview read-only menunjukkan push akan
menjalankan:

```
DROP TABLE "user_sessions" CASCADE   <- dipakai connect-pg-simple (login)
DROP TABLE "sessions_old" CASCADE
DROP VIEW "public"."accounts"
DROP CONSTRAINT ... (13 FK + unique)
DROP INDEX ... (17 index)
ALTER COLUMN ... SET DATA TYPE numeric(20,4)   <- precision data performa
```

Kalau memang perlu sinkronkan schema, jalankan manual (dry-run dulu, tolak
truncate, batalkan push bila ada data-loss):

```bash
bash /var/www/lesavi/scripts/db-push.sh
```

Config drizzle wajib `.cjs` (bukan `.ts`/`.mts`): drizzle-kit memuat file
config lewat `require()`, sedangkan package ini `"type": "module"`. Path
schema di config harus relatif karena glob drizzle-kit tidak bisa menangani
separator path Windows.

Catatan permission DB: owner asli `telegram_bulk_links` adalah `postgres`,
sehingga role aplikasi `lesavi` tidak bisa membacanya (push mentok dengan
"permission denied"). Sudah diperbaiki dengan GRANT, bukan ganti owner.

## Database Credentials
```
Database: lesavi_db
User: postgres
Host: 127.0.0.1:5432
```
> Password DB ada di `/var/www/lesavi/.env` (`DATABASE_URL`), tidak ditulis di dokumen ini.

## Important: How This Project Works

### Login uses `account_managers` table (NOT `admin_users`)
The login API queries `account_managers` table, so admin users must be inserted there:
```sql
INSERT INTO account_managers (nik, nama, slug, email, password_hash, role, tipe, divisi, witel, aktif)
VALUES ('admin', 'Administrator', 'admin', 'email@example.com', '$2b$10$...', 'ADMIN', 'ADMIN', 'DPS', 'SURAMADU', true)
ON CONFLICT (nik) DO UPDATE SET ...;
```

### Password Hashing
- Uses **bcrypt** via `bcryptjs`
- Prefix must be `$2b$` (Node.js v24 generates `$2y$` by default — use Python `bcrypt` to generate hashes)
- Never generate hashes with `node -e "require('bcryptjs')..."` on this VPS — it produces incompatible `$2y$` hashes

## Environment Variables
File `.env` ada di `/var/www/lesavi/.env` (isi lengkapnya tidak ditulis di
dokumen ini; `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`).

`.env` tidak di-commit (sudah ada di `.gitignore`).

## PM2 Commands
```bash
pm2 list                 # show all processes
pm2 logs lesavi-api      # view logs
pm2 restart lesavi-api   # restart
pm2 save                  # save process list
```

## NPM/PNPM Issues on VPS

### Lockfile Mismatch
If `pnpm install --frozen-lockfile` fails:
```bash
pnpm install --no-frozen-lockfile
```

### Missing Dependencies
Root `node_modules` may be incomplete. Run:
```bash
pnpm install
```

## Adding Admin User via DB
```bash
# Generate bcrypt hash locally:
python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt(10)).decode())"

# Then on VPS:
sudo -u postgres psql -d lesavi_db -c "INSERT INTO account_managers (...) VALUES (...)"
```

## File Locations
- Project / git repo: `/var/www/lesavi/`
- Frontend (nginx): `/var/www/lesavi/public/`
- PM2 logs: `/home/ivalora/.pm2/logs/`
- Nginx config: `/etc/nginx/sites-available/lesavi`
