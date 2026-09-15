import { Router, type IRouter } from "express";
import { db, dataImportsTable, performanceDataTable, accountManagersTable, salesFunnelTable, salesActivityTable, masterCustomerTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { autoRegisterNewAms } from "./routes";
import { logger } from "../../shared/logger";
import {
  detectExcelFormat, parseExcelFromBase64,
  parsePivotCache, parseNipnas2AmSheet, pivotCacheRowsToParsedRowsFromCache2, ParsedRow,
  cleanFunnelRows, cleanActivityRows,
} from "./excel";
import * as XLSX from "xlsx";

// Mounted at /api/internal — no session auth, uses shared secret header

const router: IRouter = Router();

router.post("/import-performance", async (req, res): Promise<void> => {
  const secret = req.headers["x-telegram-secret"];
  const validSecret = process.env["TELEGRAM_IMPORT_SECRET"] || "telegram-bot-internal-secret-2024";
  if (secret !== validSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { fileData, snapshotDate, period: bodyPeriod, forceOverwrite = false } = req.body as {
    fileData?: string; snapshotDate?: string; period?: string; forceOverwrite?: boolean;
  };

  if (!fileData) {
    res.status(400).json({ error: "fileData (base64) diperlukan" });
    return;
  }

  logger.info({ fileDataSize: fileData.length, snapshotDate, bodyPeriod }, "Internal import: starting");

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
    logger.info({ isPivot: fmt.isPivot, cacheCount: fmt.cacheCount }, "Internal import: format detected");
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
  logger.info({ rawCount: rows.length, filteredCount: filtered.length }, "Internal import: filtered");

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

  // Cek duplikat
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

  if (existingPerf && !forceOverwrite) {
    res.status(409).json({
      conflict: true,
      error: `Sudah ada data Performance AM periode ${importPeriod} yang diimport sebelumnya.`,
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

  const [imp] = await db.insert(dataImportsTable).values({
    type: "performance",
    rowsImported: records.length,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl: null,
    autoTelegramSent: false,
  }).returning();
  logger.info({ importId: imp.id, recordsToInsert: records.length }, "Internal import: DB insert starting");

  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH).map(r => ({ ...r, importId: imp.id }));
    await db.insert(performanceDataTable).values(batch as any);
  }
  logger.info({ importId: imp.id }, "Internal import: DB insert complete");

  const newPerfAmCount = await autoRegisterNewAms(
    records.map((r: any) => ({ nik: r.nik, nama: r.namaAm, divisi: r.divisi, witel: r.witelAm })),
    "import_performance_telegram"
  );

  const amCount = new Set(records.map(r => r.nik)).size;

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
    importId: imp.id,
  });
});

// ── Internal: Sales Funnel import (Telegram) ──────────────────────────────────
router.post("/import-funnel", async (req, res): Promise<void> => {
  const secret = req.headers["x-telegram-secret"];
  const validSecret = process.env["TELEGRAM_IMPORT_SECRET"] || "telegram-bot-internal-secret-2024";
  if (secret !== validSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { fileData, snapshotDate, period: bodyPeriod, forceOverwrite = false } = req.body as {
    fileData?: string; snapshotDate?: string; period?: string; forceOverwrite?: boolean;
  };

  if (!fileData) {
    res.status(400).json({ error: "fileData (base64) diperlukan" });
    return;
  }

  logger.info({ fileDataSize: fileData.length, snapshotDate, bodyPeriod }, "Internal funnel import: starting");

  let rows: ParsedRow[];
  let fileType = "unknown";
  try {
    // Try Excel first
    rows = parseExcelFromBase64(fileData, undefined);
    fileType = "excel";
    logger.info({ rawCount: rows.length }, "Internal funnel import: parsed as Excel");
  } catch (excelErr: any) {
    // Fallback: try CSV
    try {
      const buffer = Buffer.from(fileData, "base64");
      const text = buffer.toString("utf8");
      const parsed = XLSX.read(text, { type: "string", header: 1 }) as any;
      const rawRows = parsed as any[][];
      if (rawRows.length < 2) throw new Error("CSV kosong atau hanya 1 baris");
      const headers = rawRows[0].map((h: any) => String(h ?? "").trim());
      const dataRows = rawRows.slice(1).filter((r: any[]) => r.some((c: any) => c != null));
      rows = dataRows.map((r: any[]) => {
        const obj: ParsedRow = {};
        headers.forEach((h: string, i: number) => { obj[h] = r[i] ?? null; });
        return obj;
      });
      fileType = "csv";
      logger.info({ rawCount: rows.length }, "Internal funnel import: parsed as CSV");
    } catch (csvErr: any) {
      logger.error({ excelErr: excelErr.message, csvErr: csvErr.message }, "Internal funnel import: both Excel and CSV parsing failed");
      res.status(422).json({ error: `Gagal parsing file: ${excelErr.message}` });
      return;
    }
  }

  const cleaned = cleanFunnelRows(rows, { preferPembuat: true, skipIsReportFilter: true, skipWitelFilter: true });

  if (cleaned.length === 0) {
    res.status(422).json({
      error: "Tidak ada data valid. Pastikan file mengandung kolom witel=SURAMADU dan divisi=DPS/DSS.",
      rawCount: rows.length, cleanedCount: 0,
    });
    return;
  }

  // Detect period
  let tahun: number;
  let bulan: number;
  if (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    const parts = snapshotDate.split("-");
    tahun = parseInt(parts[0], 10);
    bulan = parseInt(parts[1], 10);
  } else {
    const snap = snapshotDate ? new Date(snapshotDate) : new Date();
    tahun = snap.getFullYear();
    bulan = snap.getMonth() + 1;
  }
  const importPeriod = bodyPeriod || `${tahun}${String(bulan).padStart(2, "0")}`;

  // Cek duplikat: jika ada snapshotDate, cek juga snapshotDate (mencegah import file sama di tanggal berbeda)
  const existingConditions = [
    eq(dataImportsTable.type, "funnel"),
    eq(dataImportsTable.period, importPeriod),
  ];
  if (snapshotDate) {
    existingConditions.push(eq(dataImportsTable.snapshotDate, snapshotDate.slice(0, 10)));
  }
  const [existingFunnel] = await db.select().from(dataImportsTable)
    .where(and(...existingConditions));

  if (existingFunnel && !forceOverwrite) {
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

  if (existingFunnel && forceOverwrite) {
    await db.delete(salesFunnelTable).where(eq(salesFunnelTable.importId, existingFunnel.id));
    await db.delete(dataImportsTable).where(eq(dataImportsTable.id, existingFunnel.id));
  }

  const [imp] = await db.insert(dataImportsTable).values({
    type: "funnel",
    rowsImported: cleaned.length,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl: null,
    autoTelegramSent: false,
  }).returning();

  // Insert funnel rows
  const BATCH_SIZE = 200;
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE).map(row => ({
      ...row,
      snapshotDate: snapshotDate || null,
      importId: imp.id,
      nikHandling: row.nikHandling,
      namaPembuatLop: row.namaPembuatLop,
    }));
    await db.insert(salesFunnelTable).values(batch as any);
  }

  // Backfill tahun_anggaran
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

  // Backfill nama_am dari accounts
  const allMasterAms = await db.select().from(accountManagersTable);
  const masterNameByNik = new Map(allMasterAms.map(m => [m.nik, m.nama]));
  const nullNameRows = cleaned.filter(r => !r.namaAm && r.nikAm && masterNameByNik.has(r.nikAm));
  for (const row of nullNameRows) {
    await db.update(salesFunnelTable)
      .set({ namaAm: masterNameByNik.get(row.nikAm) })
      .where(and(eq(salesFunnelTable.importId, imp.id), eq(salesFunnelTable.nikAm, row.nikAm)));
  }

  // Auto-populate master_customer
  const uniqueCustomers = [...new Set(cleaned.map(r => r.pelanggan).filter(p => p && p !== "–"))];
  for (let i = 0; i < uniqueCustomers.length; i += 100) {
    await db.insert(masterCustomerTable).values(
      uniqueCustomers.slice(i, i + 100).map(nama => ({ nama, witel: "SURAMADU" }))
    ).onConflictDoNothing();
  }

  const newFunnelAmCount = await autoRegisterNewAms(
    cleaned.filter(r => r.nikAm).map(r => ({ nik: r.nikAm!, nama: r.namaAm || r.nikAm!, divisi: r.divisi || "DPS", witel: r.witel || "SURAMADU" })),
    "import_funnel_telegram"
  );

  const amCount = new Set(cleaned.map(r => r.nikAm)).size;

  res.json({
    success: true,
    rowsImported: cleaned.length,
    amCount,
    period: importPeriod,
    tahun, bulan,
    snapshotDate: snapshotDate || null,
    rawCount: rows.length,
    cleanedCount: cleaned.length,
    newAmDiscovered: newFunnelAmCount,
    importId: imp.id,
  });
});

// ── Internal: Sales Activity import (Telegram) ───────────────────────────────────
router.post("/import-activity", async (req, res): Promise<void> => {
  const secret = req.headers["x-telegram-secret"];
  const validSecret = process.env["TELEGRAM_IMPORT_SECRET"] || "telegram-bot-internal-secret-2024";
  if (secret !== validSecret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { fileData, snapshotDate, period: bodyPeriod, forceOverwrite = false } = req.body as {
    fileData?: string; snapshotDate?: string; period?: string; forceOverwrite?: boolean;
  };

  if (!fileData) {
    res.status(400).json({ error: "fileData (base64) diperlukan" });
    return;
  }

  logger.info({ fileDataSize: fileData.length, snapshotDate }, "Internal activity import: starting");

  let rows: ParsedRow[];
  try {
    rows = parseExcelFromBase64(fileData, undefined);
    logger.info({ rawCount: rows.length }, "Internal activity import: parsed as Excel");
  } catch (excelErr: any) {
    // Fallback: try CSV
    try {
      const buffer = Buffer.from(fileData, "base64");
      const text = buffer.toString("utf8");
      const parsed = XLSX.read(text, { type: "string", header: 1 }) as any;
      const rawRows = parsed as any[][];
      if (rawRows.length < 2) throw new Error("CSV kosong atau hanya 1 baris");
      const headers = rawRows[0].map((h: any) => String(h ?? "").trim());
      const dataRows = rawRows.slice(1).filter((r: any[]) => r.some((c: any) => c != null));
      rows = dataRows.map((r: any[]) => {
        const obj: ParsedRow = {};
        headers.forEach((h: string, i: number) => { obj[h] = r[i] ?? null; });
        return obj;
      });
      logger.info({ rawCount: rows.length }, "Internal activity import: parsed as CSV");
    } catch (csvErr: any) {
      logger.error({ excelErr: excelErr.message, csvErr: csvErr.message }, "Internal activity import: both Excel and CSV parsing failed");
      res.status(422).json({ error: `Gagal parsing file: ${excelErr.message}` });
      return;
    }
  }

  const cleaned = cleanActivityRows(rows);
  logger.info({ rawCount: rows.length, cleanedCount: cleaned.length }, "Internal activity import: rows cleaned");

  if (cleaned.length === 0) {
    res.status(422).json({
      error: "Tidak ada data valid. Pastikan file mengandung kolom WITEL=SURAMADU dan DIVISI=DPS/DSS.",
      rawCount: rows.length, cleanedCount: 0,
    });
    return;
  }

  // Detect period from snapshotDate or bodyPeriod
  let tahun: number;
  let bulan: number;
  if (snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    const parts = snapshotDate.split("-");
    tahun = parseInt(parts[0], 10);
    bulan = parseInt(parts[1], 10);
  } else {
    const snap = snapshotDate ? new Date(snapshotDate) : new Date();
    tahun = snap.getFullYear();
    bulan = snap.getMonth() + 1;
  }
  const importPeriod = bodyPeriod || `${tahun}${String(bulan).padStart(2, "0")}`;

  // Cek duplikat
  const [existingAct] = await db.select().from(dataImportsTable)
    .where(and(eq(dataImportsTable.type, "activity"), eq(dataImportsTable.period, importPeriod)));

  if (existingAct && !forceOverwrite) {
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

  if (existingAct && forceOverwrite) {
    await db.delete(salesActivityTable).where(eq(salesActivityTable.importId, existingAct.id));
    await db.delete(dataImportsTable).where(eq(dataImportsTable.id, existingAct.id));
  }

  const [imp] = await db.insert(dataImportsTable).values({
    type: "activity",
    rowsImported: 0,
    period: importPeriod,
    snapshotDate: snapshotDate || null,
    sourceUrl: null,
    autoTelegramSent: false,
  }).returning();
  logger.info({ importId: imp.id, recordsToInsert: cleaned.length }, "Internal activity import: DB insert starting");

  // Insert activity rows using batch inserts (same as funnel/performance)
  const BATCH_SIZE = 200;
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE).map(row => ({
      nik: row.nik,
      fullname: row.fullname || null,
      divisi: row.divisi || null,
      nipnas: row.nipnas || null,
      caName: row.caName || null,
      activityType: row.activityType || null,
      label: row.label || null,
      lopid: row.lopid || null,
      activityEndDate: row.activityEndDate || null,
      activityNotes: row.activityNotes || null,
      snapshotDate: snapshotDate || null,
      importId: imp.id,
    }));
    await db.insert(salesActivityTable).values(batch as any);
  }
  logger.info({ importId: imp.id }, "Internal activity import: DB insert complete");

  const count = cleaned.length;
  await db.update(dataImportsTable).set({ rowsImported: count }).where(eq(dataImportsTable.id, imp.id));

  const newActAmCount = await autoRegisterNewAms(
    cleaned.filter(r => r.nik).map(r => ({ nik: r.nik, nama: r.fullname || r.nik, divisi: r.divisi || "DPS", witel: "SURAMADU" })),
    "import_activity_telegram"
  );

  const amCount = new Set(cleaned.map(r => r.nik)).size;

  res.json({
    success: true,
    rowsImported: count,
    amCount,
    period: importPeriod,
    tahun, bulan,
    snapshotDate: snapshotDate || null,
    rawCount: rows.length,
    cleanedCount: cleaned.length,
    newAmDiscovered: newActAmCount,
    importId: imp.id,
  });
});

export default router;
