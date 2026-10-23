/**
 * Scheduler in-process untuk [REMINDER LOP STAGNAN].
 *
 * Meniru pola scheduler gSheets/gDrive: setTimeout mandiri, tanpa cron
 * eksternal. Default interval 3 hari, jam 9 WIB, dan dilewati bila
 * stagnant_reminder_enabled=false.
 */

import { logger } from "../../shared/logger";
import {
  loadAnnouncementSettings,
  notifyStagnantReminder,
  notifyStagnantManagerReminder,
} from "./funnelAnnouncements";

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/** Waktu eksekusi berikutnya (epoch ms UTC). */
function nextRunAt(hourWib: number, intervalDays: number, lastSent: Date | null): Date {
  const now = Date.now();
  const nowWib = now + WIB_OFFSET_MS;
  const dayStartWib = Math.floor(nowWib / DAY_MS) * DAY_MS;
  let candidateWib = dayStartWib + hourWib * 60 * 60 * 1000;
  if (candidateWib <= nowWib) candidateWib += intervalDays * DAY_MS;
  let candidate = candidateWib - WIB_OFFSET_MS;
  if (lastSent) {
    const earliest = lastSent.getTime() + intervalDays * DAY_MS;
    if (earliest > candidate) candidate = earliest;
  }
  return new Date(candidate);
}

async function tick(): Promise<void> {
  try {
    const result = await notifyStagnantReminder();
    logger.info(
      { sent: result.sent, failed: result.failed, skipped: result.skipped },
      "Stagnant LOP reminder complete",
    );
  } catch (err) {
    logger.error({ err }, "Stagnant LOP reminder failed");
  }
  try {
    const mgrResult = await notifyStagnantManagerReminder();
    logger.info(
      { sent: mgrResult.sent, failed: mgrResult.failed, skipped: mgrResult.skipped },
      "Stagnant LOP manager reminder complete",
    );
  } catch (err) {
    logger.error({ err }, "Stagnant LOP manager reminder failed");
  }
  scheduleNext();
}

async function scheduleNext(): Promise<void> {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  try {
    const ann = await loadAnnouncementSettings();
    if (!ann.stagnantReminderEnabled) {
      logger.info("Stagnant LOP reminder disabled — scheduler idle");
      return;
    }
    const intervalDays = Math.max(1, ann.stagnantReminderIntervalDays || 3);
    const runAt = nextRunAt(ann.stagnantReminderHourWib, intervalDays, ann.stagnantReminderLastSentAt);
    const delayMs = Math.max(60_000, runAt.getTime() - Date.now());
    logger.info({ runAt: runAt.toISOString(), intervalDays, delayMs }, "Stagnant LOP reminder scheduled");
    schedulerTimer = setTimeout(tick, delayMs);
  } catch (err) {
    logger.error({ err }, "Failed to schedule stagnant LOP reminder");
  }
}

export function startStagnantReminderScheduler(): void {
  scheduleNext();
}

/** Panggil ulang setelah pengaturan berubah. */
export function rescheduleStagnantReminder(): void {
  scheduleNext();
}
