// Bootstrap database kosong.
//
// SEBELUMNYA file ini berisi CREATE TABLE manual dengan definisi lama
// (mis. tabel "master_am" yang sudah tidak ada di schema, kolom-kolom yang
// sudah berubah) — itu jadi salah satu sumber drift. Sekarang definisi tabel
// hanya ada di satu tempat: packages/db/src/schema/*.ts, yang di-generate
// menjadi packages/db/sql/001_schema.sql.
//
// Jalankan: node --env-file=.env packages/db/create-tables.mts
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ddlPath = path.resolve(import.meta.dirname, "sql/001_schema.sql");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL belum di-set. Jalankan dengan --env-file=.env");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const ddl = fs.readFileSync(ddlPath, "utf8");
  await pool.query(ddl);
  console.log("Tabel dibuat dari packages/db/sql/001_schema.sql");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
