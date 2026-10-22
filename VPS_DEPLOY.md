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

## Alur Deploy (OTOMATIS lewat GitHub Actions)
```
laptop: git commit && git push origin fresh-upload
   ↓ GitHub Actions runner (ubuntu-latest, RAM 7-16GB — BUKAN VPS)
   1. checkout + pnpm install --no-frozen-lockfile
   2. pnpm --filter @workspace/dashboard run build   <-- build dashboard di sini
   3. tar -> scp ke VPS: /var/www/lesavi/.incoming/dashboard.tar.gz
   ↓ SSH ke VPS, jalankan scripts/deploy.sh
   4. git fetch + git reset --hard origin/fresh-upload
   5. pnpm install --no-frozen-lockfile
   6. build API          (pnpm --filter @workspace/api-server run build)
   7. ambil aset dari .incoming/ (TIDAK build dashboard di server)
   8. swap aset dashboard + pm2 restart lesavi-api + verifikasi (rollback bila gagal)
```

**Kenapa dashboard di-build di Actions runner, bukan di VPS:** VPS cuma punya
RAM 1967 MB tanpa swap (measured: available ~813 MB). `vite build` butuh
±1.5–2 GB dan kena OOM-killer (exit 137) — efeknya bukan sekadar build gagal,
`temporary` folder aset sempat kosong dan situs produksi jadi 403. Runner
GitHub Actions bukan VPS, jadi aman.

**Kenapa tidak `pnpm run build` di root:** script itu menjalankan typecheck
dulu, dan typecheck repo ini masih gagal (`lib/api-zod`,
`packages/db/src/schema/performanceData.ts`). Workflow memanggil build per-paket
secara langsung.

> **Schema DB tidak ikut deploy.** Perubahan schema lewat alur terpisah di bawah
> — manual dan idempotent. Kalau schema berubah, jalankan `db-push.sh --apply`
> setelah deploy.

Verifikasi otomatis: `GET /api/healthz` 200, `https://lesavi-suramadu.biz.id/`
200, `pm2` `lesavi-api` online, dan checksum `public/index.html` yang dilayani
nginx harus sama dengan hasil build. Kalau gagal, aset dashboard dikembalikan ke
versi sebelumnya (rollback).

### Deploy manual (kalau perlu kontrol penuh)
```bash
# di laptop
pnpm --filter @workspace/dashboard run build
tar czf /tmp/dashboard.tar.gz -C apps/dashboard/dist/public .
scp /tmp/dashboard.tar.gz ivalora@103.183.74.104:/var/www/lesavi/.incoming/
ssh ivalora@103.183.74.104 'bash /var/www/lesavi/scripts/deploy.sh'
```
`deploy.sh` memakai `.incoming/dashboard.tar.gz` kalau ada; kalau tidak ada, ia
memakai `apps/dashboard/dist/public` yang ada di git. Kalau keduanya tidak ada,
script abort **tanpa menyentuh situs yang sedang berjalan**.

Jangan pernah menjalankan `git pull` manual di server: working tree sering dirty
karena `apps/api/dist/*` ikut ter-commit, jadi pull bisa abort. `deploy.sh`
memakai `git fetch` + `git reset --hard` yang aman terhadap dirty tree.

### GitHub Actions (`.github/workflows/deploy.yml`)
Sudah aktif. Tiap push ke `fresh-upload` menjalankan workflow di atas. Secret
`DEPLOY_SSH_KEY` (kunci ED25519 `github-actions-lesavi-deploy`) sudah dibuat
di secret repo `portodit/LESAVI2026`.

Kalau tidak ingin auto-deploy: matikan workflow di tab Actions, atau jangan
push ke `fresh-upload`.

### Menghapus `apps/dashboard/dist/public` dari git
Saat ini hasil build dashboard masih ikut ter-commit (21 file). Setelah alur
tarball → `.incoming/` stabil, folder itu bisa di-`git rm --cached` supaya repo
tidak penuh aset binaire. Jangan dihapus sebelum alur tarball terbukti jalan
beberapa kali.

### Kenapa dashboard TIDAK di-build di server
VPS cuma punya RAM 1.9 GB tanpa swap. `vite build` di server pernah kena
OOM-killer (exit 137) yang mengosongkan `public/` → situs produksi 403/mati.
Karena itu build dashboard berjalan di **GitHub Actions runner** (RAM 7–16 GB),
lalu hasilnya dikirim ke VPS sebagai `.incoming/dashboard.tar.gz`. `deploy.sh`
tidak pernah menjalankan `vite build`.

Perlu darurat (Actions down / mau deploy dari laptop):
```bash
pnpm --filter @workspace/dashboard run build
tar czf /tmp/dashboard.tar.gz -C apps/dashboard/dist/public .
scp /tmp/dashboard.tar.gz ivalora@103.183.74.104:/var/www/lesavi/.incoming/
```

### Hook post-merge di server (opsional)
Hook ini hanya memanggil `scripts/deploy.sh`; tidak ada yang memancing hook
secara otomatis. Berguna kalau nanti ada yang mengaktifkan `git pull`
berkala di server.
```bash
cd /var/www/lesavi
ln -sf /var/www/lesavi/scripts/post-merge.sh .git/hooks/post-merge
chmod +x scripts/post-merge.sh
```

## Schema DB (satu sumber kebenaran, TIDAK di-push otomatis)

### Sumber kebenaran

```
packages/db/src/schema/*.ts      <- definisi tabel (sumber kebenaran)
        |  node scripts/db-gen-ddl.mjs
        v
packages/db/sql/001_schema.sql    <- DDL kanonik, idempotent, di-commit
        |  node scripts/db-sync.mjs --apply
        v
database (lokal / VPS)            <- selalu bisa dicek: db-sync.mjs --check
```

`packages/db/sql/001_schema.sql` dibuat dari schema `.ts` oleh
`drizzle-kit generate` (baseline kosong), lalu diubah supaya idempotent:
`CREATE TABLE IF NOT EXISTS` + constraint FK dijaga `pg_constraint`.

### Larangan: jangan pakai `drizzle-kit push` lagi

Push membandingkan schema dengan DB live dan cenderung **menjatuhkan** hal yang
masih dipakai. Di DB produksi dia akan:

```
DROP TABLE "user_sessions" CASCADE   <- dipakai connect-pg-simple (login)
DROP VIEW "public"."accounts"
DROP CONSTRAINT ... (13 FK + unique)
DROP INDEX ... (17 index)
ALTER COLUMN ... SET DATA TYPE numeric(20,4)   <- precision data performa
```

File `packages/db/drizzle/*.sql` + `packages/db/drizzle/meta/_journal.json`
adalah **riwayat lama** yang tidak pernah konsisten (file 0002–0004 tidak
pernah masuk journal, sehingga `drizzle-kit migrate` hanya menjalankan
0000 & 0001). Jangan dipakai untuk sinkronisasi.

### Sinkronkan schema (manual, di luar deploy)

```bash
# di laptop: regenerate DDL kanonik setiap schema .ts berubah
node scripts/db-gen-ddl.mjs
git add packages/db/sql/001_schema.sql packages/db/src/schema
git commit -m "feat(db): update schema"

# di server (setelah repo ter-deploy):
bash /var/www/lesavi/scripts/db-push.sh            # cek dulu, read-only
bash /var/www/lesavi/scripts/db-push.sh --apply    # terapkan
```

`db-sync` hanya melakukan perubahan yang aman & idempotent:
- `CREATE TABLE IF NOT EXISTS` untuk tabel yang belum ada
- `ADD COLUMN IF NOT EXISTS` untuk kolom yang kurang
- pelebaran tipe (`varchar`→`text`, `numeric(20,4)`→`numeric(24,10)`, `real`→`numeric`)

Perubahan berisiko **dilewati dan dilaporkan**, bukan dipaksa:
- `text`→`numeric` kalau ada nilai yang bukan angka
- `varchar`→`varchar(n)` kalau ada nilai lebih panjang dari n
- timezone dengan/ tanpa zona (berbeda makna)
- kolom/tabel ekstra yang tidak ada di schema

Untuk membandingkan tanpa tersambung ke DB (mis. audit snapshot produksi):

```bash
python scripts/prod_schema_dump.py            # ambil snapshot (read-only)
node scripts/db-schema-diff.mjs <snapshot.json>
```

### Audit drift 2026-10-22

DB lokal tertinggal dari schema (13 kolom belum ada) karena `create-tables.mts`
lama masih dipakai sebagai sumber definisi tabel kedua. Setelah dibersihkan:

| Perbedaan | Lokal | VPS (sebelum) | Sumber kebenaran |
|---|---|---|---|
| `auth_logs.session_id` | ada | **belum ada** | ada di schema |
| `performance_data.*` numeric | `numeric(24,10)` | **`numeric(20,4)`** | `numeric(24,10)` |
| `performance_data.ach_rate*` | `numeric(24,16)` | **`numeric(20,10)`** | `numeric(24,16)` |
| `performance_data.proporsi` | `real` | **`text`** | `numeric(24,16)` |
| `account_managers.status` & 3 kolom telegram | `varchar` | `text` | `text` |
| `presentation_sessions.token` | `varchar(64)` | **`varchar` (tanpa batas)** | `varchar(64)` |
| `app_settings.telegram_bot_username` | `text` | **`varchar(255)`** | `text` |
| objek legacy | `presentation_session_store` | `accounts` (view), `sessions_old` | tidak ada di schema |

**Status akhir: kedua DB sudah COCOK dengan schema.** Di VPS diterapkan 16
perubahan (tambah `auth_logs.session_id`, lebarkan/selaraskan tipe numerik,
`varchar(255)`→`text`, `varchar`→`varchar(64)`), lalu objek legacy `accounts`
& `sessions_old` dihapus. Di lokal `presentation_session_store` dihapus.

Efek samping yang ikut teratasi: `apps/api/src/shared/auth.ts` selalu
menyisipkan `session_id` ke `auth_logs` (dalam try/catch), jadi di produksi
sebelum sinkronisasi audit log login gagal diam-diam karena kolomnya belum ada.

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
