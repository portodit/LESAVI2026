import { db, appSettingsTable } from "@workspace/db";
import { runGSheetsSync } from "./sync";
import { logger } from "../../shared/logger";
import { notifyImportSnapshot } from "../telegram/importNotifier";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/** Convert a WIB hour (UTC+7) to the next Date object in UTC */
function nextRunTime(hourWib: number, intervalDays: number): Date {
  const now = new Date();
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowWib = new Date(now.getTime() + WIB_OFFSET_MS);

  // Build a candidate run date in WIB
  const candidate = new Date(nowWib);
  candidate.setUTCHours(hourWib, 0, 0, 0);

  // If it's already past today's window, jump by intervalDays
  if (candidate <= nowWib) {
    candidate.setUTCDate(candidate.getUTCDate() + intervalDays);
  }

  // Convert back to UTC
  return new Date(candidate.getTime() - WIB_OFFSET_MS);
}

async function tick() {
  logger.info("GSheets scheduled sync triggered");
  try {
    const result = await runGSheetsSync();
    const imported = result.results.filter(r => r.status === "imported").length;
    const skipped = result.results.filter(r => r.status === "skipped").length;
    const errors = result.results.filter(r => r.status === "error").length;
    logger.info({ imported, skipped, errors, sheetsFound: result.sheetsFound }, "GSheets scheduled sync complete");

    // Auto-send Telegram notifications for newly imported sheets
    if (imported > 0) {
      const [settings] = await db.select().from(appSettingsTable);
      if (settings?.autoSendOnImport && settings?.telegramBotToken) {
        const importedResults = result.results.filter(r => r.status === "imported" && r.importId != null);
        for (const r of importedResults) {
          logger.info({ type: r.type, importId: r.importId, sheetName: r.sheetName }, "GSheets scheduler: triggering Telegram notification");
          await notifyImportSnapshot(r.type, r.importId!).catch((err) =>
            logger.error({ err, type: r.type }, "GSheets scheduler notification failed"),
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "GSheets scheduled sync failed");
  }
  // Re-schedule next run
  scheduleNext();
}

async function scheduleNext() {
  if (schedulerTimer) { clearTimeout(schedulerTimer); schedulerTimer = null; }
  try {
    const [settings] = await db.select().from(appSettingsTable);
    if (!settings?.gSheetsSyncEnabled) return;

    const hourWib = settings.gSheetsSyncHourWib ?? 6;
    const intervalDays = settings.gSheetsSyncIntervalDays ?? 1;
    const runAt = nextRunTime(hourWib, intervalDays);
    const delayMs = runAt.getTime() - Date.now();

    logger.info({ runAt: runAt.toISOString(), delayMs }, "GSheets sync scheduled");
    schedulerTimer = setTimeout(tick, delayMs);
  } catch (err) {
    logger.error({ err }, "Failed to schedule GSheets sync");
  }
}

export function startGSheetsScheduler() {
  scheduleNext();
}

/** Call this when settings change to reschedule with new config */
export function rescheduleGSheets() {
  scheduleNext();
}
