#!/usr/bin/env node
// Regenerasi packages/db/sql/001_schema.sql dari packages/db/src/schema/*.ts
//
// Cara kerja:
//   1. jalankan `drizzle-kit generate` di folder sementara dengan baseline kosong
//      -> drizzle menulis DDL lengkap (CREATE TABLE + FK) untuk semua tabel schema
//   2. transformasi supaya idempotent: CREATE TABLE IF NOT EXISTS, dan constraint
//      FK dibungkus guard pg_constraint
//   3. tulis hasilnya ke packages/db/sql/001_schema.sql
//
// Jalankan ulang setiap schema .ts berubah. Hasilnya di-commit ke repo.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const dbPkg = path.join(repo, "packages/db");
const outFile = path.join(dbPkg, "sql/001_schema.sql");
const kitBin = path.join(dbPkg, "node_modules/drizzle-kit/bin.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lesavi-ddl-"));
fs.writeFileSync(
  path.join(tmp, "drizzle.config.cjs"),
  `module.exports = {
  schema: ${JSON.stringify(path.join(dbPkg, "src/schema/index.ts").replace(/\\/g, "/"))},
  dialect: "postgresql",
  out: "./drizzle",
};
`,
);

execFileSync(process.execPath, [kitBin, "generate", "--config", "./drizzle.config.cjs"], {
  cwd: tmp,
  stdio: "inherit",
});

const genDir = path.join(tmp, "drizzle");
const sqlFile = fs.readdirSync(genDir).find((f) => f.endsWith(".sql"));
const raw = fs.readFileSync(path.join(genDir, sqlFile), "utf8");

const blocks = raw
  .split("--> statement-breakpoint")
  .map((b) => b.trim())
  .filter(Boolean);

const header = `-- DDL KANONIK — JANGAN diedit manual.
-- Sumber kebenaran: packages/db/src/schema/*.ts
-- Regenerasi: node scripts/db-gen-ddl.mjs
--
-- Sifat: idempotent. Aman dijalankan berulang kali di DB kosong maupun DB lama.
--   * CREATE TABLE memakai IF NOT EXISTS
--   * Constraint foreign key dijaga lewat pg_constraint
--   * Kolom yang kurang ditangani oleh scripts/db-sync.mjs (ADD COLUMN IF NOT EXISTS)
`;

const out = [header, ""];
for (const block of blocks) {
  if (/^CREATE TABLE "/.test(block)) {
    out.push(block.replace(/^CREATE TABLE "/, 'CREATE TABLE IF NOT EXISTS "'));
  } else if (/^ALTER TABLE ".+" ADD CONSTRAINT "/.test(block)) {
    const name = block.match(/ADD CONSTRAINT "([^"]+)"/)[1];
    out.push(
      [
        "DO $$",
        "BEGIN",
        `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN`,
        `    ${block.replace(/;$/, "")};`,
        "  END IF;",
        "END $$;",
      ].join("\n"),
    );
  } else {
    out.push(block);
  }
  out.push("");
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=> ${path.relative(repo, outFile)} ditulis (${blocks.length} statement)`);
