#!/usr/bin/env node
// db-sync: menyamakan database dengan DDL kanonik + memverifikasinya.
//
//   node scripts/db-sync.mjs --check    (default) bandingkan DB vs schema, tanpa mengubah apa pun
//   node scripts/db-sync.mjs --apply    jalankan DDL kanonik + perbaiki kolom/tipe yang menyimpang
//   node scripts/db-sync.mjs --drop-legacy  hapus objek legacy (view/tabel sisa) — opsional
//
// Exit code: 0 = cocok, 1 = masih ada selisih.
//
// DATABASE_URL diambil dari environment (node --env-file=.env scripts/db-sync.mjs ...).
// DDL kanonik dibaca dari packages/db/sql/001_schema.sql, atau dari env
// CANONICAL_SQL_B64 (base64) supaya skrip yang sama bisa dijalankan di server.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const repo = import.meta.dirname ? path.resolve(import.meta.dirname, "..") : process.cwd();
const canonicalFile = path.join(repo, "packages/db/sql/001_schema.sql");

export const LEGACY_OBJECTS = {
  accounts: "view sisa implementasi lama (tidak ada di schema)",
  sessions_old: "tabel session sisa (connect-pg-simple pernah pakai nama ini)",
  presentation_session_store: "tabel session store lama (sekarang pakai user_sessions)",
};

const TYPE_PATTERNS = [
  ["numeric", /^numeric\(\s*\d+\s*,\s*\d+\s*\)/i],
  ["character varying", /^character varying\(\s*\d+\s*\)/i],
  ["varchar", /^varchar\(\s*\d+\s*\)/i],
  ["timestamp with time zone", /^timestamp with time zone/i],
  ["timestamp without time zone", /^timestamp without time zone/i],
  ["double precision", /^double precision/i],
  ["character varying", /^character varying/i],
  ["varchar", /^varchar\b/i],
  ["timestamp", /^timestamp/i],
  ["text", /^text/i],
  ["jsonb", /^jsonb/i],
  ["json", /^json/i],
  ["serial", /^serial/i],
  ["bigint", /^bigint/i],
  ["smallint", /^smallint/i],
  ["integer", /^integer/i],
  ["boolean", /^boolean/i],
  ["real", /^real/i],
  ["date", /^date/i],
  ["uuid", /^uuid/i],
];

export function parseCanonical(sql) {
  const tables = new Map();
  const re = /CREATE TABLE IF NOT EXISTS "([^"]+)" \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const table = m[1];
    const cols = new Map();
    for (const rawLine of m[2].split("\n")) {
      const line = rawLine.trim();
      const cm = line.match(/^"([^"]+)"\s+(.*)$/);
      if (!cm) continue;
      const name = cm[1];
      const rest = cm[2];
      let type = null;
      for (const [, pat] of TYPE_PATTERNS) {
        const tm = rest.match(pat);
        if (tm) {
          type = tm[0].replace(/\s+/g, " ").toLowerCase();
          break;
        }
      }
      if (!type) continue;
      const notNull = /\bNOT NULL\b/i.test(rest);
      const defMatch = rest.match(
        /\bDEFAULT\s+(.+?)(?=\s+NOT NULL\b|\s+PRIMARY KEY\b|\s+UNIQUE\b|\s+REFERENCES\b|$)/i,
      );
      cols.set(name, { type, notNull, default: defMatch ? defMatch[1].trim() : null });
    }
    tables.set(table, cols);
  }
  return tables;
}

export function dbSignature(col) {
  let t = col.data_type;
  if (t === "character varying") {
    return col.character_maximum_length
      ? `character varying(${col.character_maximum_length})`
      : "character varying";
  }
  if (t === "numeric") {
    return col.numeric_precision != null
      ? `numeric(${col.numeric_precision},${col.numeric_scale})`
      : "numeric";
  }
  return t;
}

export function canonicalSignature(type) {
  const t = type.toLowerCase().replace(/\s+/g, " ");
  if (t.startsWith("varchar")) {
    const len = t.match(/\d+/);
    return len ? `character varying(${len[0]})` : "character varying";
  }
  if (t === "serial") return "integer";
  if (t.startsWith("numeric")) {
    const [p, s] = t.match(/\d+/g);
    return `numeric(${p},${s})`;
  }
  if (t.startsWith("timestamp") && !t.includes("time zone")) return "timestamp without time zone";
  if (t === "timestamp with time zone") return "timestamp with time zone";
  return t;
}

export function pgTypeFor(type) {
  const t = type.toLowerCase().replace(/\s+/g, " ");
  if (t.startsWith("varchar")) return `character varying(${t.match(/\d+/)[0]})`;
  if (t.startsWith("numeric")) {
    const [p, s] = t.match(/\d+/g);
    return `numeric(${p},${s})`;
  }
  if (t === "serial") return "integer";
  return t;
}

export function safeTypeChange(target, got) {
  if (got === "text" && target.startsWith("character varying")) return "text->varchar";
  if (got.startsWith("character varying") && target === "text") return "varchar->text";
  if (got === "character varying" && target.startsWith("character varying(")) {
    return "varchar-unlimited->varchar";
  }
  if (got === "real" && target.startsWith("numeric")) return "real->numeric";
  if (got === "integer" && target.startsWith("numeric")) return "integer->numeric";
  if (got.startsWith("numeric") && target.startsWith("numeric")) {
    const [gp, gs] = got.match(/\d+/g).map(Number);
    const [tp, ts] = target.match(/\d+/g).map(Number);
    if (tp >= gp && ts >= gs) return "numeric-widen";
    return null;
  }
  if (got === "text" && target.startsWith("numeric")) return "text->numeric";
  return null;
}

export function compareSnapshot(canonical, snapshot) {
  const missingTables = [];
  const missingColumns = [];
  const typeMismatches = [];
  const extraColumns = [];
  const extraTables = [];

  const byTable = new Map();
  for (const c of snapshot) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
    byTable.get(c.table_name).set(c.column_name, c);
  }

  for (const [table, tcols] of canonical) {
    if (!byTable.has(table)) {
      missingTables.push(table);
      continue;
    }
    const have = byTable.get(table);
    for (const [name, def] of tcols) {
      const actual = have.get(name);
      if (!actual) {
        missingColumns.push({ table, name, def });
        continue;
      }
      const want = canonicalSignature(def.type);
      const got = dbSignature(actual);
      if (want !== got) typeMismatches.push({ table, name, want, got, def });
    }
    for (const name of have.keys()) {
      if (!tcols.has(name)) extraColumns.push({ table, name });
    }
  }
  for (const t of byTable.keys()) {
    if (!canonical.has(t)) extraTables.push(t);
  }
  return { missingTables, missingColumns, typeMismatches, extraColumns, extraTables };
}

export function formatReport(p) {
  const lines = [];
  const legacy = p.extraTables.filter((t) => LEGACY_OBJECTS[t]);
  const other = p.extraTables.filter((t) => !LEGACY_OBJECTS[t]);
  if (p.missingTables.length) lines.push(`  tabel belum ada   : ${p.missingTables.join(", ")}`);
  for (const m of p.missingColumns) {
    lines.push(`  kolom belum ada   : ${m.table}.${m.name} (${m.def.type})`);
  }
  for (const t of p.typeMismatches) {
    lines.push(`  tipe beda         : ${t.table}.${t.name} db=${t.got} schema=${t.want}`);
  }
  for (const e of p.extraColumns) {
    lines.push(`  kolom ekstra      : ${e.table}.${e.name} (tidak ada di schema)`);
  }
  for (const t of legacy) lines.push(`  objek legacy      : ${t} — ${LEGACY_OBJECTS[t]}`);
  for (const t of other) lines.push(`  objek tak dikenal : ${t}`);
  if (!lines.length) lines.push("  (tidak ada selisih)");
  return lines.join("\n");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const APPLY = args.has("--apply");
  const DROP_LEGACY = args.has("--drop-legacy");

  const canonicalSql = process.env.CANONICAL_SQL_B64
    ? Buffer.from(process.env.CANONICAL_SQL_B64, "base64").toString("utf8")
    : fs.readFileSync(canonicalFile, "utf8");

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "ERROR: DATABASE_URL belum di-set. Jalankan: node --env-file=.env scripts/db-sync.mjs --apply",
    );
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const canonical = parseCanonical(canonicalSql);
  const dbCols = await client.query(
    `select table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
       from information_schema.columns where table_schema = 'public'`,
  );
  const before = compareSnapshot(canonical, dbCols.rows);

  console.log(`\nTarget : ${url.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@")}`);
  console.log(`Mode   : ${APPLY ? "apply" : "check"}`);
  console.log("\nSelisih sebelum:");
  console.log(formatReport(before));

  if (!APPLY) {
    const clean =
      !before.missingTables.length && !before.missingColumns.length && !before.typeMismatches.length;
    console.log(`\nHasil  : ${clean ? "COCOK dengan schema" : "PERLU DISINKRONKAN"}\n`);
    await client.end();
    process.exit(clean ? 0 : 1);
  }

  const changes = [];

  if (before.missingTables.length) {
    await client.query("BEGIN");
    try {
      await client.query(canonicalSql);
      await client.query("COMMIT");
      changes.push(`membuat tabel: ${before.missingTables.join(", ")}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  for (const m of before.missingColumns) {
    const type = pgTypeFor(m.def.type);
    const defaultClause =
      m.def.default && !/nextval/i.test(m.def.default) ? ` DEFAULT ${m.def.default}` : "";
    const notNull = m.def.notNull && defaultClause ? " NOT NULL" : "";
    await client.query(
      `alter table "${m.table}" add column if not exists "${m.name}" ${type}${defaultClause}${notNull}`,
    );
    changes.push(`tambah kolom: ${m.table}.${m.name} ${type}${notNull ? " NOT NULL" : ""}`);
    if (m.def.notNull && !notNull) {
      changes.push(
        `  PERHATIAN: ${m.table}.${m.name} di schema NOT NULL, kolom lama — dibiarkan nullable`,
      );
    }
  }

  for (const t of before.typeMismatches) {
    const target = pgTypeFor(t.def.type);
    const kind = safeTypeChange(target, t.got);
    if (!kind) {
      changes.push(`LEWATI (perlu review): ${t.table}.${t.name} db=${t.got} -> ${target}`);
      continue;
    }
    if (kind === "text->numeric") {
      const bad = await client.query(
        `select count(*)::int n from "${t.table}" where "${t.name}" is not null and "${t.name}" !~ '^-?[0-9]+(\\.[0-9]+)?$'`,
      );
      if (bad.rows[0].n > 0) {
        changes.push(
          `LEWATI (${bad.rows[0].n} nilai bukan angka): ${t.table}.${t.name} -> ${target}`,
        );
        continue;
      }
    }
    if (kind === "text->varchar" || kind === "varchar-unlimited->varchar") {
      const len = Number(target.match(/\d+/)[0]);
      const longest = await client.query(
        `select coalesce(max(length("${t.name}")),0)::int n from "${t.table}" where "${t.name}" is not null`,
      );
      if (longest.rows[0].n > len) {
        changes.push(`LEWATI (nilai panjang ${longest.rows[0].n} > ${len}): ${t.table}.${t.name}`);
        continue;
      }
    }
    await client.query(
      `alter table "${t.table}" alter column "${t.name}" type ${target} using "${t.name}"::${target}`,
    );
    changes.push(`selaraskan tipe: ${t.table}.${t.name} ${t.got} -> ${target}`);
  }

  if (DROP_LEGACY) {
    for (const t of before.extraTables) {
      if (!LEGACY_OBJECTS[t]) continue;
      await client.query(`drop table if exists "${t}" cascade`);
      await client.query(`drop view if exists "${t}" cascade`);
      changes.push(`hapus objek legacy: ${t}`);
    }
  }

  console.log(`\nPerubahan (${changes.length}):`);
  for (const c of changes) console.log(`  ${c}`);

  const afterCols = await client.query(
    `select table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
       from information_schema.columns where table_schema = 'public'`,
  );
  const after = compareSnapshot(canonical, afterCols.rows);
  console.log("\nSelisih sesudah:");
  console.log(formatReport(after));

  const clean = !after.missingTables.length && !after.missingColumns.length && !after.typeMismatches.length;
  console.log(`\nHasil  : ${clean ? "COCOK dengan schema" : "MASIH ADA SELISIH"}\n`);
  await client.end();
  process.exit(clean ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
