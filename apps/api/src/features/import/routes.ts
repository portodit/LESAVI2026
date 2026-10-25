import { Router, type IRouter } from "express";
import { db, dataImportsTable, salesFunnelTable, salesActivityTable, accountManagersTable, appSettingsTable, masterCustomerTable, performanceDataTable, pool } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../../shared/auth";
import {
  parseExcelFromUrl, parseExcelFromBase64,
  detectPeriod, extractSnapshotDateFromUrl, slugify,
  cleanFunnelRows, cleanActivityRows,
  detectExcelFormat, parsePivotCache, parseNipnas2AmSheet, pivotCacheRowsToParsedRows, pivotCacheRowsToParsedRowsFromCache2, ParsedRow,
} from "./excel";
import { notifyImportSnapshot } from "../telegram/importNotifier";

// ── Helper: auto-register new AM to accounts table with aktif=false ───────────
export async function autoRegisterNewAms(entries: { nik: string; nama: string; divisi: string; witel?: string }[], source: string): Promise<number> {
  const existing = await db.select({ nik: accountManagersTable.nik, slug: accountManagersTable.slug }).from(accountManagersTable);
  const existingNiks = new Set(existing.map(a => a.nik));
  const existingSlugs = new Set(existing.map(a => a.slug));
  let newCount = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.nik || existingNiks.has(e.nik) || seen.has(e.nik)) continue;
    seen.add(e.nik);
    // Generate slug from name + nik to guarantee uniqueness (nik is unique in DB)
    const baseSlug = slugify(e.nama);
    let slug = `${baseSlug}-${e.nik}`;
    // Fallback if still collides (should be rare)
    let suffix = 0;
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${e.nik}-${++suffix}`;
    }
    existingSlugs.add(slug);
    try {
      await db.insert(accountManagersTable).values({
        nik: e.nik,
        nama: e.nama,
        slug,
        divisi: e.divisi || "DPS",
        witel: e.witel || "SURAMADU",
        role: "ACCOUNT_MANAGER",
        aktif: false,
        discoveredFrom: source,
      } as any).onConflictDoNothing();
      newCount++;
    } catch (err) {
      // Log but don't crash the import — AM discovery is non-critical
      console.error(`[autoRegisterNewAms] Failed to insert NIK=${e.nik} nama=${e.nama}: ${(err as Error).message}`);
    }
  }
  return newCount;
}

const router: IRouter = Router();

// ── Helper: resolve rows from URL or base64 file ─────────────────────────────
async function resolveRows(body: any): Promise<{ rows: any[]; sourceUrl: string | null; snapshotDate: string | null }> {
  const { url, fileData, snapshotDate, sheetName } = body;

  if (fileData) {
    const rows = parseExcelFromBase64(fileData, sheetName || undefined);
    return { rows, sourceUrl: null, snapshotDate: snapshotDate || null };
  }

  if (url) {
    const detectedDate = snapshotDate || extractSnapshotDateFromUrl(url);
    const rows = await parseExcelFromUrl(url, sheetName || undefined);
    return { rows, sourceUrl: url, snapshotDate: detectedDate };
  }
  throw new Error("URL SharePoint atau file Excel diperlukan");
}

// ── Import History ────────────────────────────────────────────────────────────
router.get("/history", requireAuth, async (req, res): Promise<void> => {
  const records = await db.select().from(dataImportsTable).orderBy(desc(dataImportsTable.createdAt)).limit(50);
  res.json(records.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/funnel", requireAuth, async (req, res): Promise<void> => {
  let rows: any[];
  let sourceUrl: string | null;
  let snapshotDate: string | null;

  try {
    ({ rows, sourceUrl, snapshotDate } = await resolveRows(req.body));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  // ── Apply cleaning pipeline (sesuai Power Query di Power BI)
  const cleaned = cleanFunnelRows(rows, {
    preferPembuat: true,
    skipIsReportFilter: true,
    skipWitelFilter: true,
  });

  if (cleaned.length === 0) {
    res.status(422).json({
      error: "Tidak ada data valid setelah proses cleaning. Pastikan file mengandung kolom witel=SURAMADU dan divisi=DPS/DSS.",
      rawCount: rows.length,
      cleanedCount: cleaned.length,
    });
    return;
  }

  const importPeriod = req.body.period || detectPeriod(rows, sourceUrl || undefined);

  // ── AM baru: langsung masuk accounts dengan aktif=false
  const newFunnelAmCount = await autoRegisterNewAms(
    cleaned.filter(r => r.nikAm).map(r => ({ nik: r.nikAm!, nama: r.namaAm || r.nikAm!, divisi: r.divisi || "DPS", witel: r.witel || "SURAMADU" })),
    "import_funnel"
  );

  // ── Cek duplikat
  const [existingFunnel] = await db.select().from(dataImportsTable)
    .where(and(eq(dataImportsTable.type, "funnel"), eq(dataImportsTable.period, importPeriod)));

  if (existingFunnel && !req.body.forceOverwrite) {
    res.status(409).json({
      conflict: true,
      error: `Sudah ada data Sales Funnel periode ${importPeriod} yang diimport sebelumnya.`,
      existingId: existingFunnel.id,
      existingRows: existingFunnel.rowsImported,
      period: importPeriod,
      importedAt: existingFunnel.createdAt.toISOString(),
    });
    return;
  }

  if (existingFunnel && req.body.forceOverwrite) {
    await db.delete(salesFunnelTable).where(eq(salesFunnelTable.importId, existingFunnel.id));
    await db.delete(dataImportsTable).where(eq(dataImportsTable.id, existingFunnel.id));
  }

  const [imp] = await db.insert(dataImportsTable).values({
    type: "funnel",
    rowsImported: cleaned.length,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl,
    autoTelegramSent: false,
  }).returning();

  // ── Simpan SEMUA baris (termasuk AM baru yg belum aktif) — filter aktif dilakukan saat display
  const BATCH_SIZE = 200;
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE).map(row => ({
      ...row,
      snapshotDate: snapshotDate || null,
      importId: imp.id,
      nikHandling: row.nikHandling,
      namaPembuatLop: row.namaPembuatLop
    }));
    await db.insert(salesFunnelTable).values(batch);
  }

  // ── Back-fill NULL tahun_anggaran: prefer snapshot_date year, fallback to report_date year
  await db.execute(sql`
    UPDATE sales_funnel
    SET tahun_anggaran = COALESCE(
      CASE WHEN snapshot_date IS NOT NULL AND snapshot_date ~ '^[0-9]{4}'
        THEN EXTRACT(YEAR FROM snapshot_date::date)::integer
      END,
      CASE WHEN report_date IS NOT NULL AND report_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN EXTRACT(YEAR FROM report_date::date)::integer
      END
    )
    WHERE import_id = ${imp.id}
      AND tahun_anggaran IS NULL
  `);

  // ── Back-fill empty nama_am from accounts
  const allMasterAms = await db.select().from(accountManagersTable);
  const masterNameByNik = new Map(allMasterAms.map(m => [m.nik, m.nama]));
  const nullNameRows = cleaned.filter(r => !r.namaAm && r.nikAm && masterNameByNik.has(r.nikAm));
  for (const row of nullNameRows) {
    await db.update(salesFunnelTable)
      .set({ namaAm: masterNameByNik.get(row.nikAm) })
      .where(and(eq(salesFunnelTable.importId, imp.id), eq(salesFunnelTable.nikAm, row.nikAm)));
  }

  // ── Auto-populate master_customer
  const uniqueCustomers = [...new Set(cleaned.map(r => r.pelanggan).filter(p => p && p !== "–"))];
  for (let i = 0; i < uniqueCustomers.length; i += 100) {
    await db.insert(masterCustomerTable).values(
      uniqueCustomers.slice(i, i + 100).map(nama => ({ nama, witel: "SURAMADU" }))
    ).onConflictDoNothing();
  }

  const amCount = new Set(cleaned.map(r => r.nikAm)).size;

  const [settings] = await db.select().from(appSettingsTable);
  if (settings?.autoSendOnImport && settings.telegramBotToken) {
    const funnelUploader = (req as any).user
      ? { nama: (req as any).user.nama ?? "Officer", role: (req as any).user.role ?? "OFFICER" }
      : undefined;
    notifyImportSnapshot("funnel", imp.id, { uploader: funnelUploader })
      .then(({ am, manager }) => {
        if (am.sent > 0 || am.failed > 0) {
          console.log(`[FUNNEL-NOTIFY] sent=${am.sent} failed=${am.failed} skipped=${am.skipped}`);
        }
        if (manager.sent > 0 || manager.failed > 0) {
          console.log(`[FUNNEL-MANAGER-NOTIFY] sent=${manager.sent} failed=${manager.failed} skipped=${manager.skipped}`);
        }
      })
      .catch(() => {});
  }

  res.json({
    success: true, rowsImported: cleaned.length, amCount,
    period: importPeriod, snapshotDate,
    rawCount: rows.length,
    newAmDiscovered: newFunnelAmCount,
    message: `${cleaned.length} dari ${rows.length} baris funnel berhasil diimport${newFunnelAmCount > 0 ? `. ${newFunnelAmCount} AM baru ditambahkan ke Manajemen Akun (nonaktif).` : ""}`,
    importId: imp.id,
  });
});

// ── Import Activity ───────────────────────────────────────────────────────────
router.post("/activity", requireAuth, async (req, res): Promise<void> => {
  let rows: any[];
  let sourceUrl: string | null;
  let snapshotDate: string | null;

  try {
    ({ rows, sourceUrl, snapshotDate } = await resolveRows(req.body));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

  // ── Apply cleaning pipeline
  const cleaned = cleanActivityRows(rows);

  if (cleaned.length === 0) {
    res.status(422).json({
      error: "Tidak ada data valid setelah proses cleaning. Pastikan file mengandung kolom witel=SURAMADU dan divisi=DPS/DSS.",
      rawCount: rows.length,
    });
    return;
  }

  const importPeriod = req.body.period || detectPeriod(rows, sourceUrl || undefined);

  // ── Cek duplikat
  const [existingAct] = await db.select().from(dataImportsTable)
    .where(and(eq(dataImportsTable.type, "activity"), eq(dataImportsTable.period, importPeriod)));

  if (existingAct && !req.body.forceOverwrite) {
    res.status(409).json({
      conflict: true,
      error: `Sudah ada data Sales Activity periode ${importPeriod} yang diimport sebelumnya.`,
      existingId: existingAct.id,
      existingRows: existingAct.rowsImported,
      period: importPeriod,
      importedAt: existingAct.createdAt.toISOString(),
    });
    return;
  }

  if (existingAct && req.body.forceOverwrite) {
    await db.delete(salesActivityTable).where(eq(salesActivityTable.importId, existingAct.id));
    await db.delete(dataImportsTable).where(eq(dataImportsTable.id, existingAct.id));
  }

  const [imp] = await db.insert(dataImportsTable).values({
    type: "activity",
    rowsImported: 0,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl,
    autoTelegramSent: false,
  }).returning();

  const BATCH_ACT = 200;
  for (let i = 0; i < cleaned.length; i += BATCH_ACT) {
    const batch = cleaned.slice(i, i + BATCH_ACT);

    const nik_arr = batch.map(r => r.nik);
    const fullname_arr = batch.map(r => r.fullname || null);
    const divisi_arr = batch.map(r => r.divisi || null);
    const nipnas_arr = batch.map(r => r.nipnas || null);
    const caName_arr = batch.map(r => r.caName || null);
    const activityType_arr = batch.map(r => r.activityType || null);
    const label_arr = batch.map(r => r.label || null);
    const lopid_arr = batch.map(r => r.lopid || null);
    const endDate_arr = batch.map(r => r.activityEndDate || null);
    const notes_arr = batch.map(r => r.activityNotes || null);
    const snap_arr = batch.map(() => snapshotDate || null);
    const imp_arr = batch.map(() => imp.id);

    await pool.query(`
      INSERT INTO sales_activity
        (nik,fullname,divisi,nipnas,ca_name,activity_type,label,lopid,
         activity_end_date,activity_notes,snapshot_date,import_id)
      SELECT * FROM UNNEST(
        $1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],
        $8::text[],$9::text[],$10::text[],$11::text[],$12::integer[]
      ) AS t(nik,fullname,divisi,nipnas,ca_name,activity_type,label,lopid,
               activity_end_date,activity_notes,snapshot_date,import_id)
    `, [nik_arr, fullname_arr, divisi_arr, nipnas_arr, caName_arr, activityType_arr, label_arr,
        lopid_arr, endDate_arr, notes_arr, snap_arr, imp_arr]);
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(salesActivityTable).where(eq(salesActivityTable.importId, imp.id));
  await db.update(dataImportsTable).set({ rowsImported: count }).where(eq(dataImportsTable.id, imp.id));

  // ── AM baru: langsung masuk accounts dengan aktif=false
  const newActAmCount = await autoRegisterNewAms(
    cleaned.filter((r: any) => r.nik).map((r: any) => ({ nik: r.nik, nama: r.fullname || r.nik, divisi: r.divisi || "DPS", witel: "SURAMADU" })),
    "import_activity"
  );

  const amCount = new Set(cleaned.map((r: any) => r.nik)).size;

  const currentUser = (req as any).user;
  const uploader = currentUser ? { nama: currentUser.nama ?? "Officer", role: currentUser.role ?? "OFFICER" } : undefined;

  const { am: notifResult, manager: managerNotifResult } = await notifyImportSnapshot("activity", imp.id, { uploader });
  if (notifResult.sent > 0 || notifResult.failed > 0) {
    console.log(`[ACT-NOTIFY] sent=${notifResult.sent} failed=${notifResult.failed} skipped=${notifResult.skipped}`);
  }
  if (managerNotifResult.sent > 0 || managerNotifResult.failed > 0) {
    console.log(`[ACT-MANAGER-NOTIFY] sent=${managerNotifResult.sent} failed=${managerNotifResult.failed} skipped=${managerNotifResult.skipped}`);
  }

  res.json({
    success: true, rowsImported: count, amCount,
    period: importPeriod, snapshotDate,
    rawCount: rows.length,
    newAmDiscovered: newActAmCount,
    notifSent: notifResult.sent,
    notifFailed: notifResult.failed,
    managerNotifSent: managerNotifResult.sent,
    managerNotifFailed: managerNotifResult.failed,
    message: `${count} dari ${rows.length} baris activity berhasil diimport${newActAmCount > 0 ? `. ${newActAmCount} AM baru ditambahkan ke Manajemen Akun (nonaktif).` : ""}${notifResult.sent > 0 ? ` ${notifResult.sent} AM dinotifikasi via Telegram.` : ""}${managerNotifResult.sent > 0 ? ` ${managerNotifResult.sent} Manager dinotifikasi via Telegram.` : ""}`,
    importId: imp.id,
  });
});

// ── Import Performance AM ──────────────────────────────────────────────────────
router.post("/performance", requireAuth, async (req, res): Promise<void> => {
  const { fileData, snapshotDate, period: bodyPeriod, forceOverwrite } = req.body;
  const currentUser = (req as any).user;
  const uploader = currentUser ? { nama: currentUser.nama ?? "Officer", role: currentUser.role ?? "OFFICER" } : undefined;

  if (!fileData) {
    res.status(400).json({ error: "fileData (base64) diperlukan" });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileData, "base64");
  } catch {
    res.status(400).json({ error: "fileData bukan base64 yang valid" });
    return;
  }

  let rows: ParsedRow[];
  try {
    const fmt = await detectExcelFormat(buffer);
    if (fmt.isPivot) {
      console.log(`[PERF-IMPORT] Pivot cache detected, cacheCount=${fmt.cacheCount}`);
      const nipnas2am = parseNipnas2AmSheet(buffer);

      // Determine which cache has AM-level data (NIK/NAMA_AM attribution).
      // 20260812: AM-level is in Cache 2, CC-level is in Cache 1.
      // 20260713: AM-level is in Cache 1, CC-level is in Cache 2.
      // Strategy: check which cache has NIK field, then parse and use that cache.
      let amRows: ParsedRow[] = [];
      let amCacheIndex = 2;
      let suramaduCount = 0;

      // Try Cache 2 first
      const cache2Result = await parsePivotCache(buffer, 2);
      const cache2HasNik = cache2Result.fields.includes("NIK");
      console.log(`[PERF-IMPORT] Cache2 has NIK=${cache2HasNik}, recordCount=${cache2Result.recordCount}`);

      if (cache2HasNik) {
        amRows = pivotCacheRowsToParsedRowsFromCache2(cache2Result, nipnas2am);
        amCacheIndex = 2;
        suramaduCount = amRows.filter(r => String(r.WITEL_AM ?? "").trim().toUpperCase() === "SURAMADU").length;
        console.log(`[PERF-IMPORT] Using Cache 2 (AM-level): ${amRows.length} rows, ${suramaduCount} SURAMADU`);
      }

      // If Cache 2 has no SURAMADU rows, try Cache 1
      if (suramaduCount === 0 && fmt.cacheCount >= 1) {
        const cache1Result = await parsePivotCache(buffer, 1);
        const cache1HasNik = cache1Result.fields.includes("NIK");
        console.log(`[PERF-IMPORT] Cache1 has NIK=${cache1HasNik}, recordCount=${cache1Result.recordCount}`);

        if (cache1HasNik) {
          amRows = pivotCacheRowsToParsedRowsFromCache2(cache1Result, nipnas2am);
          amCacheIndex = 1;
          suramaduCount = amRows.filter(r => String(r.WITEL_AM ?? "").trim().toUpperCase() === "SURAMADU").length;
          console.log(`[PERF-IMPORT] Cache 2 empty → Cache 1 (AM-level): ${amRows.length} rows, ${suramaduCount} SURAMADU`);
        }
      }

      // Final filter
      rows = amRows.filter(r => String(r.WITEL_AM ?? "").trim().toUpperCase() === "SURAMADU");
      console.log(`[PERF-IMPORT] Final: ${rows.length} rows after WITEL_AM=SURAMADU filter`);
    } else {
      console.log("[PERF-IMPORT] RAW sheet format detected");
      rows = parseExcelFromBase64(fileData, undefined);
    }
  } catch (e: any) {
    console.error("[PERF-IMPORT] Parse error:", e.message);
    res.status(422).json({ error: "Gagal parsing file Excel: " + e.message });
    return;
  }

  const filtered = rows.filter(r => {
    const witel = String(r.WITEL_AM ?? r.WITEL ?? "").trim().toUpperCase();
    return witel === "SURAMADU";
  });
  console.log("[DEBUG] raw rows:", rows.length, "| after WITEL_AM=SURAMADU filter:", filtered.length);

  if (filtered.length === 0) {
    res.status(422).json({ error: "Tidak ada data dengan WITEL_AM=SURAMADU", rawCount: rows.length, filteredCount: 0 });
    return;
  }

  // Extract PERIODE → tahun/bulan (prioritaskan dari snapshotDate filename)
  let PERIODE: string;
  let tahun: number;
  let bulan: number;
  if (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    const parts = snapshotDate.split("-");
    PERIODE = parts[0] + parts[1];
    tahun = parseInt(parts[0], 10);
    bulan = parseInt(parts[1], 10);
  } else {
    const periodeSet = new Set<string>();
    for (const r of filtered) {
      const p = String(r.PERIODE ?? "").trim();
      if (p) periodeSet.add(p);
    }
    const periodeList = [...periodeSet].sort();
    PERIODE = bodyPeriod || periodeList[0] || new Date().toISOString().slice(0, 7).replace("-", "");
    tahun = parseInt(PERIODE.slice(0, 4), 10) || new Date().getFullYear();
    bulan = parseInt(PERIODE.slice(4, 6), 10) || new Date().getMonth() + 1;
  }
  const importPeriod = PERIODE;

  // Resolve NAMA_AM and DIVISI from account_managers if missing
  const masterAms = await db.select().from(accountManagersTable).where(eq(accountManagersTable.aktif, true));
  const nikToName = new Map(masterAms.map(a => [a.nik, a.nama]));
  const nikToDivisi = new Map(masterAms.map(a => [a.nik, a.divisi]));

  // Prepare records — one row per customer (no dedup)
  const records: any[] = filtered.map(r => {
    const nik = String(r.NIK ?? "").trim();
    const divisi = (r.DIVISI_AM as string) || nikToDivisi.get(nik) || "DPS";
    const periode = String(r.PERIODE ?? "").trim();
    const rowTahun = parseInt(periode.slice(0, 4), 10) || tahun;
    const rowBulan = parseInt(periode.slice(4, 6), 10) || bulan;

    // RAW file: TARGET_REVENUE = total (Reguler), TARGET_SUSTAIN/SCALING/NGTMA = sub-components
    // RAW file: A_REV = achievement rate (1-2 digits), A_NGTMA/SCALING/SUSTAIN = component achievement
    const targetReguler = parseFloat(String(r.TARGET_REVENUE ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realReguler = parseFloat(String(r.REAL_REVENUE ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetSustain = parseFloat(String(r.TARGET_SUSTAIN ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realSustain = parseFloat(String(r.REAL_SUSTAIN ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetScaling = parseFloat(String(r.TARGET_SCALING ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realScaling = parseFloat(String(r.REAL_SCALING ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetNgtma = parseFloat(String(r.TARGET_NGTMA ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realNgtma = parseFloat(String(r.REAL_NGTMA ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetRevenue = targetReguler + targetSustain + targetScaling + targetNgtma;
    const realRevenue = realReguler + realSustain + realScaling + realNgtma;

    const revenueBase = parseFloat(String(r.REVENUE_BASE ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const revenueBillcom = parseFloat(String(r.REVENUE_BILLCOM ?? 0).replace(/[^\d.-]/g, "")) || 0;

    const aRev = parseFloat(String(r.a_rev ?? r.a_REV ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aNgtma = parseFloat(String(r.a_ngtma ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aScaling = parseFloat(String(r.a_scaling ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aSustain = parseFloat(String(r.a_sustain ?? 0).replace(/[^\d.-]/g, "")) || 0;

    const achRate = aRev || (targetRevenue > 0 ? realRevenue / targetRevenue : 0);

    // komponen_detail = this ONE customer
    const komponenDetail = JSON.stringify({
      nip: r.NIP_NAS_GROUP ?? r.NIP_NAS ?? null,
      nipnas: r.NIP_NAS ?? null,
      pelanggan: r.STANDARD_NAME ?? r.NAMA_PELANGGAN ?? r.PELANGGAN ?? null,
      proporsi: r.PROPORSI ?? 1,
      group: r.GROUP ?? null,
      industri: r.INDUSTRI ?? null,
      lsegmen: r.LSEGMEN ?? null,
      ssegmen: r.SSEGMEN ?? null,
      witelCc: r.WITEL_CC ?? r.WITEL ?? null,
      telda: r.TELDA ?? null,
      regional: r.REGIONAL ?? null,
      divisiCc: r.DIVISI_CC ?? r.DIVISI ?? null,
      kawasan: r.KAWASAN ?? null,
      layanan: r.LAYANAN ?? null,
      reguler: { target: targetReguler, real: realReguler },
      sustain: { target: targetSustain, real: realSustain },
      scaling: { target: targetScaling, real: realScaling },
      ngtma: { target: targetNgtma, real: realNgtma },
      revenueBase,
      revenueBillcom,
    });

    const namaAm = r.NAMA_AM || nikToName.get(nik) || nik || "UNKNOWN";

    return {
      nik,
      namaAm,
      divisi,
      divisiCc: r.DIVISI_CC ?? r.DIVISI ?? null,
      witelAm: r.WITEL_AM ?? r.WITEL ?? "SURAMADU",
      witelCc: r.WITEL_CC ?? r.WITEL ?? null,
      levelAm: r.LEVEL_AM ?? null,
      tahun: rowTahun,
      bulan: rowBulan,
      targetRevenue,
      realRevenue,
      targetReguler,
      realReguler,
      targetSustain,
      realSustain,
      targetScaling,
      realScaling,
      targetNgtma,
      realNgtma,
      revenueBase,
      revenueBillcom,
      aRev,
      aNgtma,
      aScaling,
      aSustain,
      achRate,
      achRateYtd: achRate,
      rankAch: 0,
      statusWarna: achRate >= 1 ? "hijau" : achRate >= 0.8 ? "kuning" : "merah",
      komponenDetail,
      snapshotDate: snapshotDate || null,
    };
  });
  const validRecords = records;

  if (validRecords.length === 0) {
    res.status(422).json({ error: "Tidak ada data valid", totalRecords: records.length });
    return;
  }

  console.log("[DEBUG] validRecords:", validRecords.length, "| filtered:", filtered.length);

  // Check for existing import of same period AND snapshot date
  const snapshotDateNorm = snapshotDate ? snapshotDate.slice(0, 10) : null;
  const [existingPerf] = snapshotDateNorm
    ? await db.select().from(dataImportsTable)
        .where(and(
          eq(dataImportsTable.type, "performance"),
          eq(dataImportsTable.period, importPeriod),
          eq(dataImportsTable.snapshotDate, snapshotDateNorm),
        ))
    : await db.select().from(dataImportsTable)
        .where(and(eq(dataImportsTable.type, "performance"), eq(dataImportsTable.period, importPeriod)));

  if (existingPerf && !forceOverwrite) {
    res.status(409).json({
      conflict: true,
      error: `Sudah ada data Performa AM periode ${importPeriod} dengan snapshot date ${snapshotDateNorm} yang diimport sebelumnya.`,
      existingId: existingPerf.id,
      existingRows: existingPerf.rowsImported,
      period: importPeriod,
      importedAt: existingPerf.createdAt.toISOString(),
    });
    return;
  }

  if (existingPerf && forceOverwrite) {
    await db.delete(performanceDataTable).where(eq(performanceDataTable.importId, existingPerf.id));
    await db.delete(dataImportsTable).where(eq(dataImportsTable.id, existingPerf.id));
  }

  // Create import record
  const [imp] = await db.insert(dataImportsTable).values({
    type: "performance",
    rowsImported: validRecords.length,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl: null,
    autoTelegramSent: false,
  }).returning();

  // Batch insert into performance_data
  const BATCH = 100;
  for (let i = 0; i < validRecords.length; i += BATCH) {
    const batch = validRecords.slice(i, i + BATCH).map(r => ({ ...r, importId: imp.id }));
    await db.insert(performanceDataTable).values(batch as any);
  }

  // Auto-register new AMs discovered from performance data
  const newPerfAmCount = await autoRegisterNewAms(
    validRecords.map((r: any) => ({ nik: r.nik, nama: r.namaAm, divisi: r.divisi, witel: r.witelAm })),
    "import_performance"
  );

  // ── Send personalized snapshot notifications to all linked AMs
  const { am: notifResult, manager: managerNotifResult } = await notifyImportSnapshot("performance", imp.id, { uploader });
  if (notifResult.sent > 0 || notifResult.failed > 0) {
    console.log(`[PERF-NOTIFY] sent=${notifResult.sent} failed=${notifResult.failed} skipped=${notifResult.skipped}`);
  }
  if (managerNotifResult.sent > 0 || managerNotifResult.failed > 0) {
    console.log(`[MANAGER-NOTIFY] sent=${managerNotifResult.sent} failed=${managerNotifResult.failed} skipped=${managerNotifResult.skipped}`);
  }

  const amCount = new Set(validRecords.map(r => r.nik)).size;

  res.json({
    success: true,
    rowsImported: validRecords.length,
    amCount,
    period: importPeriod,
    tahun,
    bulan,
    snapshotDate: snapshotDate || null,
    rawCount: rows.length,
    filteredCount: filtered.length,
    newAmDiscovered: newPerfAmCount,
    notifSent: notifResult.sent,
    notifFailed: notifResult.failed,
    managerNotifSent: managerNotifResult.sent,
    managerNotifFailed: managerNotifResult.failed,
    message: `${validRecords.length} dari ${rows.length} baris performance berhasil diimport${newPerfAmCount > 0 ? `. ${newPerfAmCount} AM baru ditambahkan ke Manajemen Akun (nonaktif).` : ""}${notifResult.sent > 0 ? ` ${notifResult.sent} AM dinotifikasi via Telegram.` : ""}${managerNotifResult.sent > 0 ? ` ${managerNotifResult.sent} Manager dinotifikasi via Telegram.` : ""}`,
    importId: imp.id,
  });
});

// ── Get Import Metadata ───────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, id));
  if (!imp) { res.status(404).json({ error: "Import tidak ditemukan" }); return; }
  res.json({ ...imp, createdAt: imp.createdAt.toISOString() });
});

// ── Get Import Data Rows ───────────────────────────────────────────────────────
router.get("/:id/data", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, id));
  if (!imp) { res.status(404).json({ error: "Import tidak ditemukan" }); return; }

  res.setHeader("Cache-Control", "no-store");
  try {
    if (imp.type === "funnel") {
      const rows = await db.select().from(salesFunnelTable).where(eq(salesFunnelTable.importId, id));
      res.json({ type: imp.type, rows: rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString() })) });
    } else if (imp.type === "activity") {
      const rows = await db.select().from(salesActivityTable).where(eq(salesActivityTable.importId, id));
      res.json({ type: imp.type, rows: rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString() })) });
    } else if (imp.type === "performance") {
      const rows = await db.select().from(performanceDataTable).where(eq(performanceDataTable.importId, id));
      res.json({ type: imp.type, rows: rows.map(r => ({ ...r, createdAt: r.createdAt?.toISOString() })) });
    } else {
      res.json({ type: imp.type, rows: [] });
    }
  } catch (err: any) {
    console.error("[/import/:id/data] Error:", err?.message, "| Cause:", err?.cause?.message || err?.cause, "\nStack:", err?.stack);
    res.status(500).json({ error: "Gagal mengambil data", detail: err?.cause?.message || err?.message });
  }
});

// ── Import Funnel dari Power BI CSV (file attached_assets) ───────────────────
router.post("/powerbi-funnel", requireAuth, async (req, res): Promise<void> => {
  const fs = await import("fs");
  const path = await import("path");
  const XLSX = await import("xlsx");

  // Find CSV files
  const assetsDir = path.resolve(process.cwd(), "../../attached_assets");
  const allFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  const csvFiles = allFiles.filter(f => f.includes("Status_Funneling_AM_") && f.endsWith(".csv")).sort().reverse();
  const csvFile = csvFiles[0];
  if (!csvFile) {
    res.status(404).json({ error: "File CSV Power BI tidak ditemukan di attached_assets" });
    return;
  }

  const csvPath = path.join(assetsDir, csvFile);
  const wb = XLSX.readFile(csvPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });

  // Load account_managers for name→NIK lookup
  const masterAms = await db.select().from(accountManagersTable).where(eq(accountManagersTable.aktif, true));
  const nameToNik = new Map<string, string>();
  const nikToDivisi = new Map<string, string>();
  for (const m of masterAms) {
    const norm = m.nama.toUpperCase().replace(/\s+/g, "");
    nameToNik.set(norm, m.nik);
    nikToDivisi.set(m.nik, m.divisi);
  }

  // Dedup by lopid: skip already-imported lopids from this source
  const existingLopids = new Set<string>(
    (await db.select({ lopid: salesFunnelTable.lopid }).from(salesFunnelTable)).map(r => r.lopid)
  );

  const toInsert: any[] = [];
  let skipped = 0;

  for (const r of rawRows) {
    const namaAm = String(r["Nama AM"] ?? "").trim().toUpperCase();
    if (!namaAm) { skipped++; continue; }

    const normName = namaAm.replace(/\s+/g, "");
    const nikAm = nameToNik.get(normName);
    if (!nikAm) { skipped++; continue; }

    const lopid = String(r["LOP ID"] ?? "").trim();
    if (!lopid) { skipped++; continue; }
    if (existingLopids.has(lopid)) { skipped++; continue; }

    const estDate = String(r["Est. Date BC"] ?? "").trim();
    const estimateBulan = estDate ? estDate.replace(/\s.*/, "") : null;
    // Use today as reportDate so YEAR filter works correctly for Power BI CSV LOPs
    const reportDate = new Date().toISOString().slice(0, 10);

    toInsert.push({
      lopid,
      judulProyek: String(r["judul_proyek"] ?? "").trim(),
      pelanggan: String(r["Pelanggan"] ?? "–").trim().toUpperCase() || "–",
      nilaiProyek: parseFloat(String(r["Nilai Proyek"] ?? "0").replace(/,/g, "")) || 0,
      divisi: nikToDivisi.get(nikAm) || "DPS",
      witel: "SURAMADU",
      statusF: String(r["Status Funnel"] ?? "").trim(),
      statusProyek: String(r["Status Proyek"] ?? "").trim(),
      kategoriKontrak: String(r["Kontrak"] ?? "").trim(),
      monthSubs: r["Month Subs"] != null ? (parseInt(String(r["Month Subs"]), 10) || null) : r["month_subs"] != null ? (parseInt(String(r["month_subs"]), 10) || null) : r["rencana_durasi_kontrak"] != null ? (parseInt(String(r["rencana_durasi_kontrak"]), 10) || null) : null,
      namaAm: masterAms.find(m => m.nik === nikAm)?.nama ?? namaAm,
      nikAm,
      reportDate,
      estimateBulan,
      snapshotDate: new Date().toISOString().slice(0, 10),
    });
    existingLopids.add(lopid);
  }

  if (toInsert.length === 0) {
    res.json({ success: true, imported: 0, skipped, message: "Tidak ada LOP baru yang diimport (sudah ada semua atau nama AM tidak cocok)" });
    return;
  }

  const [imp] = await db.insert(dataImportsTable).values({
    type: "funnel",
    rowsImported: toInsert.length,
    period: new Date().toISOString().slice(0, 7),
    sourceUrl: `powerbi-csv:${csvFile}`,
    autoTelegramSent: false,
  }).returning();

  const BATCH = 100;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await db.insert(salesFunnelTable).values(
      toInsert.slice(i, i + BATCH).map(row => ({ ...row, importId: imp.id }))
    );
  }

  res.json({ success: true, imported: toInsert.length, skipped, importId: imp.id, message: `${toInsert.length} LOP berhasil diimport dari ${csvFile}` });
});

// ── Delete Import (hapus snapshot + semua data terkait) ───────────────────────
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

  // Get import record first to know the type
  const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, id));
  if (!imp) { res.status(404).json({ error: "Import tidak ditemukan" }); return; }

  // Delete related data rows
  if (imp.type === "funnel") {
    await db.delete(salesFunnelTable).where(eq(salesFunnelTable.importId, id));
  } else if (imp.type === "activity") {
    await db.delete(salesActivityTable).where(eq(salesActivityTable.importId, id));
  } else if (imp.type === "performance") {
    await db.delete(performanceDataTable).where(eq(performanceDataTable.importId, id));
  }

  // Delete import record
  await db.delete(dataImportsTable).where(eq(dataImportsTable.id, id));

  res.json({ success: true, message: `Import #${id} (${imp.type}) dan ${imp.rowsImported} baris datanya berhasil dihapus` });
});

// ── PATCH /api/import/:importId/rows/:rowId ────────────────────────────────────
router.patch("/:importId/rows/:rowId", requireAuth, async (req, res): Promise<void> => {
  const importId = parseInt(req.params.importId, 10);
  const rowId = parseInt(req.params.rowId, 10);
  if (isNaN(importId) || isNaN(rowId)) { res.status(400).json({ error: "ID tidak valid" }); return; }

  const { field, value } = req.body as { field: string; value: string };
  if (!field || value === undefined) { res.status(400).json({ error: "field dan value wajib" }); return; }

  const activityEditableFields: Record<string, any> = {
    nik: null, fullname: null, divisi: null, segmen: null, regional: null,
    witel: null, nipnas: null, caName: null, activityType: null, label: null,
    lopid: null, createdatActivity: null, activityStartDate: null,
    activityEndDate: null, picName: null, picJobtitle: null,
    picRole: null, picPhone: null, activityNotes: null, snapshotDate: null,
  };

  const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, importId)).limit(1);
  if (!imp) { res.status(404).json({ error: "Import tidak ditemukan" }); return; }

  if (imp.type === "activity") {
    if (!(field in activityEditableFields)) {
      res.status(400).json({ error: "Field tidak dapat diedit" }); return;
    }
    const [existing] = await db.select({ id: salesActivityTable.id })
      .from(salesActivityTable)
      .where(and(eq(salesActivityTable.id, rowId), eq(salesActivityTable.importId, importId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Baris tidak ditemukan" }); return; }
    await db.update(salesActivityTable)
      .set({ [field]: value } as any)
      .where(and(eq(salesActivityTable.id, rowId), eq(salesActivityTable.importId, importId)));
    res.json({ success: true });
  } else {
    res.status(400).json({ error: `Edit tidak didukung untuk tipe ${imp.type}` });
  }
});

// Internal endpoint for Telegram bot import (no session auth, uses shared secret)
router.post("/internal/performance", async (req, res): Promise<void> => {
  const secret = req.headers["x-telegram-secret"];
  if (secret !== process.env["TELEGRAM_IMPORT_SECRET"] && secret !== "telegram-bot-internal-secret-2024") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { fileData, snapshotDate, period: bodyPeriod, uploader } = req.body as {
    fileData?: string; snapshotDate?: string; period?: string;
    uploader?: { nama: string; role: string };
  };

  if (!fileData) {
    res.status(400).json({ error: "fileData (base64) diperlukan" });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileData, "base64");
  } catch {
    res.status(400).json({ error: "fileData bukan base64 yang valid" });
    return;
  }

  let rows: ParsedRow[];
  try {
    const fmt = await detectExcelFormat(buffer);
    if (fmt.isPivot) {
      const nipnas2am = parseNipnas2AmSheet(buffer);
      let amRows: ParsedRow[] = [];
      let suramaduCount = 0;

      const cache2Result = await parsePivotCache(buffer, 2);
      const cache2HasNik = cache2Result.fields.includes("NIK");
      if (cache2HasNik) {
        amRows = pivotCacheRowsToParsedRowsFromCache2(cache2Result, nipnas2am);
        suramaduCount = amRows.filter(r => String(r.WITEL_AM ?? "").trim().toUpperCase() === "SURAMADU").length;
      }

      if (suramaduCount === 0 && fmt.cacheCount >= 1) {
        const cache1Result = await parsePivotCache(buffer, 1);
        if (cache1Result.fields.includes("NIK")) {
          amRows = pivotCacheRowsToParsedRowsFromCache2(cache1Result, nipnas2am);
        }
      }

      rows = amRows.filter(r => String(r.WITEL_AM ?? "").trim().toUpperCase() === "SURAMADU");
    } else {
      rows = parseExcelFromBase64(fileData, undefined);
    }
  } catch (e: any) {
    res.status(422).json({ error: "Gagal parsing file Excel: " + e.message });
    return;
  }

  const filtered = rows.filter(r => {
    const witel = String(r.WITEL_AM ?? r.WITEL ?? "").trim().toUpperCase();
    return witel === "SURAMADU";
  });

  if (filtered.length === 0) {
    res.status(422).json({ error: "Tidak ada data dengan WITEL_AM=SURAMADU", rawCount: rows.length, filteredCount: 0 });
    return;
  }

  let tahun: number;
  let bulan: number;
  if (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    const parts = snapshotDate.split("-");
    tahun = parseInt(parts[0], 10);
    bulan = parseInt(parts[1], 10);
  } else {
    const periodeSet = new Set<string>();
    for (const r of filtered) {
      const p = String(r.PERIODE ?? "").trim();
      if (p) periodeSet.add(p);
    }
    const periodeList = [...periodeSet].sort();
    const PERIODE = bodyPeriod || periodeList[0] || new Date().toISOString().slice(0, 7).replace("-", "");
    tahun = parseInt(PERIODE.slice(0, 4), 10) || new Date().getFullYear();
    bulan = parseInt(PERIODE.slice(4, 6), 10) || new Date().getMonth() + 1;
  }

  const importPeriod = `${tahun}${String(bulan).padStart(2, "0")}`;
  const masterAms = await db.select().from(accountManagersTable).where(eq(accountManagersTable.aktif, true));
  const nikToName = new Map(masterAms.map(a => [a.nik, a.nama]));
  const nikToDivisi = new Map(masterAms.map(a => [a.nik, a.divisi]));

  const records: any[] = filtered.map(r => {
    const nik = String(r.NIK ?? "").trim();
    const divisi = (r.DIVISI_AM as string) || nikToDivisi.get(nik) || "DPS";
    const periode = String(r.PERIODE ?? "").trim();
    const rowTahun = parseInt(periode.slice(0, 4), 10) || tahun;
    const rowBulan = parseInt(periode.slice(4, 6), 10) || bulan;

    const targetReguler = parseFloat(String(r.TARGET_REVENUE ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realReguler = parseFloat(String(r.REAL_REVENUE ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetSustain = parseFloat(String(r.TARGET_SUSTAIN ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realSustain = parseFloat(String(r.REAL_SUSTAIN ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetScaling = parseFloat(String(r.TARGET_SCALING ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realScaling = parseFloat(String(r.REAL_SCALING ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetNgtma = parseFloat(String(r.TARGET_NGTMA ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const realNgtma = parseFloat(String(r.REAL_NGTMA ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const targetRevenue = targetReguler + targetSustain + targetScaling + targetNgtma;
    const realRevenue = realReguler + realSustain + realScaling + realNgtma;
    const revenueBase = parseFloat(String(r.REVENUE_BASE ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const revenueBillcom = parseFloat(String(r.REVENUE_BILLCOM ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aRev = parseFloat(String(r.a_rev ?? r.a_REV ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aNgtma = parseFloat(String(r.a_ngtma ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aScaling = parseFloat(String(r.a_scaling ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const aSustain = parseFloat(String(r.a_sustain ?? 0).replace(/[^\d.-]/g, "")) || 0;
    const achRate = aRev || (targetRevenue > 0 ? realRevenue / targetRevenue : 0);

    const komponenDetail = JSON.stringify({
      nip: r.NIP_NAS_GROUP ?? r.NIP_NAS ?? null,
      nipnas: r.NIP_NAS ?? null,
      pelanggan: r.STANDARD_NAME ?? r.NAMA_PELANGGAN ?? r.PELANGGAN ?? null,
      proporsi: r.PROPORSI ?? 1,
      group: r.GROUP ?? null,
      industri: r.INDUSTRI ?? null,
      lsegmen: r.LSEGMEN ?? null,
      ssegmen: r.SSEGMEN ?? null,
      witelCc: r.WITEL_CC ?? r.WITEL ?? null,
      telda: r.TELDA ?? null,
      regional: r.REGIONAL ?? null,
      divisiCc: r.DIVISI_CC ?? r.DIVISI ?? null,
      kawasan: r.KAWASAN ?? null,
      layanan: r.LAYANAN ?? null,
      reguler: { target: targetReguler, real: realReguler },
      sustain: { target: targetSustain, real: realSustain },
      scaling: { target: targetScaling, real: realScaling },
      ngtma: { target: targetNgtma, real: realNgtma },
      revenueBase, revenueBillcom,
    });

    const namaAm = r.NAMA_AM || nikToName.get(nik) || nik || "UNKNOWN";

    return {
      nik, namaAm, divisi,
      divisiCc: r.DIVISI_CC ?? r.DIVISI ?? null,
      witelAm: r.WITEL_AM ?? r.WITEL ?? "SURAMADU",
      witelCc: r.WITEL_CC ?? r.WITEL ?? null,
      levelAm: r.LEVEL_AM ?? null,
      tahun: rowTahun, bulan: rowBulan,
      targetRevenue, realRevenue,
      targetReguler, realReguler,
      targetSustain, realSustain,
      targetScaling, realScaling,
      targetNgtma, realNgtma,
      revenueBase, revenueBillcom,
      aRev, aNgtma, aScaling, aSustain,
      achRate, achRateYtd: achRate,
      rankAch: 0,
      statusWarna: achRate >= 1 ? "hijau" : achRate >= 0.8 ? "kuning" : "merah",
      komponenDetail,
      snapshotDate: snapshotDate || null,
    };
  });

  const [existingPerf] = snapshotDate
    ? await db.select().from(dataImportsTable).where(and(
        eq(dataImportsTable.type, "performance"),
        eq(dataImportsTable.period, importPeriod),
        eq(dataImportsTable.snapshotDate, snapshotDate.slice(0, 10)),
      ))
    : await db.select().from(dataImportsTable).where(and(
        eq(dataImportsTable.type, "performance"),
        eq(dataImportsTable.period, importPeriod)
      ));

  if (existingPerf) {
    await db.delete(performanceDataTable).where(eq(performanceDataTable.importId, existingPerf.id));
    await db.delete(dataImportsTable).where(eq(dataImportsTable.id, existingPerf.id));
  }

  const [imp] = await db.insert(dataImportsTable).values({
    type: "performance",
    rowsImported: records.length,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl: null,
    autoTelegramSent: false,
  }).returning();

  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH).map(r => ({ ...r, importId: imp.id }));
    await db.insert(performanceDataTable).values(batch as any);
  }

  const newPerfAmCount = await autoRegisterNewAms(
    records.map((r: any) => ({ nik: r.nik, nama: r.namaAm, divisi: r.divisi, witel: r.witelAm })),
    "import_performance_telegram"
  );

  const amCount = new Set(records.map(r => r.nik)).size;

  // ── Notify all linked AMs of their personalized performance snapshot
  const { am: notifResult, manager: managerNotifResult } = await notifyImportSnapshot("performance", imp.id, { uploader });
  if (notifResult.sent > 0 || notifResult.failed > 0) {
    console.log(`[PERF-NOTIFY] sent=${notifResult.sent} failed=${notifResult.failed} skipped=${notifResult.skipped}`);
  }
  if (managerNotifResult.sent > 0 || managerNotifResult.failed > 0) {
    console.log(`[MANAGER-NOTIFY] sent=${managerNotifResult.sent} failed=${managerNotifResult.failed} skipped=${managerNotifResult.skipped}`);
  }

  res.json({
    success: true,
    rowsImported: records.length,
    amCount,
    period: importPeriod,
    tahun, bulan,
    snapshotDate: snapshotDate || null,
    rawCount: rows.length,
    filteredCount: filtered.length,
    newAmDiscovered: newPerfAmCount,
    message: `${records.length} dari ${rows.length} baris performance berhasil diimport.${managerNotifResult.sent > 0 ? ` Manager telah dinotifikasi.` : ""}`,
    importId: imp.id,
    notifSent: notifResult.sent,
    notifFailed: notifResult.failed,
    managerNotifSent: managerNotifResult.sent,
    managerNotifFailed: managerNotifResult.failed,
  });
});

export default router;

