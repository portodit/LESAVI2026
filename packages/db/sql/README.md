# DDL Kanonik

Folder ini berisi SQL yang **satu-satunya** sumber perubahan schema database
(selain `packages/db/src/schema/*.ts` yang jadi sumber kebenaran).

| File | Isi |
|---|---|
| `001_schema.sql` | `CREATE TABLE IF NOT EXISTS` untuk semua tabel di schema + constraint FK |

## Alur

```
ubah packages/db/src/schema/*.ts
   ↓  node scripts/db-gen-ddl.mjs      (di laptop)
001_schema.sql ditulis ulang
   ↓  git add packages/db/sql/001_schema.sql && commit
   ↓  bash scripts/db-push.sh --apply   (di server / lokal)
database ikut berubah
```

## Aturan

- `001_schema.sql` **tidak diedit manual**. Selalu regenerate.
- Semua statement wajib idempotent (`IF NOT EXISTS` / guard `pg_constraint`).
- Verifikasi: `node scripts/db-sync.mjs --check` (read-only).
- Jangan pakai `drizzle-kit push` — dia membandingkan dengan DB live dan bisa
  menjatuhkan tabel yang masih dipakai (lihat `VPS_DEPLOY.md`).
- Folder `packages/db/drizzle/` berisi riwayat lama yang tidak konsisten dengan
  `_journal.json`; jangan dipakai untuk sinkronisasi.
