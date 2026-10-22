#!/usr/bin/env node
// Bandingkan snapshot skema DB (hasil dump information_schema) dengan DDL kanonik.
//
//   node scripts/db-schema-diff.mjs <snapshot.json>
//
// Snapshot diambil dengan query read-only ke information_schema (lihat
// scripts/prod_schema_dump.py). Perbandingan murni lokal — tidak ada koneksi DB.

import fs from "node:fs";
import path from "node:path";
import { parseCanonical, compareSnapshot, formatReport } from "./db-sync.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const snapshotFile = process.argv[2];
if (!snapshotFile) {
  console.error("Pakai: node scripts/db-schema-diff.mjs <snapshot.json>");
  process.exit(2);
}

const canonical = parseCanonical(
  fs.readFileSync(path.join(repo, "packages/db/sql/001_schema.sql"), "utf8"),
);
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
const rows = snapshot.columns ?? snapshot;

const p = compareSnapshot(canonical, rows);
console.log(`\nSnapshot : ${snapshotFile}`);
console.log(`Tabel di snapshot : ${new Set(rows.map((r) => r.table_name)).size}`);
console.log("\nSelisih vs schema:");
console.log(formatReport(p));

const clean = !p.missingTables.length && !p.missingColumns.length && !p.typeMismatches.length;
console.log(`\nHasil : ${clean ? "COCOK dengan schema" : "PERLU DISINKRONKAN"}\n`);
process.exit(clean ? 0 : 1);
