import { Router, type IRouter } from "express";
import { db, appSettingsTable, driveReadLogsTable } from "@workspace/db";
import { requireAuth } from "../../shared/auth";
import { desc, eq, and, sql } from "drizzle-orm";
import { detectPeriod, extractSnapshotDateFromUrl, slugify } from "../import/excel";
import { downloadDriveFileAsRows, runDriveImport } from "./importer";
import { checkDriveFolderAndLog } from "./scheduler";
import { notifyImportSnapshot } from "../telegram/importNotifier";
import { logger } from "../../shared/logger";

const router: IRouter = Router();

/** Kirim notifikasi Telegram setelah import GDrive sukses — template sama dengan import via bot. */
async function triggerGdriveReminders(type: string, importId: number): Promise<void> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.autoSendOnImport || !settings?.telegramBotToken) {
    logger.info({ autoSendOnImport: settings?.autoSendOnImport, hasToken: !!settings?.telegramBotToken }, "GDrive reminder skipped: setting disabled");
    return;
  }
  if (type !== "funnel" && type !== "activity" && type !== "performance") return;
  logger.info({ type, importId }, "GDrive sync: triggering Telegram notifications");
  const { am, manager } = await notifyImportSnapshot(type, importId);
  logger.info({ type, importId, amSent: am.sent, managerSent: manager.sent }, "GDrive Telegram notification result");
}

const DRIVE_FOLDER_KEYS: Record<string, keyof typeof appSettingsTable.$inferSelect> = {
  performance: "gDriveFolderPerformance",
  funnel: "gDriveFolderFunnel",
  activity: "gDriveFolderActivity",
  target: "gDriveFolderTarget",
};

function extractFolderId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url.trim())) return url.trim();
  return null;
}

async function listDriveFiles(folderId: string, apiKey: string) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size)");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime+desc&key=${apiKey}&fields=${fields}&pageSize=50`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Drive API error ${res.status}: ${body}`);
  }
  const data: any = await res.json();
  return (data.files || []) as Array<{ id: string; name: string; mimeType: string; modifiedTime: string; size?: string }>;
}

const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isSupportedFile(name: string, mimeType: string): boolean {
  return (
    name.endsWith(".xlsx") || name.endsWith(".xls") ||
    mimeType === XLSX_MIME ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === GOOGLE_SHEET_MIME
  );
}

// ── GET /api/gdrive/list?type=performance ─────────────────────────────────────
router.get("/list", requireAuth, async (req, res): Promise<void> => {
  const { type } = req.query;
  const folderKey = DRIVE_FOLDER_KEYS[String(type)];
  if (!folderKey) { res.status(400).json({ error: "type tidak valid" }); return; }

  const [settings] = await db.select().from(appSettingsTable);
  const apiKey = settings?.gSheetsApiKey;
  const folderUrl = settings?.[folderKey] as string | null | undefined;

  if (!apiKey) { res.status(400).json({ error: "Google API Key belum dikonfigurasi di tab Google Sheets" }); return; }
  if (!folderUrl) { res.status(400).json({ error: `URL folder Google Drive untuk ${type} belum dikonfigurasi` }); return; }

  const folderId = extractFolderId(folderUrl);
  if (!folderId) { res.status(400).json({ error: "URL folder Google Drive tidak valid" }); return; }

  try {
    const files = await listDriveFiles(folderId, apiKey);
    const excelFiles = files.filter(f => isSupportedFile(f.name, f.mimeType));
    res.json({ files: excelFiles, folderId, folderUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/gdrive/sync?type=performance ────────────────────────────────────
router.post("/sync", requireAuth, async (req, res): Promise<void> => {
  const { type } = req.query;
  const { fileId: explicitFileId, snapshotDate: snapshotDateBodyOverride, sheetName } = req.body;
  const folderKey = DRIVE_FOLDER_KEYS[String(type)];
  if (!folderKey) { res.status(400).json({ error: "type tidak valid" }); return; }

  const [settings] = await db.select().from(appSettingsTable);
  const apiKey = settings?.gSheetsApiKey;
  const folderUrl = settings?.[folderKey] as string | null | undefined;

  if (!apiKey) { res.status(400).json({ error: "Google API Key belum dikonfigurasi" }); return; }
  if (!folderUrl) { res.status(400).json({ error: `URL folder Google Drive untuk ${type} belum dikonfigurasi` }); return; }

  const folderId = extractFolderId(folderUrl);
  if (!folderId) { res.status(400).json({ error: "URL folder Google Drive tidak valid" }); return; }

  try {
    const files = await listDriveFiles(folderId, apiKey);
    const excelFiles = files.filter(f => isSupportedFile(f.name, f.mimeType));
    if (excelFiles.length === 0) { res.status(404).json({ error: "Tidak ada file Excel/Google Sheets di folder ini" }); return; }

    const targetFile = explicitFileId
      ? excelFiles.find(f => f.id === explicitFileId) || excelFiles[0]
      : excelFiles[0];

    const MAX_FILE_SIZE_MB = 30;
    const fileSizeMB = targetFile.size ? Number(targetFile.size) / 1024 / 1024 : 0;
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      res.status(413).json({
        error: `File terlalu besar (${fileSizeMB.toFixed(1)} MB, max ${MAX_FILE_SIZE_MB} MB). ` +
          `Konversikan ke format Google Sheets terlebih dahulu: buka file di Google Drive → klik kanan → "Buka dengan Google Sheets" → file baru akan muncul di folder yang sama dalam format Google Sheets yang bisa diproses.`,
        fileSizeMB: parseFloat(fileSizeMB.toFixed(1)),
        maxSizeMB: MAX_FILE_SIZE_MB,
        fileName: targetFile.name,
      });
      return;
    }

    const snapshotDate = snapshotDateBodyOverride || extractSnapshotDateFromUrl(targetFile.name) || new Date().toISOString().slice(0, 10);

    const result = await runDriveImport(
      String(type) as "performance" | "funnel" | "activity" | "target",
      targetFile.id,
      targetFile.mimeType,
      targetFile.name,
      apiKey,
      snapshotDate,
      sheetName || undefined,
    );

    // ── Trigger Telegram reminder for successfully imported data ────────────
    if (result && (result as any).importId) {
      triggerGdriveReminders(String(type), (result as any).importId).catch((err) => {
        logger.error({ err, type: String(type) }, "GDrive sync notification failed");
      });
    }

    res.json({ ...result, fileName: targetFile.name, fileModified: targetFile.modifiedTime, snapshotDate });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/gdrive/read-logs — riwayat baca folder ──────────────────────────
router.get("/read-logs", requireAuth, async (req, res): Promise<void> => {
  const { type, limit: limitRaw } = req.query;
  const limit = Math.min(Number(limitRaw) || 50, 200);

  try {
    let query = db.select().from(driveReadLogsTable).orderBy(desc(driveReadLogsTable.checkedAt)).limit(limit);
    // We can't conditionally chain where easily here — just fetch and filter
    const rows = await db.select().from(driveReadLogsTable)
      .orderBy(desc(driveReadLogsTable.checkedAt))
      .limit(limit);

    const filtered = type && type !== "all"
      ? rows.filter(r => r.type === String(type))
      : rows;

    res.json({ logs: filtered });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/gdrive/check-now?type=all — cek semua folder sekarang ───────────
router.post("/check-now", requireAuth, async (req, res): Promise<void> => {
  const { type } = req.query;
  const types = (type && type !== "all")
    ? [String(type) as "performance" | "funnel" | "activity" | "target"]
    : (["performance", "funnel", "activity", "target"] as const);

  try {
    const [settings] = await db.select().from(appSettingsTable);
    if (!settings) { res.status(500).json({ error: "Settings tidak ditemukan" }); return; }

    const results = [];
    for (const t of types) {
      const log = await checkDriveFolderAndLog(t, settings, "manual");
      results.push(log);
    }

    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
