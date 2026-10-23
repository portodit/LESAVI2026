/**
 * Pengumuman Telegram berbasis data Sales Funnel:
 *  - [UPDATE SNAPSHOT SALES FUNNEL] — dikirim setiap ada import funnel baru
 *  - [REMINDER LOP STAGNAN]           — dikirim scheduler in-process (tiap 2–3 hari)
 *
 * Scope data sengaja sama dengan dashboard: kategori kontrak GTMA + Own Channel,
 * tahun anggaran 2026, plus auto-filter tersembunyi yang dipakai API publik.
 */

import {
  db,
  pool,
  appSettingsTable,
  accountManagersTable,
  dataImportsTable,
  telegramLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../shared/logger";
import { getPublicBaseUrlSafe, toHttpsUrl, isLocalUrl } from "../../shared/publicUrl";
import { sendToTelegramHtml } from "./service";
import {
  formatSnapshotNameId,
  getGreetingWIB,
  detectHonorific,
  htmlEscape,
  renderFunnelAnnouncement,
  renderFunnelManagerAnnouncement,
  type FunnelAnnouncementCtx,
  type FunnelManagerAnnouncementCtx,
} from "./announcementTemplates";
import {
  buildFunnelPageKeyboard,
  buildInsight,
  buildScopeLabel,
  countFunnelPages,
  countStagnantPages,
  formatTanggalPendek,
  renderFunnelInsightMessage,
  renderFunnelLopListPage,
  renderStagnantReminderPage,
  toHighlightCtx,
  type FunnelLopListPageCtx,
  type StagnantReminderPageCtx,
} from "./funnelPages";
import {
  buildManagerAmKeyboard,
  countManagerAmPages,
  renderFunnelManagerAmListPage,
  renderFunnelManagerInsightMessage,
  type ManagerAmRow,
} from "./funnelManagerPages";
import {
  loadFunnelScope,
  summarizeAm,
  summarizeDivision,
  type DivisionFunnelSummary,
} from "../funnel/analysis";

export interface FunnelNotifyResult {
  sent: number;
  failed: number;
  skipped: number;
  details: { nik: string; status: string; error?: string }[];
}

const EMPTY_RESULT: FunnelNotifyResult = { sent: 0, failed: 0, skipped: 0, details: [] };

// ── Pengaturan pengumuman ─────────────────────────────────────────────────

/** Tabel pengaturan dibuat saat boot supaya tidak butuh migrasi manual. */
export async function ensureAnnouncementSettingsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_announcement_settings (
      id SERIAL PRIMARY KEY,
      funnel_announce_enabled BOOLEAN DEFAULT false NOT NULL,
      stagnant_reminder_enabled BOOLEAN DEFAULT false NOT NULL,
      stagnant_reminder_interval_days INTEGER DEFAULT 3 NOT NULL,
      stagnant_reminder_hour_wib INTEGER DEFAULT 9 NOT NULL,
      stagnant_reminder_last_sent_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
    );
  `);
}

export interface AnnouncementSettings {
  funnelAnnounceEnabled: boolean;
  stagnantReminderEnabled: boolean;
  stagnantReminderIntervalDays: number;
  stagnantReminderHourWib: number;
  stagnantReminderLastSentAt: Date | null;
}

export async function loadAnnouncementSettings(): Promise<AnnouncementSettings> {
  await ensureAnnouncementSettingsTable();
  const { rows } = await pool.query<{
    funnel_announce_enabled: boolean;
    stagnant_reminder_enabled: boolean;
    stagnant_reminder_interval_days: number;
    stagnant_reminder_hour_wib: number;
    stagnant_reminder_last_sent_at: Date | null;
  }>(
    `select funnel_announce_enabled, stagnant_reminder_enabled, stagnant_reminder_interval_days,
            stagnant_reminder_hour_wib, stagnant_reminder_last_sent_at
       from telegram_announcement_settings order by id limit 1`,
  );
  const row = rows[0];
  if (!row) {
    await pool.query(
      `insert into telegram_announcement_settings (id) values (1) on conflict (id) do nothing`,
    );
    return loadAnnouncementSettings();
  }
  return {
    funnelAnnounceEnabled: row.funnel_announce_enabled,
    stagnantReminderEnabled: row.stagnant_reminder_enabled,
    stagnantReminderIntervalDays: row.stagnant_reminder_interval_days,
    stagnantReminderHourWib: row.stagnant_reminder_hour_wib,
    stagnantReminderLastSentAt: row.stagnant_reminder_last_sent_at,
  };
}

export async function saveAnnouncementSettings(patch: Partial<AnnouncementSettings>): Promise<void> {
  await ensureAnnouncementSettingsTable();
  const current = await loadAnnouncementSettings();
  await pool.query(
    `update telegram_announcement_settings
        set funnel_announce_enabled = $1,
            stagnant_reminder_enabled = $2,
            stagnant_reminder_interval_days = $3,
            stagnant_reminder_hour_wib = $4,
            stagnant_reminder_last_sent_at = $5,
            updated_at = now()`,
    [
      patch.funnelAnnounceEnabled ?? current.funnelAnnounceEnabled,
      patch.stagnantReminderEnabled ?? current.stagnantReminderEnabled,
      patch.stagnantReminderIntervalDays ?? current.stagnantReminderIntervalDays,
      patch.stagnantReminderHourWib ?? current.stagnantReminderHourWib,
      patch.stagnantReminderLastSentAt !== undefined
        ? patch.stagnantReminderLastSentAt
        : current.stagnantReminderLastSentAt,
    ],
  );
}

// ── [UPDATE SNAPSHOT SALES FUNNEL] ─────────────────────────────────────────

export async function notifyFunnelSnapshot(
  importId: number,
  uploader?: { nama: string; role: string; nik?: string },
  targetNiks?: string[],
): Promise<FunnelNotifyResult> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) return { ...EMPTY_RESULT };
  const token = settings.telegramBotToken;

  const ann = await loadAnnouncementSettings();
  if (!ann.funnelAnnounceEnabled) {
    logger.info({ importId }, "Funnel announcement disabled — skip");
    return { ...EMPTY_RESULT };
  }

  const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, importId));
  if (!imp) return { ...EMPTY_RESULT };

  const snapshotName = formatSnapshotNameId(imp.snapshotDate);
  // snapshot_date disimpan sebagai teks "YYYY-MM-DD"
  const upTo = imp.snapshotDate ? String(imp.snapshotDate) : null;

  const scope = await loadFunnelScope({ upToSnapshotDate: upTo });
  const scopeLabel = buildScopeLabel(scope);
  const previousSnapshotName = scope.previousSnapshotDate
    ? formatTanggalPendek(scope.previousSnapshotDate)
    : null;

  const allAms = await db.select().from(accountManagersTable);
  const targetSet = targetNiks?.length ? new Set(targetNiks) : null;
  const activeAms = allAms.filter(
    (m) => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || "") && m.nik
      && (!targetSet || targetSet.has(m.nik)),
  );
  const chatIdMap = new Map(allAms.map((m) => [m.nik, m.telegramChatId]));

  const base = getPublicBaseUrlSafe();
  const publicHttps = toHttpsUrl(base);
  const localMode = isLocalUrl(publicHttps);

  const officerName = (uploader?.nama || "").trim();
  const officerRole = (uploader?.role || "").trim().toUpperCase().replace(/_/g, " ") || "OFFICER";
  const greeting = getGreetingWIB(new Date());

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const details: { nik: string; status: string; error?: string }[] = [];

  for (const am of activeAms) {
    const chatId = chatIdMap.get(am.nik!);
    if (!chatId) {
      skipped++;
      details.push({ nik: am.nik!, status: "skipped" });
      continue;
    }

    const summary = summarizeAm(scope, am.nik!, am.nama);
    if (summary.totalLop === 0) {
      skipped++;
      details.push({ nik: am.nik!, status: "skipped" });
      continue;
    }

    const ctx: FunnelAnnouncementCtx = {
      amName: am.nama,
      officerName,
      officerRole,
      snapshotName,
      previousSnapshotName,
      greeting,
      scopeLabel,
      totalLop: summary.totalLop,
      totalNilai: summary.totalNilai,
      realisasi: summary.totalNilai,
      target: summary.target,
      capaianPct: summary.capaianPct,
      overTarget: summary.overTarget,
      crPct: summary.crPct,
      crLopCount:
        (summary.counts.F3 ?? 0) + (summary.counts.F4 ?? 0) + (summary.counts.F5 ?? 0),
      counts: summary.counts,
      movements: summary.movements,
    };

    const listCtx: FunnelLopListPageCtx = {
      amName: am.nama,
      snapshotName,
      lists: {
        baru: summary.movementLists.baru.map(toHighlightCtx),
        naik: summary.movementLists.naik.map(toHighlightCtx),
        turun: summary.movementLists.turun.map(toHighlightCtx),
        stagnan: summary.movementLists.stagnan.map(toHighlightCtx),
      },
    };

    const body = renderFunnelAnnouncement(ctx);
    const listPages = countFunnelPages(listCtx.lists);
    const listBody = renderFunnelLopListPage(listCtx, 0, listPages);
    const laporanUrl = `${publicHttps}/presentation?type=funnel`;
    const navKeyboard = buildFunnelPageKeyboard({
      kind: "mov",
      page: 0,
      totalPages: listPages,
      snapshotDate: scope.latestSnapshotDate,
    });
    const insightBody = renderFunnelInsightMessage(
      buildInsight(summary.movements, summary.movementLists, summary.totalLop),
    );
    const insightKeyboard = {
      inline_keyboard: [
        localMode
          ? [{ text: "📊 Laporan Terkini Sales Funnel", callback_data: "funnel:terkini" }]
          : [{ text: "📊 Laporan Terkini Sales Funnel", url: laporanUrl }],
      ],
    };

    try {
      // Pesan 1: ringkasan. Pesan 2: daftar LOP berpaginasi.
      // Pesan 3: insight — dipisah supaya tidak ikut hilang saat AM pindah halaman.
      await sendToTelegramHtml(token, chatId, body);
      await sendToTelegramHtml(token, chatId, listBody, navKeyboard);
      await sendToTelegramHtml(token, chatId, insightBody, insightKeyboard);
      await db.insert(telegramLogsTable).values({
        nik: am.nik!,
        namaAm: am.nama,
        telegramChatId: chatId,
        status: "sent",
        period: imp.period,
        messageType: "funnel_snapshot_notification",
      });
      sent++;
      details.push({ nik: am.nik!, status: "sent" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      logger.error({ nik: am.nik, error: errMsg }, "notifyFunnelSnapshot failed");
      await db.insert(telegramLogsTable).values({
        nik: am.nik!,
        namaAm: am.nama,
        telegramChatId: chatId,
        status: "failed",
        period: imp.period,
        messageType: "funnel_snapshot_notification",
        error: errMsg,
      });
      failed++;
      details.push({ nik: am.nik!, status: "failed", error: errMsg });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { sent, failed, skipped, details };
}

// ── [UPDATE SNAPSHOT SALES FUNNEL] — versi manager ─────────────────────────

/** Insight level divisi: ringkasan pergerakan & ajakan follow-up. */
function buildDivisionInsight(div: DivisionFunnelSummary): string {
  const parts: string[] = [];
  if (div.movements.naik > 0) {
    parts.push(
      div.wonCount > 0
        ? `${div.movements.naik} LOP naik fase, termasuk ${div.wonCount} yang masuk Win/Closed 🎉`
        : `${div.movements.naik} LOP naik fase 🎉`,
    );
  }
  if (div.movements.turun > 0) {
    parts.push(
      `${div.movements.turun} LOP mundur fase, perlu dicek kendalanya dengan AM terkait 🔍`,
    );
  }
  if (div.movements.stagnan > 0 && div.stagnantPct >= 50) {
    parts.push(
      `Mayoritas LOP divisi (${div.movements.stagnan} dari ${div.totalLop}) belum bergerak. Mohon dorongan ke AM dengan stagnan terbanyak agar snapshot berikutnya lebih banyak LOP yang bergerak 💪`,
    );
  }
  if (parts.length === 0) {
    parts.push(
      div.totalLop > 0
        ? `Seluruh ${div.totalLop} LOP divisi bergerak, tetap jaga ritmenya ya! 🔥`
        : `Belum ada LOP dalam scope ringkasan ini.`,
    );
  }
  return parts.join(" ");
}

/** Kirim pengumuman funnel versi manager (2 pesan) ke semua user role MANAGER. */
export async function notifyFunnelManagerSnapshot(
  importId: number,
  uploader?: { nama: string; role: string; nik?: string },
): Promise<FunnelNotifyResult> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) return { ...EMPTY_RESULT };
  const token = settings.telegramBotToken;

  const ann = await loadAnnouncementSettings();
  if (!ann.funnelAnnounceEnabled) {
    logger.info({ importId }, "Funnel manager announcement disabled — skip");
    return { ...EMPTY_RESULT };
  }

  const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, importId));
  if (!imp) return { ...EMPTY_RESULT };

  const managers = await db.select().from(accountManagersTable).where(eq(accountManagersTable.role, "MANAGER"));
  const linkedManagers = managers.filter((m) => m.telegramChatId);
  if (linkedManagers.length === 0) {
    logger.info({ importId }, "Funnel manager announcement — no manager with telegram chat id");
    return { ...EMPTY_RESULT };
  }

  const snapshotName = formatSnapshotNameId(imp.snapshotDate);
  const upTo = imp.snapshotDate ? String(imp.snapshotDate) : null;

  const scope = await loadFunnelScope({ upToSnapshotDate: upTo });
  const division = summarizeDivision(scope);
  if (division.totalLop === 0) return { ...EMPTY_RESULT };

  const previousSnapshotName = scope.previousSnapshotDate
    ? formatTanggalPendek(scope.previousSnapshotDate)
    : null;

  const allAms = await db.select().from(accountManagersTable);
  const activeAmCount = allAms.filter(
    (m) => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || "") && m.nik,
  ).length;

  const base = getPublicBaseUrlSafe();
  const publicHttps = toHttpsUrl(base);
  const localMode = isLocalUrl(publicHttps);

  const officerName = (uploader?.nama || "").trim();
  const officerRole = (uploader?.role || "").trim().toUpperCase().replace(/_/g, " ") || "OFFICER";
  const greeting = getGreetingWIB(new Date());

  const ctx: FunnelManagerAnnouncementCtx = {
    managerName: "",
    managerHonorific: "kak",
    officerName,
    officerRole,
    snapshotName,
    previousSnapshotName,
    greeting,
    kategoriKontrak: scope.kategoriKontrak.join(", "),
    tahunAnggaran: scope.tahunAnggaran,
    activeAmCount,
    totalLop: division.totalLop,
    totalNilai: division.totalNilai,
    realisasi: division.totalNilai,
    target: division.target,
    capaianPct: division.capaianPct,
    overTarget: division.overTarget,
    crPct: division.crPct,
    crF5Count: division.crF5Count,
    crLopCount: division.crLopCount,
    counts: division.counts,
    movements: division.movements,
    stagnantPct: division.stagnantPct,
  };

  const amRows: ManagerAmRow[] = division.amRows.map((r) => ({
    nik: r.nik,
    namaAm: r.namaAm,
    baru: r.movements.baru,
    naik: r.movements.naik,
    turun: r.movements.turun,
    stagnan: r.movements.stagnan,
  }));
  const needPush = division.amRows.filter((r) => r.movements.naik === 0).map((r) => r.namaAm);

  const laporanUrl = `${publicHttps}/presentation?type=funnel`;
  const visualUrl = `${publicHttps}/visualisasi/funnel`;
  const genericRows = [
    [
      localMode
        ? { text: "📊 Laporan Terkini Sales Funnel", callback_data: "funnel:terkini" }
        : { text: "📊 Laporan Terkini Sales Funnel", url: laporanUrl },
      localMode
        ? { text: "📈 Visualisasi Data", callback_data: "funnel:visualisasi" }
        : { text: "📈 Visualisasi Data", url: visualUrl },
    ],
  ];

  const totalAmPages = countManagerAmPages(amRows);
  const amListBody = renderFunnelManagerAmListPage(amRows, 0, totalAmPages);
  // Tombol "Laporan Terkini" & "Visualisasi" hanya diletakkan di pesan terakhir.
  const amKeyboard = buildManagerAmKeyboard({
    rows: amRows,
    page: 0,
    totalPages: totalAmPages,
    snapshotDate: scope.latestSnapshotDate,
  });
  const insightBody = renderFunnelManagerInsightMessage({
    needPush,
    stagnant: division.stagnant,
    stagnantTotal: division.movements.stagnan,
    insight: buildDivisionInsight(division),
  });
  const insightKeyboard = { inline_keyboard: genericRows };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const details: { nik: string; status: string; error?: string }[] = [];

  for (const mgr of linkedManagers) {
    const chatId = mgr.telegramChatId!;
    const name = (mgr.nama || "").trim();
    const mCtx: FunnelManagerAnnouncementCtx = {
      ...ctx,
      managerName: name,
      managerHonorific: name ? detectHonorific(name) : "kak",
    };

    const body = renderFunnelManagerAnnouncement(mCtx);

    try {
      // Pesan 1: ringkasan divisi. Pesan 2: pergerakan per AM (berpaginasikan).
      // Pesan 3: AM yang perlu didorong + stagnan terlama + insight.
      await sendToTelegramHtml(token, chatId, body);
      await sendToTelegramHtml(token, chatId, amListBody, amKeyboard);
      await sendToTelegramHtml(token, chatId, insightBody, insightKeyboard);
      await db.insert(telegramLogsTable).values({
        nik: mgr.nik || "",
        namaAm: name,
        telegramChatId: chatId,
        status: "sent",
        period: imp.period,
        messageType: "funnel_manager_snapshot_notification",
      });
      sent++;
      details.push({ nik: mgr.nik || "", status: "sent" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      logger.error({ nik: mgr.nik, error: errMsg }, "notifyFunnelManagerSnapshot failed");
      await db.insert(telegramLogsTable).values({
        nik: mgr.nik || "",
        namaAm: name,
        telegramChatId: chatId,
        status: "failed",
        period: imp.period,
        messageType: "funnel_manager_snapshot_notification",
        error: errMsg,
      });
      failed++;
      details.push({ nik: mgr.nik || "", status: "failed", error: errMsg });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { sent, failed, skipped, details };
}

// ── [REMINDER LOP STAGNAN] ─────────────────────────────────────────────────

/** Kirim reminder LOP stagnan ke semua AM yang punya LOP stagnan. */
export async function notifyStagnantReminder(): Promise<FunnelNotifyResult> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) return { ...EMPTY_RESULT };
  const token = settings.telegramBotToken;

  const ann = await loadAnnouncementSettings();
  if (!ann.stagnantReminderEnabled) {
    logger.info("Stagnant reminder disabled — skip");
    return { ...EMPTY_RESULT };
  }

  const scope = await loadFunnelScope();
  if (!scope.latestSnapshotDate) return { ...EMPTY_RESULT };
  const scopeLabel = buildScopeLabel(scope);
  const snapshotName = formatTanggalPendek(scope.latestSnapshotDate);

  const allAms = await db.select().from(accountManagersTable);
  const activeAms = allAms.filter(
    (m) => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || "") && m.nik,
  );
  const chatIdMap = new Map(allAms.map((m) => [m.nik, m.telegramChatId]));

  const base = getPublicBaseUrlSafe();
  const publicHttps = toHttpsUrl(base);
  const localMode = isLocalUrl(publicHttps);
  const greeting = getGreetingWIB(new Date());

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const details: { nik: string; status: string; error?: string }[] = [];

  for (const am of activeAms) {
    const chatId = chatIdMap.get(am.nik!);
    if (!chatId) {
      skipped++;
      details.push({ nik: am.nik!, status: "skipped" });
      continue;
    }

    const summary = summarizeAm(scope, am.nik!, am.nama);
    if (summary.movements.stagnan === 0) {
      skipped++;
      details.push({ nik: am.nik!, status: "skipped" });
      continue;
    }

    const items = summary.stagnant.map(toHighlightCtx);
    const ctx: StagnantReminderPageCtx = {
      amName: am.nama,
      greeting,
      snapshotName,
      scopeLabel,
      totalStagnant: summary.movements.stagnan,
      items,
    };

    const totalPages = countStagnantPages(items);
    const body = renderStagnantReminderPage(ctx, 0, totalPages);
    const profilUrl = `${publicHttps}/presentation/am/${encodeURIComponent(am.nik!)}`;
    const keyboard = buildFunnelPageKeyboard({
      kind: "stag",
      page: 0,
      totalPages,
      snapshotDate: scope.latestSnapshotDate,
      extraRows: [
        localMode
          ? [{ text: "👤 Lihat Profil", callback_data: "am:profile" }]
          : [{ text: "👤 Lihat Profil", url: profilUrl }],
      ],
    });

    try {
      await sendToTelegramHtml(token, chatId, body, keyboard);
      await db.insert(telegramLogsTable).values({
        nik: am.nik!,
        namaAm: am.nama,
        telegramChatId: chatId,
        status: "sent",
        period: scope.latestSnapshotDate,
        messageType: "stagnant_lop_reminder",
      });
      sent++;
      details.push({ nik: am.nik!, status: "sent" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      logger.error({ nik: am.nik, error: errMsg }, "notifyStagnantReminder failed");
      await db.insert(telegramLogsTable).values({
        nik: am.nik!,
        namaAm: am.nama,
        telegramChatId: chatId,
        status: "failed",
        period: scope.latestSnapshotDate,
        messageType: "stagnant_lop_reminder",
        error: errMsg,
      });
      failed++;
      details.push({ nik: am.nik!, status: "failed", error: errMsg });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  if (sent > 0 || failed > 0) {
    await saveAnnouncementSettings({ stagnantReminderLastSentAt: new Date() });
  }

  return { sent, failed, skipped, details };
}

// ── [REMINDER LOP STAGNAN] — versi manager ─────────────────────────────────

/**
 * Reminder stagnan level divisi: ringkasan per AM + blok "Stagnan terlama",
 * tanpa ringkasan sebaran fase (itu sudah ada di pesan pengumuman snapshot).
 */
export async function notifyStagnantManagerReminder(): Promise<FunnelNotifyResult> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) return { ...EMPTY_RESULT };
  const token = settings.telegramBotToken;

  const ann = await loadAnnouncementSettings();
  if (!ann.stagnantReminderEnabled) {
    logger.info("Stagnant manager reminder disabled — skip");
    return { ...EMPTY_RESULT };
  }

  const managers = await db.select().from(accountManagersTable).where(eq(accountManagersTable.role, "MANAGER"));
  const linkedManagers = managers.filter((m) => m.telegramChatId);
  if (linkedManagers.length === 0) return { ...EMPTY_RESULT };

  const scope = await loadFunnelScope();
  if (!scope.latestSnapshotDate) return { ...EMPTY_RESULT };
  const snapshotName = formatTanggalPendek(scope.latestSnapshotDate);

  const division = summarizeDivision(scope);
  if (division.movements.stagnan === 0) return { ...EMPTY_RESULT };

  const base = getPublicBaseUrlSafe();
  const publicHttps = toHttpsUrl(base);
  const localMode = isLocalUrl(publicHttps);
  const greeting = getGreetingWIB(new Date());

  const amRows: ManagerAmRow[] = division.amRows.map((r) => ({
    nik: r.nik,
    namaAm: r.namaAm,
    baru: r.movements.baru,
    naik: r.movements.naik,
    turun: r.movements.turun,
    stagnan: r.movements.stagnan,
  }));
  const needPush = division.amRows.filter((r) => r.movements.naik === 0).map((r) => r.namaAm);

  const laporanUrl = `${publicHttps}/presentation?type=funnel`;
  const visualUrl = `${publicHttps}/visualisasi/funnel`;
  const genericRows = [
    [
      localMode
        ? { text: "📊 Laporan Terkini Sales Funnel", callback_data: "funnel:terkini" }
        : { text: "📊 Laporan Terkini Sales Funnel", url: laporanUrl },
      localMode
        ? { text: "📈 Visualisasi Data", callback_data: "funnel:visualisasi" }
        : { text: "📈 Visualisasi Data", url: visualUrl },
    ],
  ];

  const totalAmPages = countManagerAmPages(amRows);
  const amListBody = renderFunnelManagerAmListPage(amRows, 0, totalAmPages);
  // Tombol "Laporan Terkini" & "Visualisasi" hanya diletakkan di pesan terakhir.
  const amKeyboard = buildManagerAmKeyboard({
    rows: amRows,
    page: 0,
    totalPages: totalAmPages,
    snapshotDate: scope.latestSnapshotDate,
  });
  const insightBody = renderFunnelManagerInsightMessage({
    needPush,
    stagnant: division.stagnant,
    stagnantTotal: division.movements.stagnan,
    insight: buildDivisionInsight(division),
  });
  const insightKeyboard = { inline_keyboard: genericRows };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const details: { nik: string; status: string; error?: string }[] = [];

  for (const mgr of linkedManagers) {
    const chatId = mgr.telegramChatId!;
    const name = (mgr.nama || "").trim();
    const honorific = name ? detectHonorific(name) : "kak";

    const header = [
      `<b>[REMINDER LOP STAGNAN]</b>`,
      ``,
      `Selamat ${greeting}, ${honorific} <b>${htmlEscape(name)}</b> 👋`,
      ``,
      `Per snapshot <b>${htmlEscape(snapshotName)}</b>, ada <b>${division.movements.stagnan} LOP</b> di divisi yang fasenya belum bergerak. Mohon izin mengingatkan tim untuk ditindaklanjuti sebelum snapshot berikutnya:`,
      ``,
    ].join("\n");

    try {
      await sendToTelegramHtml(token, chatId, header);
      await sendToTelegramHtml(token, chatId, amListBody, amKeyboard);
      await sendToTelegramHtml(token, chatId, insightBody, insightKeyboard);
      await db.insert(telegramLogsTable).values({
        nik: mgr.nik || "",
        namaAm: name,
        telegramChatId: chatId,
        status: "sent",
        period: scope.latestSnapshotDate,
        messageType: "stagnant_manager_reminder",
      });
      sent++;
      details.push({ nik: mgr.nik || "", status: "sent" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      logger.error({ nik: mgr.nik, error: errMsg }, "notifyStagnantManagerReminder failed");
      await db.insert(telegramLogsTable).values({
        nik: mgr.nik || "",
        namaAm: name,
        telegramChatId: chatId,
        status: "failed",
        period: scope.latestSnapshotDate,
        messageType: "stagnant_manager_reminder",
        error: errMsg,
      });
      failed++;
      details.push({ nik: mgr.nik || "", status: "failed", error: errMsg });
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { sent, failed, skipped, details };
}
