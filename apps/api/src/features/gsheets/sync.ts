import {
  db, pool, appSettingsTable, dataImportsTable,
  salesFunnelTable, salesActivityTable, performanceDataTable,
  accountManagersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { cleanFunnelRows, cleanActivityRows, parseIndonesianNumber, slugify } from "../import/excel";
import type { ParsedRow } from "../import/excel";
import { logger } from "../../shared/logger";
import { notifyActivitySnapshot, notifyManagerActivitySnapshot } from "../telegram/service";

export interface SheetInfo {
  title: string;
  sheetId: number;
  detectedType: "funnel" | "activity" | "performance";
  spreadsheetId?: string;
}

export interface SyncSheetResult {
  sheetName: string;
  date: string;
  period: string;
  type: "funnel" | "activity" | "performance";
  status: "imported" | "skipped" | "error";
  rowsImported?: number;
  message: string;
}

export interface SyncResult {
  syncedAt: string;
  sheetsFound: number;
  results: SyncSheetResult[];
  error?: string;
}

/** Extract spreadsheet ID from a full Google Sheets URL, or return as-is if already an ID */
export function extractSpreadsheetId(input: string): string {
  if (!input) return input;
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input.trim();
}

/** Patterns that determine sheet type based on name prefix */
const SHEET_PATTERNS: { prefix: string; type: "funnel" | "activity" | "performance" }[] = [
  { prefix: "TREG3_SALES_FUNNEL_", type: "funnel" },
  { prefix: "TREG3_ACTIVITY_", type: "activity" },
  { prefix: "PERFORMANSI_", type: "performance" },
];

/** Detect sheet type from its name. Returns null if no pattern matches */
function detectSheetType(name: string): "funnel" | "activity" | "performance" | null {
  for (const p of SHEET_PATTERNS) {
    if (name.toUpperCase().startsWith(p.prefix.toUpperCase())) return p.type;
  }
  return null;
}

/** Extract YYYY-MM-DD and YYYY-MM from sheet name ending with YYYYMMDD */
function parseDateFromSheetName(name: string): { date: string; period: string } | null {
  const match = name.match(/(\d{8})$/);
  if (!match) return null;
  const raw = match[1];
  const year = raw.slice(0, 4), month = raw.slice(4, 6), day = raw.slice(6, 8);
  const y = parseInt(year), mo = parseInt(month), d = parseInt(day);
  if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { date: `${year}-${month}-${day}`, period: `${year}-${month}` };
}

/** List all sheets in a Google Spreadsheet that match any known pattern */
export async function listAllMatchingSheets(
  spreadsheetId: string,
  apiKey: string,
): Promise<SheetInfo[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${apiKey}&fields=sheets.properties(sheetId,title)`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Google Sheets API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json() as { sheets: { properties: { sheetId: number; title: string } }[] };
  const sheets = data.sheets || [];
  const result: SheetInfo[] = [];
  for (const s of sheets) {
    const title = s.properties.title;
    const detectedType = detectSheetType(title);
    if (detectedType) {
      result.push({ title, sheetId: s.properties.sheetId, detectedType, spreadsheetId });
    }
  }
  return result;
}

/** Legacy: list sheets matching a single pattern (used by "Cek Daftar Sheet" preview) */
export async function listFunnelSheets(
  spreadsheetId: string,
  apiKey: string,
  _pattern: string,
): Promise<{ title: string; sheetId: number }[]> {
  return listAllMatchingSheets(spreadsheetId, apiKey);
}

/** List ALL sheets in a spreadsheet, with auto-detection flag for recognized patterns */
export async function listAllSheets(
  spreadsheetId: string,
  apiKey: string,
): Promise<Array<{ title: string; sheetId: number; detectedType: "funnel" | "activity" | "performance" | null }>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${apiKey}&fields=sheets.properties(sheetId,title)`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Google Sheets API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json() as { sheets: { properties: { sheetId: number; title: string } }[] };
  return (data.sheets || []).map(s => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
    detectedType: detectSheetType(s.properties.title),
  }));
}

/** Import a specific set of sheets (user-selected, with explicit type override) */
export async function syncSelectedSheets(
  selections: Array<{ title: string; sheetId: number; type: "funnel" | "activity" | "performance" }>,
): Promise<SyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const [settings] = await db.select().from(appSettingsTable);
    if (!settings?.gSheetsSpreadsheetId || !settings?.gSheetsApiKey) {
      return { syncedAt, sheetsFound: 0, results: [], error: "Spreadsheet ID atau API Key belum dikonfigurasi" };
    }
    // Funnel sheets use a dedicated spreadsheet if configured (1czGSp nationwide SIMLOP data)
    // Activity/performance sheets use the main spreadsheet (1ojCi6db)
    const funnelSpreadsheetId = extractSpreadsheetId(settings.gSheetsFunnelSpreadsheetId || settings.gSheetsSpreadsheetId);
    const spreadsheetId = extractSpreadsheetId(settings.gSheetsSpreadsheetId);
    const apiKey = settings.gSheetsApiKey;
    const existingImports = await db.select({ type: dataImportsTable.type, period: dataImportsTable.period, sourceUrl: dataImportsTable.sourceUrl, snapshotDate: dataImportsTable.snapshotDate }).from(dataImportsTable);
    const results: SyncSheetResult[] = [];

    for (const sel of selections) {
      const sheet: SheetInfo = { title: sel.title, sheetId: sel.sheetId, detectedType: sel.type, spreadsheetId: sel.spreadsheetId };
      const dateInfo = parseDateFromSheetName(sel.title);
      if (!dateInfo) {
        results.push({ sheetName: sel.title, date: "", period: "", type: sel.type, status: "error", message: "Format tanggal tidak dikenali di nama sheet (harus diakhiri YYYYMMDD)" });
        continue;
      }
      const alreadyFromThisSheet = existingImports.some(i => i.type === sel.type && i.period === dateInfo.period && i.sourceUrl?.includes(sel.title));
      if (alreadyFromThisSheet) {
        results.push({ sheetName: sel.title, date: dateInfo.date, period: dateInfo.period, type: sel.type, status: "skipped", message: "Snapshot ini sudah pernah diimport" });
        continue;
      }
      // Also skip if same snapshot_date already imported from any source
      const alreadySameSnapshot = existingImports.some(i => i.type === sel.type && i.snapshotDate === dateInfo.date);
      if (alreadySameSnapshot) {
        results.push({ sheetName: sel.title, date: dateInfo.date, period: dateInfo.period, type: sel.type, status: "skipped", message: `Snapshot tanggal ${dateInfo.date} sudah ada dari sumber lain, dilewati` });
        continue;
      }
      logger.info({ sheet: sel.title, type: sel.type }, "GSheets sync-selected: importing sheet");
      let result: SyncSheetResult;
      if (sel.type === "funnel") result = await importFunnelSheet(sheet.spreadsheetId || spreadsheetId, sheet, apiKey, dateInfo);
      else if (sel.type === "activity") result = await importActivitySheet(sheet.spreadsheetId || spreadsheetId, sheet, apiKey, dateInfo);
      else result = await importPerformanceSheet(sheet.spreadsheetId || spreadsheetId, sheet, apiKey, dateInfo);
      results.push(result);
    }

    await db.update(appSettingsTable)
      .set({ gSheetsLastSyncAt: new Date(), gSheetsLastSyncResult: JSON.stringify({ syncedAt, sheetsFound: selections.length, results }) })
      .where(eq(appSettingsTable.id, settings.id));

    return { syncedAt, sheetsFound: selections.length, results };
  } catch (err: any) {
    const error = err?.message || String(err);
    logger.error({ err }, "GSheets sync-selected failed");
    return { syncedAt, sheetsFound: 0, results: [], error };
  }
}

/** Fetch a sheet's data as ParsedRow[] via Sheets API v4 values endpoint */
export async function fetchSheetData(
  spreadsheetId: string,
  sheetName: string,
  apiKey: string,
): Promise<ParsedRow[]> {
  const encodedSheet = encodeURIComponent(`'${sheetName}'`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedSheet}?key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Google Sheets API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json() as { values?: string[][] };
  const values = data.values || [];
  if (values.length < 2) return [];

  const row0 = values[0];
  const row0NonNull = row0.filter(v => v !== null && v !== "").length;
  const headerIdx = (row0NonNull === 1 && values.length > 2) ? 1 : 0;
  const headers = values[headerIdx].map(h => String(h ?? "").trim());
  const dataRows = values.slice(headerIdx + 1);

  return dataRows
    .filter(row => row.some(v => v !== null && v !== ""))
    .map(row => {
      const obj: ParsedRow = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = row[i] !== undefined ? row[i] : null;
      });
      return obj;
    });
}

/** Import a single FUNNEL sheet
 *
 * Cleaning rules — exact match to Power BI Power Query "Funnel Suramadu" steps:
 * 1. witel = "SURAMADU"  (same as Power Query step)
 * 2. nik_pembuat_lop to Int64, remove rows with errors  (non-numeric NIK discarded)
 * 3. divisi = "DPS" or "DSS"
 * 4. If report_date.Year >= 2026 AND nik_pembuat_lop = 850099 → remap to 870022 (Havea)
 * 5. Use ONLY nik_pembuat_lop as AM key  (NOT nik_handling)
 * 6. Import ALL years (no year filter at import) — year filter applied at query time by API
 * 7. Deduplicate by lopid — keep latest report_date per lopid
 * 8. Filter to active master AM NIKs only at import time
 *
 * Result: all years stored; GET /api/funnel?tahun=2026 returns exactly 250 LOPs
 */
async function importFunnelSheet(
  spreadsheetId: string, sheet: SheetInfo, apiKey: string,
  dateInfo: { date: string; period: string },
): Promise<SyncSheetResult> {
  const { date, period } = dateInfo;
  try {
    const rows = await fetchSheetData(spreadsheetId, sheet.title, apiKey);
    if (rows.length === 0) {
      return { sheetName: sheet.title, date, period, type: "funnel", status: "error", message: "Sheet kosong atau tidak ada data" };
    }

    // Step 1–4: Apply Power BI cleaning rules exactly
    const cleaned = cleanFunnelRows(rows, {
      skipIsReportFilter: true,  // Power BI has no is_report filter
      pembuatOnly: true,         // Use ONLY nik_pembuat_lop (not nik_handling)
      // witel=SURAMADU and divisi=DPS|DSS filters are NOT skipped (applied by default)
    });
    if (cleaned.length === 0) {
      return { sheetName: sheet.title, date, period, type: "funnel", status: "error", message: `Tidak ada baris valid setelah cleaning dari ${rows.length} baris mentah` };
    }

    // Step 5: Load active account_managers
    const allMasterAms = await db.select().from(accountManagersTable);
    const masterNameByNik = new Map(allMasterAms.map(m => [m.nik, m.nama]));
    const activeNikSet = new Set(allMasterAms.filter(m => m.aktif).map(m => m.nik));

    // Step 6: Filter to active master AMs only (witel already filtered to SURAMADU above)
    const filtered = cleaned.filter(r => r.nikAm && activeNikSet.has(r.nikAm));
    if (filtered.length === 0) {
      return { sheetName: sheet.title, date, period, type: "funnel", status: "error", message: `Tidak ada LOP master AM aktif dari ${cleaned.length} baris (witel=SURAMADU, divisi=DPS|DSS)` };
    }

    // Step 7: Deduplicate by lopid — keep row with latest report_date per lopid
    const dedupMap = new Map<string, typeof filtered[0]>();
    for (const row of filtered) {
      const existing = dedupMap.get(row.lopid);
      if (!existing || (row.reportDate || "") > (existing.reportDate || "")) {
        dedupMap.set(row.lopid, row);
      }
    }
    const deduped = [...dedupMap.values()];

    const [imp] = await db.insert(dataImportsTable).values({
      type: "funnel", rowsImported: deduped.length, period,
      snapshotDate: date,
      sourceUrl: `gsheets:${spreadsheetId}/${sheet.title}`, autoTelegramSent: false,
    }).returning();

    const BATCH = 200;
    for (let i = 0; i < deduped.length; i += BATCH) {
      await db.insert(salesFunnelTable).values(
        deduped.slice(i, i + BATCH).map(row => ({
          ...row,
          snapshotDate: date,
          importId: imp.id,
          namaAm: masterNameByNik.get(row.nikAm) || row.namaAm,
        }))
      );
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

    const count2026 = deduped.filter(r => r.reportDate?.startsWith("2026")).length;
    return {
      sheetName: sheet.title, date, period, type: "funnel", status: "imported", rowsImported: deduped.length,
      message: `${deduped.length} LOP total (${count2026} tahun 2026) dari ${rows.length} baris GSheets. Filter: witel=SURAMADU, divisi=DPS|DSS, nik_pembuat_lop numerik, 13 AM aktif`,
    };
  } catch (err: any) {
    return { sheetName: sheet.title, date, period, type: "funnel", status: "error", message: err?.message || String(err) };
  }
}

/** Import a single ACTIVITY sheet */
async function importActivitySheet(
  spreadsheetId: string, sheet: SheetInfo, apiKey: string,
  dateInfo: { date: string; period: string },
): Promise<SyncSheetResult> {
  const { date, period } = dateInfo;
  try {
    const rows = await fetchSheetData(spreadsheetId, sheet.title, apiKey);
    if (rows.length === 0) {
      return { sheetName: sheet.title, date, period, type: "activity", status: "error", message: "Sheet kosong atau tidak ada data" };
    }

    const cleaned = cleanActivityRows(rows);
    if (cleaned.length === 0) {
      return { sheetName: sheet.title, date, period, type: "activity", status: "error", message: `Tidak ada baris valid setelah cleaning dari ${rows.length} baris mentah` };
    }

    const [imp] = await db.insert(dataImportsTable).values({
      type: "activity", rowsImported: cleaned.length, period,
      snapshotDate: date,
      sourceUrl: `gsheets:${spreadsheetId}/${sheet.title}`, autoTelegramSent: false,
    }).returning();

    const BATCH = 200;
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const batch = cleaned.slice(i, i + BATCH);

      const nik_arr = batch.map(r => r.nik);
      const fullname_arr = batch.map(r => r.fullname || null);
      const divisi_arr = batch.map(r => r.divisi || null);
      const segmen_arr = batch.map(r => r.segmen || null);
      const regional_arr = batch.map(r => r.regional || null);
      const witel_arr = batch.map(r => r.witel || null);
      const nipnas_arr = batch.map(r => r.nipnas || null);
      const caName_arr = batch.map(r => r.caName || null);
      const activityType_arr = batch.map(r => r.activityType || null);
      const label_arr = batch.map(r => r.label || null);
      const lopid_arr = batch.map(r => r.lopid || null);
      const createdat_arr = batch.map(r => r.createdatActivity || null);
      const startDate_arr = batch.map(r => r.activityStartDate || null);
      const endDate_arr = batch.map(r => r.activityEndDate || null);
      const picName_arr = batch.map(r => r.picName || null);
      const picJobtitle_arr = batch.map(r => r.picJobtitle || null);
      const picRole_arr = batch.map(r => r.picRole || null);
      const picPhone_arr = batch.map(r => r.picPhone || null);
      const notes_arr = batch.map(r => r.activityNotes || null);
      const snap_arr = batch.map(() => date || null);
      const imp_arr = batch.map(() => imp.id);

      await pool.query(`
        INSERT INTO sales_activity
          (nik,fullname,divisi,segmen,regional,witel,nipnas,ca_name,activity_type,label,lopid,
           createdat_activity,activity_start_date,activity_end_date,pic_name,pic_jobtitle,
           pic_role,pic_phone,activity_notes,snapshot_date,import_id)
        SELECT * FROM UNNEST(
          $1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],
          $8::text[],$9::text[],$10::text[],$11::text[],$12::text[],$13::text[],$14::text[],
          $15::text[],$16::text[],$17::text[],$18::text[],$19::text[],$20::text[],$21::integer[]
        ) AS t(nik,fullname,divisi,segmen,regional,witel,nipnas,ca_name,activity_type,label,lopid,
                 createdat_activity,activity_start_date,activity_end_date,pic_name,pic_jobtitle,
                 pic_role,pic_phone,activity_notes,snapshot_date,import_id)
      `, [nik_arr, fullname_arr, divisi_arr, segmen_arr, regional_arr, witel_arr, nipnas_arr,
          caName_arr, activityType_arr, label_arr, lopid_arr, createdat_arr, startDate_arr,
          endDate_arr, picName_arr, picJobtitle_arr, picRole_arr, picPhone_arr, notes_arr,
          snap_arr, imp_arr]);
    }

    await db.update(dataImportsTable).set({ rowsImported: cleaned.length }).where(eq(dataImportsTable.id, imp.id));

    // ── Send snapshot notifications (best-effort, fire-and-forget)
    notifyActivitySnapshot(imp.id).catch((err: unknown) => {
      logger.error({ err: err instanceof Error ? err.message : err }, "notifyActivitySnapshot failed in gsheets sync");
    });
    notifyManagerActivitySnapshot(imp.id).catch((err: unknown) => {
      logger.error({ err: err instanceof Error ? err.message : err }, "notifyManagerActivitySnapshot failed in gsheets sync");
    });

    return { sheetName: sheet.title, date, period, type: "activity", status: "imported", rowsImported: cleaned.length, message: `${cleaned.length} baris berhasil diimport dari ${rows.length} baris mentah` };
  } catch (err: any) {
    return { sheetName: sheet.title, date, period, type: "activity", status: "error", message: err?.message || String(err) };
  }
}

/** Import a single PERFORMANCE (PERFORMANSI) sheet — RAW format aggregation */
async function importPerformanceSheet(
  spreadsheetId: string, sheet: SheetInfo, apiKey: string,
  dateInfo: { date: string; period: string },
): Promise<SyncSheetResult> {
  const { date, period } = dateInfo;
  try {
    const rows = await fetchSheetData(spreadsheetId, sheet.title, apiKey);
    if (rows.length === 0) {
      return { sheetName: sheet.title, date, period, type: "performance", status: "error", message: "Sheet kosong atau tidak ada data" };
    }

    const [y, m] = period.split("-").map(Number);
    const amMap = new Map<string, any>();

    for (const r of rows) {
      const nik = String(r.NIK || r.nik || "").trim();
      const namaAm = String(r.NAMA_AM || r.nama_am || "").trim();
      const divisiRaw = String(r.DIVISI_CC || r.divisi_cc || r.DIVISI_AM || r.divisi || "").trim();
      if (!nik || !namaAm) continue;
      if (divisiRaw.toUpperCase() === "DGS") continue;

      // Group by NIK + PERIODE to get per-month rows (same as Excel import in routes.ts)
      const periodeStr = String(r.PERIODE || "").trim();
      const key = periodeStr ? `${nik}__${periodeStr}` : nik;
      const tReg = parseIndonesianNumber(r.TARGET_REVENUE ?? r.target_revenue);
      const rReg = parseIndonesianNumber(r.REAL_REVENUE ?? r.real_revenue);
      const tSustain = parseIndonesianNumber(r.TARGET_SUSTAIN ?? r.target_sustain ?? 0);
      const rSustain = parseIndonesianNumber(r.REAL_SUSTAIN ?? r.real_sustain ?? 0);
      const tScaling = parseIndonesianNumber(r.TARGET_SCALING ?? r.target_scaling ?? 0);
      const rScaling = parseIndonesianNumber(r.REAL_SCALING ?? r.real_scaling ?? 0);
      const tNgtma = parseIndonesianNumber(r.TARGET_NGTMA ?? r.target_ngtma ?? 0);
      const rNgtma = parseIndonesianNumber(r.REAL_NGTMA ?? r.real_ngtma ?? 0);

      const pelanggan = String(r.STANDARD_NAME || r.NAMA_PELANGGAN || r.PELANGGAN || "").trim();
      const nip = String(r.NIP_NAS || r.NIP || "").trim();
      const proporsi = (parseFloat(String(r.PROPORSI ?? 0)) || 0) * 100;
      const targetTotal = tReg + tSustain + tScaling + tNgtma;
      const realTotal = rReg + rSustain + rScaling + rNgtma;

      // Parse tahun/bulan from PERIODE column (e.g. "202601" → tahun=2026, bulan=1)
      let tahun = y, bulan = m;
      if (periodeStr && /^\d{6}$/.test(periodeStr)) {
        tahun = parseInt(periodeStr.slice(0, 4));
        bulan = parseInt(periodeStr.slice(4, 6));
      }

      if (!amMap.has(key)) {
        amMap.set(key, {
          nik, namaAm, divisi: divisiRaw,
          witel: String(r.WITEL_AM || r.witel || "SURAMADU").trim(),
          levelAm: String(r.LEVEL_AM || r.level_am || "").trim(),
          tahun, bulan,
          target: 0, real: 0,
          tReg: 0, rReg: 0, tSustain: 0, rSustain: 0,
          tScaling: 0, rScaling: 0, tNgtma: 0, rNgtma: 0,
          customers: [],
        });
      }
      const entry = amMap.get(key)!;
      entry.target += targetTotal; entry.real += realTotal;
      entry.tReg += tReg; entry.rReg += rReg;
      entry.tSustain += tSustain; entry.rSustain += rSustain;
      entry.tScaling += tScaling; entry.rScaling += rScaling;
      entry.tNgtma += tNgtma; entry.rNgtma += rNgtma;
      if (pelanggan || nip) {
        entry.customers.push({ nip, pelanggan, proporsi,
          group: String(r.GROUP || "").trim(), industri: String(r.INDUSTRI || "").trim(),
          targetTotal, realTotal,
        });
      }
    }

    const toInsert = [...amMap.values()].map(entry => {
      const achRate = entry.target > 0 ? entry.real / entry.target : 0;
      return {
        nik: entry.nik, namaAm: entry.namaAm, divisi: entry.divisi,
        witelAm: entry.witel || null, levelAm: entry.levelAm || null,
        tahun: entry.tahun, bulan: entry.bulan,
        targetRevenue: entry.target, realRevenue: entry.real,
        targetReguler: entry.tReg, realReguler: entry.rReg,
        targetSustain: entry.tSustain, realSustain: entry.rSustain,
        targetScaling: entry.tScaling, realScaling: entry.rScaling,
        targetNgtma: entry.tNgtma, realNgtma: entry.rNgtma,
        achRate, achRateYtd: achRate, rankAch: 0,
        statusWarna: achRate >= 1 ? "hijau" : achRate >= 0.8 ? "oranye" : "merah",
        snapshotDate: date,
        komponenDetail: entry.customers.length > 0 ? JSON.stringify(entry.customers) : null,
      };
    }).filter(r => r.nik && r.namaAm);

    if (toInsert.length === 0) {
      return { sheetName: sheet.title, date, period, type: "performance", status: "error", message: `Tidak ada baris valid setelah aggregasi dari ${rows.length} baris mentah` };
    }

    const [imp] = await db.insert(dataImportsTable).values({
      type: "performance", rowsImported: toInsert.length, period,
      snapshotDate: date,
      sourceUrl: `gsheets:${spreadsheetId}/${sheet.title}`, autoTelegramSent: false,
    }).returning();

    const BATCH = 200;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await db.insert(performanceDataTable).values(
        toInsert.slice(i, i + BATCH).map(row => ({ ...row, importId: imp.id }))
      );
    }

    const existingAMs = await db.select().from(accountManagersTable);
    const existingNiks = new Set(existingAMs.map((a: any) => a.nik));
    const newAMs = toInsert.filter(r => !existingNiks.has(r.nik) && r.nik).map(r => ({
      nik: r.nik, nama: r.namaAm, slug: slugify(r.namaAm),
      divisi: r.divisi, witel: r.witelAm || "SURAMADU",
    }));
    for (let i = 0; i < newAMs.length; i += 50) {
      await db.insert(accountManagersTable).values(newAMs.slice(i, i + 50)).onConflictDoNothing();
    }

    return { sheetName: sheet.title, date, period, type: "performance", status: "imported", rowsImported: toInsert.length, message: `${toInsert.length} AM berhasil diimport dari ${rows.length} baris mentah` };
  } catch (err: any) {
    return { sheetName: sheet.title, date, period, type: "performance", status: "error", message: err?.message || String(err) };
  }
}

/** Main sync function: detect all matching sheets, skip existing, import new ones */
export async function runGSheetsSync(): Promise<SyncResult> {
  const syncedAt = new Date().toISOString();

  try {
    const [settings] = await db.select().from(appSettingsTable);
    if (!settings?.gSheetsSpreadsheetId || !settings?.gSheetsApiKey) {
      return { syncedAt, sheetsFound: 0, results: [], error: "Spreadsheet ID atau API Key belum dikonfigurasi" };
    }

    const spreadsheetId = extractSpreadsheetId(settings.gSheetsSpreadsheetId);
    const funnelSpreadsheetId = extractSpreadsheetId(settings.gSheetsFunnelSpreadsheetId || settings.gSheetsSpreadsheetId);
    const apiKey = settings.gSheetsApiKey;

    // List sheets from both spreadsheets (funnel from 1czGSp, activity/performance from 1ojCi6db)
    const mainSheets = await listAllMatchingSheets(spreadsheetId, apiKey);
    const funnelSheets = funnelSpreadsheetId !== spreadsheetId
      ? await listAllMatchingSheets(funnelSpreadsheetId, apiKey).catch(() => [] as SheetInfo[])
      : [];
    const sheets = [...mainSheets, ...funnelSheets];
    if (sheets.length === 0) {
      return { syncedAt, sheetsFound: 0, results: [], error: "Tidak ada sheet ditemukan dengan pola yang dikenali (TREG3_SALES_FUNNEL_, TREG3_ACTIVITY_, PERFORMANSI_)" };
    }

    // Load existing imports for all 3 types for dedup check
    const existingImports = await db.select({ type: dataImportsTable.type, period: dataImportsTable.period, sourceUrl: dataImportsTable.sourceUrl, snapshotDate: dataImportsTable.snapshotDate })
      .from(dataImportsTable);

    const existingByType: Record<string, Set<string>> = { funnel: new Set(), activity: new Set(), performance: new Set() };
    for (const imp of existingImports) {
      if (imp.type && imp.period) existingByType[imp.type]?.add(imp.period);
    }

    const results: SyncSheetResult[] = [];

    for (const sheet of sheets) {
      const dateInfo = parseDateFromSheetName(sheet.title);
      if (!dateInfo) {
        results.push({ sheetName: sheet.title, date: "", period: "", type: sheet.detectedType, status: "error", message: "Format tanggal tidak dikenali di nama sheet" });
        continue;
      }

      const { date, period } = dateInfo;
      const type = sheet.detectedType;

      // Skip if same sheet name already imported
      const alreadyFromThisSheet = existingImports.some(i =>
        i.type === type && i.period === period && i.sourceUrl?.includes(sheet.title)
      );
      if (alreadyFromThisSheet) {
        results.push({ sheetName: sheet.title, date, period, type, status: "skipped", message: "Snapshot dengan nama sheet ini sudah ada, dilewati" });
        continue;
      }

      // Also skip if same snapshot_date already imported from any source (prevents Drive+GSheets duplicate)
      const alreadySameSnapshot = existingImports.some(i => i.type === type && i.snapshotDate === date);
      if (alreadySameSnapshot) {
        results.push({ sheetName: sheet.title, date, period, type, status: "skipped", message: `Snapshot tanggal ${date} sudah ada dari sumber lain (import sebelumnya), dilewati` });
        continue;
      }

      logger.info({ sheet: sheet.title, type, date }, "GSheets sync: importing sheet");

      let result: SyncSheetResult;
      if (type === "funnel") {
        result = await importFunnelSheet(sheet.spreadsheetId || funnelSpreadsheetId, sheet, apiKey, dateInfo);
      } else if (type === "activity") {
        result = await importActivitySheet(sheet.spreadsheetId || spreadsheetId, sheet, apiKey, dateInfo);
      } else {
        result = await importPerformanceSheet(sheet.spreadsheetId || spreadsheetId, sheet, apiKey, dateInfo);
      }

      if (result.status === "imported") existingByType[type]?.add(period);
      results.push(result);
    }

    await db.update(appSettingsTable)
      .set({ gSheetsLastSyncAt: new Date(), gSheetsLastSyncResult: JSON.stringify({ syncedAt, sheetsFound: sheets.length, results }) })
      .where(eq(appSettingsTable.id, settings.id));

    return { syncedAt, sheetsFound: sheets.length, results };
  } catch (err: any) {
    const error = err?.message || String(err);
    logger.error({ err }, "GSheets sync failed");
    try {
      const [settings] = await db.select().from(appSettingsTable);
      if (settings) {
        await db.update(appSettingsTable)
          .set({ gSheetsLastSyncAt: new Date(), gSheetsLastSyncResult: JSON.stringify({ syncedAt, sheetsFound: 0, results: [], error }) })
          .where(eq(appSettingsTable.id, settings.id));
      }
    } catch {}
    return { syncedAt, sheetsFound: 0, results: [], error };
  }
}
