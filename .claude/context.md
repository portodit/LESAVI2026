# Context — LESAVI2026

> Ditulis ulang mengikuti struktur repo saat ini. Path lama (`artifacts/api-server`,
> `artifacts/lesavi-dashboard`, `lib/db`) sudah tidak berlaku.

## Monorepo

Workspace pnpm di root. Paket utama:

| Area | Lokasi |
|---|---|
| Backend API (Express 5) | `apps/api` — paket `@workspace/api-server` |
| Dashboard (React + Vite) | `apps/dashboard` — paket `@workspace/dashboard` |
| Skema DB (Drizzle) | `packages/db/src/schema` — sumber kebenaran tunggal |
| Zod / API client | `packages/api-zod`, `packages/api-client-react` |

`lib/` berisi salinan lama paket `packages/` yang tidak lagi dipakai sebagai
sumber build — jangan diedit, tapi masih ada di repo.

## Backend

- `apps/api/src/app.ts` — komposisi Express: helmet, CORS whitelist, session
  (`connect-pg-simple`, tabel `user_sessions`), router per fitur.
- `apps/api/src/index.ts` — entrypoint: seeding, scheduler, Telegram poller.
- `apps/api/src/features/*` — modular per domain (auth, telegram, import, funnel,
  activity, performance, am, corporate, presentation, gdrive, gsheets, settings).
- `apps/api/src/shared/` — `auth.ts` (requireAuth, logAuthEvent,
  regenerateSession), `security.ts` (rahasia sesi, whitelist CORS, rate limiter),
  `publicUrl.ts`.
- Build: `apps/api/build.mjs` (esbuild, **tanpa** source map).

## Auth

- Dashboard: OTP via Telegram, sesi cookie `connect.sid` (DB-backed).
  `verifyOtp` memanggil `regenerateSession()` sebelum mengisi `userId`
  (anti session fixation).
- Presentation: **sessionless** — token acak disimpan di tabel
  `presentation_sessions`, frontend menyimpannya di `localStorage`.
- Rate limit (`shared/security.ts`): `authIpLimiter` (per IP),
  `loginAttemptLimiter` (per akun), `otpRequestLimiter`, `otpVerifyLimiter`.

## Frontend

- `apps/dashboard/src/App.tsx` — routing, guard per role.
- Role AM hanya boleh masuk lewat halaman `/presentation/login`.

## Database

- Sumber kebenaran: `packages/db/src/schema/*.ts`.
- Sinkronisasi: `scripts/db-sync.mjs` (`--check` / `--apply`).
  **`drizzle-kit push` dilarang** — merusak `user_sessions`, view `accounts`,
  constraint & index di DB produksi.
- DDL kanonik: `packages/db/sql/001_schema.sql`.

## Deploy

- Push ke branch `fresh-upload` → GitHub Actions → `scripts/deploy.sh` di VPS
  (103.183.74.104).
- Dashboard **wajib** di-build di runner Actions (VPS RAM 1.9 GB tanpa swap →
  vite build kena OOM-killer). Aset dikirim sebagai `.incoming/dashboard.tar.gz`.
- API di-build di VPS (esbuild, ringan).
- PM2: `lesavi-api`. File env produksi ada **di luar repo** di VPS.

## Konvensi

- Balas user dalam Bahasa Indonesia.
- Jangan pernah commit `.env`, `cookies*.txt`, atau skrip berisi kredensial SSH.
- File import = dump kumulatif; jangan menjumlahkan data lintas import.
