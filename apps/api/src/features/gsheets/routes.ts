import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { requireAuth } from "../../shared/auth";
import { runGSheetsSync, listAllSheets, syncSelectedSheets, extractSpreadsheetId, type SyncResult } from "./sync";
import { notifyImportSnapshot } from "../telegram/importNotifier";
import { logger } from "../../shared/logger";

const router: IRouter = Router();

/** Kirim notifikasi Telegram untuk sheet yang barusan diimport — template sama dengan import via bot. */
async function triggerSyncReminders(result: SyncResult): Promise<void> {
  if (!result.results || result.results.length === 0) return;
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.autoSendOnImport || !settings?.telegramBotToken) return;

  const imported = result.results.filter((r) => r.status === "imported" && r.importId != null);
  if (imported.length === 0) return;

  for (const r of imported) {
    logger.info({ type: r.type, importId: r.importId, sheetName: r.sheetName }, "GSheets: triggering Telegram notification");
    await notifyImportSnapshot(r.type, r.importId!).catch((err) =>
      logger.error({ err, type: r.type }, "GSheets Telegram notification failed"),
    );
  }
}

// ── Manual sync trigger (all auto-detected sheets) ─────────────────────────────
router.post("/sync", requireAuth, async (req, res): Promise<void> => {
  const result = await runGSheetsSync();
  // Auto-send Telegram reminders for newly imported sheets
  triggerSyncReminders(result).catch((err) => logger.error({ err }, "GDrive sync reminders failed"));
  res.json(result);
});

// ── Import selected sheets with explicit type ──────────────────────────────────
router.post("/sync-selected", requireAuth, async (req, res): Promise<void> => {
  const { selections } = req.body as {
    selections: Array<{ title: string; sheetId: number; type: "funnel" | "activity" | "performance" }>;
  };
  if (!Array.isArray(selections) || selections.length === 0) {
    res.status(400).json({ error: "Pilih minimal satu sheet untuk diimport" });
    return;
  }
  const result = await syncSelectedSheets(selections);
  // Auto-send Telegram reminders for newly imported sheets
  triggerSyncReminders(result).catch((err) => logger.error({ err }, "GDrive sync-selected reminders failed"));
  res.json(result);
});

// ── Preview all available sheets (with auto-detection hints) ───────────────────
router.get("/sheets", requireAuth, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.gSheetsSpreadsheetId || !settings?.gSheetsApiKey) {
    res.status(400).json({ error: "Spreadsheet ID atau API Key belum dikonfigurasi" });
    return;
  }
  try {
    const sheets = await listAllSheets(extractSpreadsheetId(settings.gSheetsSpreadsheetId), settings.gSheetsApiKey);
    res.json({ sheets });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Last sync result ──────────────────────────────────────────────────────────
router.get("/sync-status", requireAuth, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings) { res.json({ configured: false }); return; }
  res.json({
    configured: !!(settings.gSheetsSpreadsheetId && settings.gSheetsApiKey),
    syncEnabled: settings.gSheetsSyncEnabled,
    syncHourWib: settings.gSheetsSyncHourWib,
    syncIntervalDays: settings.gSheetsSyncIntervalDays,
    lastSyncAt: settings.gSheetsLastSyncAt?.toISOString() ?? null,
    lastSyncResult: settings.gSheetsLastSyncResult ? JSON.parse(settings.gSheetsLastSyncResult) : null,
  });
});

export default router;
