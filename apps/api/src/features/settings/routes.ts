import { Router, type IRouter } from "express";
import { db, appSettingsTable, accountManagersTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { requireAuth } from "../../shared/auth";
import { rescheduleGSheets } from "../gsheets/scheduler";
import { rescheduleGDrive } from "../gdrive/scheduler";
import { rescheduleTelegramPoller, stopTelegramPoller } from "../telegram/poller";

const router: IRouter = Router();

function buildSettingsResponse(settings: typeof appSettingsTable.$inferSelect) {
  return {
    telegramBotToken: settings.telegramBotToken ? "***" + settings.telegramBotToken.slice(-6) : null,
    sharepointPerformanceUrl: settings.sharepointPerformanceUrl,
    sharepointFunnelUrl: settings.sharepointFunnelUrl,
    sharepointActivityUrl: settings.sharepointActivityUrl,
    autoSendOnImport: settings.autoSendOnImport,
    kpiActivityDefault: settings.kpiActivityDefault,
    // Google Sheets
    gSheetsSpreadsheetId: settings.gSheetsSpreadsheetId,
    gSheetsApiKey: settings.gSheetsApiKey ? "***" + settings.gSheetsApiKey.slice(-6) : null,
    gSheetsFunnelPattern: settings.gSheetsFunnelPattern ?? "TREG3_SALES_FUNNEL_",
    gSheetsSyncEnabled: settings.gSheetsSyncEnabled,
    gSheetsSyncHourWib: settings.gSheetsSyncHourWib,
    gSheetsSyncIntervalDays: settings.gSheetsSyncIntervalDays,
    gSheetsLastSyncAt: settings.gSheetsLastSyncAt?.toISOString() ?? null,
    // Google Drive folders
    gDriveFolderPerformance: settings.gDriveFolderPerformance,
    gDriveFolderFunnel: settings.gDriveFolderFunnel,
    gDriveFolderActivity: settings.gDriveFolderActivity,
    gDriveFolderTarget: settings.gDriveFolderTarget,
    // Google Drive scheduler
    gDriveSyncEnabled: settings.gDriveSyncEnabled,
    gDriveSyncHourWib: settings.gDriveSyncHourWib,
    gDriveSyncIntervalDays: settings.gDriveSyncIntervalDays,
    gDriveLastCheckAt: settings.gDriveLastCheckAt?.toISOString() ?? null,
  };
}

router.get("/", requireAuth, async (req, res): Promise<void> => {
  let [settings] = await db.select().from(appSettingsTable);
  if (!settings) {
    [settings] = await db.insert(appSettingsTable).values({
      autoSendOnImport: true,
      kpiActivityDefault: 30,
    }).returning();
  }
  res.json(buildSettingsResponse(settings));
});

router.patch("/", requireAuth, async (req, res): Promise<void> => {
  const {
    telegramBotToken, sharepointPerformanceUrl, sharepointFunnelUrl, sharepointActivityUrl,
    autoSendOnImport, kpiActivityDefault,
    gSheetsSpreadsheetId, gSheetsApiKey, gSheetsFunnelPattern,
    gSheetsSyncEnabled, gSheetsSyncHourWib, gSheetsSyncIntervalDays,
    gDriveFolderPerformance, gDriveFolderFunnel, gDriveFolderActivity, gDriveFolderTarget,
    gDriveSyncEnabled, gDriveSyncHourWib, gDriveSyncIntervalDays,
  } = req.body;

  const [existing] = await db.select().from(appSettingsTable);
  const updates: Partial<typeof appSettingsTable.$inferInsert> = {};

  if (telegramBotToken !== undefined && !telegramBotToken.startsWith("***")) updates.telegramBotToken = telegramBotToken;
  if (sharepointPerformanceUrl !== undefined) updates.sharepointPerformanceUrl = sharepointPerformanceUrl;
  if (sharepointFunnelUrl !== undefined) updates.sharepointFunnelUrl = sharepointFunnelUrl;
  if (sharepointActivityUrl !== undefined) updates.sharepointActivityUrl = sharepointActivityUrl;
  if (autoSendOnImport !== undefined) updates.autoSendOnImport = autoSendOnImport;
  if (kpiActivityDefault !== undefined) updates.kpiActivityDefault = kpiActivityDefault;
  // Google Sheets
  if (gSheetsSpreadsheetId !== undefined) updates.gSheetsSpreadsheetId = gSheetsSpreadsheetId || null;
  if (gSheetsApiKey !== undefined && !String(gSheetsApiKey).startsWith("***")) updates.gSheetsApiKey = gSheetsApiKey || null;
  if (gSheetsFunnelPattern !== undefined) updates.gSheetsFunnelPattern = gSheetsFunnelPattern || "TREG3_SALES_FUNNEL_";
  if (gSheetsSyncEnabled !== undefined) updates.gSheetsSyncEnabled = Boolean(gSheetsSyncEnabled);
  if (gSheetsSyncHourWib !== undefined) updates.gSheetsSyncHourWib = Number(gSheetsSyncHourWib) || 6;
  if (gSheetsSyncIntervalDays !== undefined) updates.gSheetsSyncIntervalDays = Number(gSheetsSyncIntervalDays) || 1;
  // Google Drive folders
  if (gDriveFolderPerformance !== undefined) updates.gDriveFolderPerformance = gDriveFolderPerformance || null;
  if (gDriveFolderFunnel !== undefined) updates.gDriveFolderFunnel = gDriveFolderFunnel || null;
  if (gDriveFolderActivity !== undefined) updates.gDriveFolderActivity = gDriveFolderActivity || null;
  if (gDriveFolderTarget !== undefined) updates.gDriveFolderTarget = gDriveFolderTarget || null;
  // Google Drive scheduler
  if (gDriveSyncEnabled !== undefined) updates.gDriveSyncEnabled = Boolean(gDriveSyncEnabled);
  if (gDriveSyncHourWib !== undefined) updates.gDriveSyncHourWib = Number(gDriveSyncHourWib) || 7;
  if (gDriveSyncIntervalDays !== undefined) updates.gDriveSyncIntervalDays = Number(gDriveSyncIntervalDays) || 1;

  updates.updatedAt = new Date();

  // Simpan nilai KPI lama sebelum update (untuk reset per-AM override)
  const oldKpiDefault = existing?.kpiActivityDefault ?? 30;

  let settings;
  if (existing) {
    [settings] = await db.update(appSettingsTable).set(updates).returning();
  } else {
    [settings] = await db.insert(appSettingsTable).values({
      autoSendOnImport: autoSendOnImport ?? true,
      kpiActivityDefault: kpiActivityDefault ?? 30,
      ...updates,
    }).returning();
  }

  // Jika KPI default berubah, reset semua AM yang override-nya = nilai lama ke NULL
  // supaya mereka mengikuti default baru
  if (kpiActivityDefault !== undefined && kpiActivityDefault !== oldKpiDefault) {
    await db.update(accountManagersTable)
      .set({ kpiActivity: null })
      .where(eq(accountManagersTable.kpiActivity, oldKpiDefault));
  }

  rescheduleGSheets();
  rescheduleGDrive();
  if (updates.telegramBotToken) {
    rescheduleTelegramPoller(updates.telegramBotToken);
    // Auto-fetch and cache bot username
    try {
      const r = await fetch(`https://api.telegram.org/bot${updates.telegramBotToken}/getMe`);
      const d = await r.json() as { ok: boolean; result?: { username: string } };
      if (d.ok && d.result?.username) {
        updates.telegramBotUsername = d.result.username;
      }
    } catch { /* ignore */ }
  }

  res.json(buildSettingsResponse(settings));
});

// Reset manual: set semua kpi_activity yang sama dengan default ke NULL
// supaya AM mengikuti default baru. AM dengan custom value berbeda dibiarkan.
router.post("/reset-kpi-overrides", requireAuth, async (_req, res): Promise<void> => {
  const [settings] = await db.select({ kpiActivityDefault: appSettingsTable.kpiActivityDefault }).from(appSettingsTable).limit(1);
  const currentDefault = settings?.kpiActivityDefault ?? 30;

  // Ambil semua AM yang punya override
  const ams = await db.select({ nik: accountManagersTable.nik, kpiActivity: accountManagersTable.kpiActivity })
    .from(accountManagersTable)
    .where(isNotNull(accountManagersTable.kpiActivity));

  // Reset semua AM ke NULL (override dihapus, akan ikut default)
  if (ams.length > 0) {
    await db.update(accountManagersTable)
      .set({ kpiActivity: null })
      .where(isNotNull(accountManagersTable.kpiActivity));
  }

  res.json({ message: "KPI override per-AM berhasil direset ke default", kpiDefault: currentDefault, resetCount: ams.length });
});

// DELETE /settings/telegram-bot — Hapus bot token (lepas integrasi bot)
router.delete("/telegram-bot", requireAuth, async (_req, res): Promise<void> => {
  await db.update(appSettingsTable).set({ telegramBotToken: null, updatedAt: new Date() });
  stopTelegramPoller();
  res.json({ success: true });
});

export default router;
