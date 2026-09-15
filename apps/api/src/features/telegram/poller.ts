import { db, accountManagersTable, appSettingsTable, telegramBotUsersTable, telegramAccessCodesTable, dataImportsTable, salesFunnelTable } from "@workspace/db";
import { eq, and, gt, inArray, desc } from "drizzle-orm";
import { sendToTelegram, answerCallbackQuery, greetingByTime, buildTelegramMessages, getAvailablePerfPeriods, buildActivityReport } from "./service";
import { chatWithGemini, generateBasaBasi } from "./ai";
import { logger } from "../../shared/logger";
import { getPublicBaseUrl } from "../../shared/publicUrl";
import bcrypt from "bcryptjs";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  OFFICER: "OFFICER",
  ACCOUNT_MANAGER: "ACCOUNT MANAGER",
};

const DAY_REMINDERS: Record<number, string> = {
  0: "", // Sunday
  1: "Semoga aktivitas hari ini berjalan lancar. Jangan lupa cek progress dan pastikan setiap target tetap berjalan sesuai rencana. 📊",
  2: "", // Tuesday
  3: "Semoga aktivitas hari ini berjalan lancar. Jangan lupa cek progress dan pastikan setiap target tetap berjalan sesuai rencana. 📊",
  4: "", // Thursday
  5: "Pastikan semua LOP tertindak lanjuti dan rekap minggu ini! 🎯",
  6: "", // Saturday
};

const DAY_NAMES: Record<number, string> = {
  0: "Minggu", 1: "Senin", 2: "Selasa", 3: "Rabu",
  4: "Kamis", 5: "Jumat", 6: "Sabtu",
};

function dayReminder(): string {
  const day = new Date().getDay();
  return DAY_REMINDERS[day] || "";
}

function getDayName(): string {
  const day = new Date().getDay();
  return DAY_NAMES[day] || "";
}

// Cooldown: track last full-welcome sent per chatId
const lastWelcomeSent = new Map<string, number>();
const WELCOME_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const VERIF_CODE_UUID = "verif:code";
const VERIF_LINK_UUID = "verif:link";

let lastUpdateId = 0;

// Graceful shutdown: acknowledge the last processed update ID to Telegram
// before the process dies. This prevents update loss during `pm2 reload`.
export async function flushLastUpdateId(): Promise<void> {
  if (lastUpdateId <= 0) return;
  try {
    const [settings] = await db.select().from(appSettingsTable);
    if (!settings?.telegramBotToken) return;
    const token = settings.telegramBotToken;
    // Call getUpdates with offset=lastUpdateId+1 and timeout=1 to ACK without fetching
    await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?limit=1&offset=${lastUpdateId + 1}&timeout=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    logger.info({ lastUpdateId }, "Telegram offset flushed on shutdown");
  } catch (e) {
    logger.warn({ err: e }, "Failed to flush Telegram offset on shutdown");
  }
}
let pollerTimer: ReturnType<typeof setTimeout> | null = null;

export interface BotUser {
  chatId: string;
  firstName: string;
  lastName: string;
  username: string;
  lastMessage: string;
  lastSeen: string;
}
const botUsersMap = new Map<string, BotUser>();

export function getBotUsers(): BotUser[] {
  return [...botUsersMap.values()].sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  );
}

async function upsertBotUser(user: BotUser) {
  botUsersMap.set(user.chatId, user);
  try {
    await db.insert(telegramBotUsersTable).values({
      chatId: user.chatId, firstName: user.firstName, lastName: user.lastName,
      username: user.username, lastMessage: user.lastMessage, lastSeen: new Date(user.lastSeen),
    }).onConflictDoUpdate({
      target: telegramBotUsersTable.chatId,
      set: { firstName: user.firstName, lastName: user.lastName, username: user.username,
             lastMessage: user.lastMessage, lastSeen: new Date(user.lastSeen) },
    });
  } catch (err) {
    logger.debug({ err }, "Failed to persist bot user (non-fatal)");
  }
}

// ── Period extraction from filename ───────────────────────────────────────────
function extractPeriodFromFilename(filename: string): string | null {
  // Try YYYYMMDD first (e.g., 20260904) — find 8 consecutive digits, check if valid as year-month-day
  const all8 = [...filename.matchAll(/(\d{8})/g)];
  for (const m of all8) {
    const s = m[1];
    const year = parseInt(s.slice(0, 4));
    const month = parseInt(s.slice(4, 6));
    const day = parseInt(s.slice(6, 8));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  // Try DDMMYYYY (e.g., 04092026)
  for (const m of all8) {
    const s = m[1];
    const day = parseInt(s.slice(0, 2));
    const month = parseInt(s.slice(2, 4));
    const year = parseInt(s.slice(4, 8));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

// ── Download file from Telegram ───────────────────────────────────────────────
async function downloadTelegramFile(token: string, fileId: string): Promise<Buffer> {
  const getFileResp = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const getFileData = await getFileResp.json() as { ok: boolean; result?: { file_path?: string } };
  if (!getFileData.ok || !getFileData.result?.file_path) {
    throw new Error("Gagal获取文件信息");
  }
  const filePath = getFileData.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const fileResp = await fetch(downloadUrl);
  const arrayBuffer = await fileResp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Process import (shared by confirm and overwrite handlers) ───────────────────
async function doProcessImport(
  token: string,
  chatId: string,
  state: ImportState,
  fileData: string,
  linkedAm: { nama: string; role: string },
  forceOverwrite = false,
) {
  logger.info({ chatId, importType: state.importType, forceOverwrite }, "doProcessImport: START");
  const typeLabel = state.importType === "performance" ? "Performance"
    : state.importType === "funnel" ? "Sales Funnel" : "Sales Activity";
  const endpoint = state.importType === "performance"
    ? "/import-performance"
    : state.importType === "funnel"
      ? "/import-funnel"
      : "/import-activity";

  const secret = process.env["TELEGRAM_IMPORT_SECRET"] || "telegram-bot-internal-secret-2024";
  const internalBase = process.env["PUBLIC_API_URL"] || "http://localhost:8000";
  const domain = getPublicBaseUrl();

  const dbType = state.importType === "performance" ? "performance" : state.importType === "funnel" ? "funnel" : "activity";

  const PROGRESS_KEYBOARD = {
    inline_keyboard: [
      [{ text: "⏳ Memproses...", callback_data: "import:processing" }],
    ],
  };

  const sendMsg = (msg: string, kb?: object) =>
    sendToTelegram(token, chatId, msg, kb).catch((e: unknown) =>
      logger.error({ err: e }, `sendToTelegram failed for chatId ${chatId}`)
    );

  await sendMsg(
    `📥 *Import ${typeLabel} — Sedang Berlangsung*\n\n` +
    `⏳ Memproses file...\n\n` +
    `_Mohon tunggu sebentar ya kak 🙏_`,
    PROGRESS_KEYBOARD
  );

  try {
    const apiResp = await fetch(`${internalBase}/api/internal${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-secret": secret },
      body: JSON.stringify({
        fileData,
        snapshotDate: state.extractedDate || undefined,
        period: state.period || undefined,
        forceOverwrite,
      }),
    });

    const apiData = await apiResp.json() as {
      error?: string; rowsImported?: number; rows?: number; conflict?: boolean; importId?: number;
    };

    if (apiData.conflict) {
      // API found existing snapshot — show overwrite/cancel buttons
      const existingMsg = apiData.error || `Sudah ada data ${typeLabel} periode ${state.period} yang diimport sebelumnya.`;
      const OVERWRITE_KEYBOARD = {
        inline_keyboard: [
          [{ text: "✅ Ya, Timpa Snapshot Lama", callback_data: "import:overwrite" }],
          [{ text: "❌ Batalkan", callback_data: "import:cancel" }],
        ],
      };
      sendMsg(`⚠️ *Snapshot Sudah Ada*\n\n${existingMsg}\n\n` +
        `⚠️ Mengimpor ulang akan *MENIMPA* snapshot lama.\n\n` +
        `Lanjutkan timpa snapshot lama kak *${linkedAm.nama.split(" ")[0]}*? 👇`,
        OVERWRITE_KEYBOARD
      );
      state.step = "waiting_overwrite_confirm";
      importState.set(chatId, state);
      return;
    }
    if (!apiResp.ok) {
      sendMsg(
        `❌ *Gagal Import ${typeLabel}*\n\n` +
        `${apiData.error || "Terjadi kesalahan saat memproses file."}\n\n` +
        `Silakan coba lagi atau hubungi admin.`,
        getMainKeyboard(linkedAm.role)
      );
    } else {
      const rows = apiData.rowsImported ?? apiData.rows ?? 0;
      const snapId = apiData.importId;
      const snapUrl = snapId ? `${domain}/import/detail/${dbType}/${snapId}` : `${domain}/import`;
      const presUrl = snapId ? `${domain}/presentation?type=${dbType}&snapshot=${snapId}` : `${domain}/presentation`;
      const typeLabelLower = state.importType === "performance" ? "Performansi AM" : state.importType === "funnel" ? "Sales Funnel" : "Sales Activity";
      const snapName = state.period
        ? `${typeLabelLower} — ${state.period}`
        : `${typeLabelLower}`;

      const SUCCESS_KEYBOARD = {
        inline_keyboard: [
          [{ text: "📋 Lihat Snapshot", url: snapUrl }],
          [{ text: "📊 Lihat Visualisasi", url: presUrl }],
          [{ text: "◀️ Kembali ke Menu", callback_data: "/import" }],
        ],
      };

      sendMsg(
        `✅ *Import ${typeLabel} Berhasil!*\n\n` +
        `📋 *Nama Snapshot:* ${snapName}\n` +
        `📊 *Tipe:* ${typeLabelLower}\n` +
        `📦 *Total Baris:* *${rows.toLocaleString("id-ID")}* baris data\n\n` +
        `Silakan pilih aksi di bawah ya kak 🙏`,
        SUCCESS_KEYBOARD
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to call internal import API from Telegram");
    sendMsg(
      `❌ *Gagal Import ${typeLabel}*\n\n` +
      `Terjadi kesalahan koneksi ke server. Silakan coba lagi nanti.`,
      getMainKeyboard(linkedAm.role)
    );
  }

  importState.delete(chatId);
  funnelFileData.delete(chatId);
  activityFileData.delete(chatId);
}

const MAIN_KEYBOARD_AM = {
  inline_keyboard: [
    [
      { text: "📋 Sales Funneling",   callback_data: "/funneling"   },
      { text: "📅 Sales Activity",    callback_data: "/activity"     },
    ],
    [
      { text: "📊 Performansi Revenue", callback_data: "/performansi" },
      { text: "📊 Prognosa FY",        callback_data: "/prognosa"   },
    ],
    [
      { text: "🔓 Putuskan Koneksi",   callback_data: "/logout"     },
    ],
  ],
};

const MAIN_KEYBOARD_ADMIN = {
  inline_keyboard: [
    [
      { text: "📥 Impor Data",          callback_data: "/import"   },
      { text: "🔓 Putuskan Koneksi",   callback_data: "/logout"  },
    ],
    [
      { text: "📋 List Data Snapshot",  callback_data: "/list"    },
    ],
  ],
};

const MAIN_KEYBOARD_EMPTY: typeof MAIN_KEYBOARD_ADMIN = { inline_keyboard: [] };

function getMainKeyboard(role: string) {
  if (role === "ADMIN" || role === "MANAGER" || role === "OFFICER") return MAIN_KEYBOARD_ADMIN;
  if (role === "ACCOUNT_MANAGER") return MAIN_KEYBOARD_AM;
  return MAIN_KEYBOARD_EMPTY;
}

const PERF_NAV_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "◀️ Pilih Bulan Lain", callback_data: "perf:menu" },
      { text: "🏠 Menu Utama",       callback_data: "nav:main"  },
    ],
  ],
};

const FUNNEL_SUB_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📋 Laporan Terkini",    callback_data: "funnel:laporan"    },
      { text: "🏆 Papan Peringkat",    callback_data: "funnel:peringkat"  },
    ],
    [
      { text: "📊 Visualisasi Data",   callback_data: "funnel:visualisasi" },
    ],
    [
      { text: "◀️ Kembali ke Menu",    callback_data: "nav:main"  },
    ],
  ],
};

const ACTIVITY_SUB_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📋 Laporan Terkini",    callback_data: "activity:laporan"    },
      { text: "🏆 Papan Peringkat",   callback_data: "activity:peringkat"  },
    ],
    [
      { text: "📊 Visualisasi Data",   callback_data: "activity:visualisasi" },
    ],
    [
      { text: "◀️ Kembali ke Menu",   callback_data: "nav:main"  },
    ],
  ],
};

const VERIF_MAIN_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📝 Masukkan Kode Verifikasi", callback_data: VERIF_CODE_UUID },
      { text: "🔗 Saya Butuh Tautan Verifikasi", callback_data: VERIF_LINK_UUID },
    ],
  ],
};

const VERIF_CODE_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📝 Masukkan Kode Verifikasi", callback_data: VERIF_CODE_UUID },
      { text: "🔗 Saya Butuh Tautan Verifikasi", callback_data: VERIF_LINK_UUID },
    ],
  ],
};

// ── Activity report pagination state ────────────────────────────────────────────
interface ActivityPageEntry {
  period: string;
  summary: string;
  details: string[];
  totalPages: number;
  currentPage: number;
  nik: string;
}
const activityPageState = new Map<string, ActivityPageEntry>();

// ── Activity detail navigation keyboard ───────────────────────────────────────
function buildActivityNavKeyboard(currentPage: number, totalPages: number, hasMultiplePages: boolean) {
  const rows: { text: string; callback_data: string }[][] = [];

  if (hasMultiplePages) {
    const navRow: { text: string; callback_data: string }[] = [];
    if (currentPage > 0) navRow.push({ text: "◀️ Halaman Sebelumnya", callback_data: "activity:prev" });
    navRow.push({ text: `📄 ${currentPage + 1}/${totalPages}`, callback_data: "activity:noop" });
    if (currentPage < totalPages - 1) navRow.push({ text: "Halaman Selanjutnya ▶️", callback_data: "activity:next" });
    rows.push(navRow);
  }

  rows.push([{ text: "🗓 Pilih Bulan", callback_data: "activity:period_menu" }]);
  return { inline_keyboard: rows };
}

// "Mau apa lagi kak NADYA?" keyboard for activity
const ACTIVITY_MORE_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📋 Laporan Terkini",    callback_data: "activity:laporan"    }],
    [{ text: "🏆 Papan Peringkat",   callback_data: "activity:peringkat"  }],
    [{ text: "📊 Visualisasi Data",   callback_data: "activity:visualisasi" }],
    [{ text: "◀️ Kembali ke Menu",   callback_data: "nav:main"  }],
  ],
};

const MONTH_NAMES = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// ── Import flow state ─────────────────────────────────────────────────────────
type ImportStep = "idle" | "waiting_period" | "waiting_file" | "waiting_confirm" | "processing" | "waiting_drive_link" | "waiting_overwrite_confirm";
interface ImportState {
  step: ImportStep;
  importType: "performance" | "funnel" | "activity" | "prognosa";
  period: string;
  extractedDate?: string;
}
const importState = new Map<string, ImportState>();
const funnelFileData = new Map<string, string>();
const activityFileData = new Map<string, string>();

const FUNNEL_BACK_KEYBOARD = {
  inline_keyboard: [[{ text: "◀️ Kembali ke Menu Import", callback_data: "/import" }]],
};

// ── Snapshot selection flow state ───────────────────────────────────────────────
type SnapshotStep = "idle" | "choose_type" | "choose_snapshot" | "snapshot_detail";
interface SnapshotState {
  step: SnapshotStep;
  dataType: "performance" | "funnel" | "activity";
  snapshots: Array<{
    id: number; period: string; snapshotDate: string | null;
    rowsImported: number | null; sourceUrl: string | null; createdAt: string | null;
  }>;
  selectedIndex: number;
}
const snapshotState = new Map<string, SnapshotState>();

// Keyboard: choose data type
const LIST_SNAPSHOT_TYPE_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📊 Performansi AM", callback_data: "snap:perf" }],
    [{ text: "📋 Sales Funnel", callback_data: "snap:funnel" }],
    [{ text: "📅 Sales Activity", callback_data: "snap:activity" }],
    [{ text: "◀️ Menu Utama", callback_data: "nav:main" }],
  ],
};

// Build snapshot list keyboard
function buildSnapshotListKeyboard(snaps: SnapshotState["snapshots"], dataType: string) {
  const typeLabel = dataType === "performance" ? "Performansi AM" : dataType === "funnel" ? "Sales Funnel" : "Sales Activity";
  const rows: any[] = [];
  for (const snap of snaps) {
    const date = snap.snapshotDate
      ? new Date(snap.snapshotDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
      : (snap.period || "-");
    rows.push({ text: `📅 ${date} — ${typeLabel}`, callback_data: `snap:select:${dataType}:${snap.id}` });
  }
  const inline_keyboard = rows.map(r => [r]);
  inline_keyboard.push([{ text: "◀️ Kembali", callback_data: "snap:back_to_list" }]);
  return { inline_keyboard };
}

// Build snapshot list message
async function buildSnapshotListMsg(dataType: "performance" | "funnel" | "activity"): Promise<{ text: string; keyboard: any; rows: SnapshotState["snapshots"] }> {
  const dbType = dataType === "performance" ? "performance" : dataType === "funnel" ? "funnel" : "activity";
  const rows = await db.select({
    id: dataImportsTable.id, period: dataImportsTable.period,
    snapshotDate: dataImportsTable.snapshotDate, rowsImported: dataImportsTable.rowsImported,
    sourceUrl: dataImportsTable.sourceUrl, createdAt: dataImportsTable.createdAt,
  }).from(dataImportsTable).where(eq(dataImportsTable.type, dbType)).orderBy(desc(dataImportsTable.id));
  const typeLabel = dataType === "performance" ? "Performansi AM" : dataType === "funnel" ? "Sales Funnel" : "Sales Activity";
  if (rows.length === 0) {
    return {
      text: `📋 *Daftar Snapshot ${typeLabel}*\n\nBelum ada data ${typeLabel} yang diimport kak. Silakan import terlebih dahulu melalui menu /import.`,
      keyboard: { inline_keyboard: [[{ text: "◀️ Menu Utama", callback_data: "nav:main" }]] }, rows: [],
    };
  }
  const keyboard = buildSnapshotListKeyboard(rows, dataType);
  return { text: `📋 *Daftar Snapshot ${typeLabel}*\n\nPilih snapshot yang ingin dilihat:`, keyboard, rows };
}

// Build snapshot detail message
function buildSnapshotDetailMsg(snap: SnapshotState["snapshots"][0], dataType: string, idx: number): string {
  const typeLabel = dataType === "performance" ? "Performansi AM" : dataType === "funnel" ? "Sales Funnel" : "Sales Activity";
  const date = snap.snapshotDate ? new Date(snap.snapshotDate).toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "-";
  const rows = snap.rowsImported != null ? `${snap.rowsImported.toLocaleString("id-ID")} baris data` : "belum diketahui";
  const source = snap.sourceUrl ? `\n📎 Sumber: ${snap.sourceUrl}` : "";
  return (
    `✅ *Snapshot #${idx} Dipilih*\n\n` +
    `📊 Tipe Data: *${typeLabel}*\n` +
    `📅 Tanggal Snapshot: *${date}*\n` +
    `📦 Jumlah Baris: *${rows}*${source}\n\n` +
    `Silakan pilih aksi yang ingin dilakukan di bawah ya kak 👇`
  );
}

// Fetch snapshots helper
async function fetchSnapshots(dataType: "performance" | "funnel" | "activity"): Promise<SnapshotState["snapshots"]> {
  const dbType = dataType === "performance" ? "performance" : dataType === "funnel" ? "funnel" : "activity";
  const rows = await db.select({
    id: dataImportsTable.id, period: dataImportsTable.period,
    snapshotDate: dataImportsTable.snapshotDate, rowsImported: dataImportsTable.rowsImported,
    sourceUrl: dataImportsTable.sourceUrl, createdAt: dataImportsTable.createdAt,
  }).from(dataImportsTable).where(eq(dataImportsTable.type, dbType)).orderBy(desc(dataImportsTable.id));
  return rows.map(r => ({
    id: r.id, period: r.period ?? "", snapshotDate: r.snapshotDate?.toString() ?? null,
    rowsImported: r.rowsImported, sourceUrl: r.sourceUrl ?? null, createdAt: r.createdAt?.toString() ?? null,
  }));
}

// Extract date from funnel filename
function extractDateFromFunnelFilename(fileName: string): string | null {
  const matches = fileName.match(/\d{8}/g);
  if (!matches || matches.length === 0) return null;
  const candidate = matches[matches.length - 1];
  const year = parseInt(candidate.slice(0, 4), 10);
  const month = parseInt(candidate.slice(4, 6), 10);
  const day = parseInt(candidate.slice(6, 8), 10);
  if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) return candidate;
  return null;
}

// ── Contact list builder (ADMIN, OFFICER, MANAGER who are Telegram-linked) ──
async function buildContactList(): Promise<string> {
  const contacts = await db.select({
    nama: accountManagersTable.nama,
    role: accountManagersTable.role,
    telegramChatId: accountManagersTable.telegramChatId,
    telegramUsername: accountManagersTable.telegramUsername,
  }).from(accountManagersTable)
    .where(and(
      inArray(accountManagersTable.role, ["ADMIN", "MANAGER", "OFFICER"]),
      eq(accountManagersTable.aktif, true),
    ));

  if (!contacts.length) return "";

  const lines: string[] = [];
  const byRole: Record<string, typeof contacts> = {};
  for (const c of contacts) {
    if (!byRole[c.role]) byRole[c.role] = [];
    byRole[c.role].push(c);
  }

  for (const role of ["ADMIN", "OFFICER", "MANAGER"]) {
    const members = byRole[role];
    if (!members?.length) continue;
    lines.push(`*${ROLE_LABELS[role] ?? role}:*`);
    for (const m of members) {
      const tgHandle = m.telegramUsername
        ? `@${m.telegramUsername.replace("@", "")}`
        : (m.telegramChatId ? `[chat](https://t.me/${m.telegramChatId})` : m.nama);
      lines.push(`  • ${m.nama} — ${tgHandle}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

// ── Message builders ────────────────────────────────────────────────────────

// Message 1: Konfirmasi akun berhasil terhubung (semua role)
function buildLinkedConfirm(namaLengkap: string, role: string): string {
  const roleLabel = ROLE_LABELS[role] ?? role;
  return (
    `✅ *Akun Berhasil Terhubung!* 🎉\n\n` +
    `Halo, *${namaLengkap}*! 👋\n` +
    `Kamu terdaftar sebagai *${roleLabel}* di LESA VI Witel Suramadu.\n\n` +
    `Akun Telegram kamu sudah berhasil terhubung dengan sistem. Ke depannya, kamu akan menerima informasi operasional LESA VI Witel Suramadu secara otomatis melalui bot ini.\n\n` +
    `Ingin memutuskan koneksi akun? Ketik /logout\n\n` +
    `Salam hangat dan terima kasih 🙏`
  );
}

// Message 2A: Welcome/Recurring untuk ACCOUNT MANAGER
// Welcome AM — Part 1: greeting + intro (no keyboard)
async function buildWelcomeAMP1(namaLengkap: string): Promise<string> {
  const greeting = greetingByTime();
  const dayName = getDayName();
  const reminder = dayReminder();
  const reminderLine = reminder ? `\n${reminder}\n` : "\n";
  const firstName = namaLengkap.split(" ")[0];
  return (
    `Hai Kak *${firstName}*! 👋\n\n` +
    `Selamat datang kembali di *LESA VI — Witel Suramadu TREG 3*. 🏢\n\n` +
    `Selamat hari *${dayName}*, Kak!${reminderLine}` +
    `Melalui bot ini, Kakak dapat memantau beberapa informasi utama:\n\n` +
    `1. 📋 *Sales Funneling*\n` +
    `Memantau update dan perkembangan LOP yang sedang Kakak tangani, termasuk peluang yang membutuhkan tindak lanjut.\n\n` +
    `2. 📅 *Sales Activity*\n` +
    `Melihat perkembangan aktivitas pelanggan sebagai bagian dari monitoring KPI activity.\n\n` +
    `3. 📊 *Performansi Revenue*\n` +
    `Melihat capaian Revenue, Sustain, Scaling, dan NGTMA pada setiap periode.`
  );
}

// Welcome AM — Part 2: prompt + keyboard
function buildWelcomeAMP2(): { text: string; keyboard: object } {
  return {
    text: `Silakan pilih menu di bawah untuk mulai mengakses data. 👇`,
    keyboard: MAIN_KEYBOARD_AM,
  };
}

// Message 2B: Welcome untuk ADMIN / MANAGER / OFFICER
async function buildWelcomeAdmin(namaLengkap: string, role: string): Promise<string> {
  const greeting = greetingByTime();
  const roleLabel = ROLE_LABELS[role] ?? role;
  return (
    `Hai kak *${namaLengkap}*! 👋 Selamat ${greeting}~\n\n` +
    `Selamat datang di *BOT LESA VI — Witel Suramadu TREG 3!* 🏢\n\n` +
    `Sebagai *${roleLabel}*, kamu bisa mengelola dan mengakses data operasional melalui menu di bawah ini.\n\n` +
    `Pilih menu di bawah untuk akses fitur:`
  );
}

// Fallback: pesan tidak dikenali (hanya 1 pesan singkat, tanpa welcome + tanpa keyboard)
function buildFallback(): string {
  return `Maaf kak, aku belum paham maksud pesannya 🙏\n\nKetik /start untuk mengakses menu Utama`;
}

// First-time unlinked /start// First-time unlinked /start
async function buildWelcomeUnlinked(firstName: string): Promise<{ text: string; keyboard?: object }> {
  const greeting = greetingByTime();
  const text = (
    `${greeting}, Kak *${firstName}*! 👋\n\n` +
    `Ini adalah *Bot Telegram resmi LESA VI — Witel Suramadu*.\n\n` +
    `Sebelum bisa mengakses fitur bot ini, kami perlu memverifikasi identitas kamu terlebih dahulu 🔐\n\n` +
    `Pilih salah satu cara verifikasi di bawah ini ya kak.`
  );

  return { text, keyboard: VERIF_MAIN_KEYBOARD };
}

// Build message shown when user taps "Saya Butuh Tautan Verifikasi"
async function buildVerifLinkMessage(): Promise<{ text: string; keyboard?: object }> {
  const greeting = greetingByTime();
  const text = (
    `${greeting}, Kak! 👋\n\n` +
    `Selamat datang di *LESA VI — Witel Suramadu*.\n\n` +
    `Sebelum menggunakan fitur yang tersedia, kami perlu melakukan verifikasi akun terlebih dahulu untuk memastikan identitas kamu. 🔐\n\n` +
    `Silakan pilih metode verifikasi yang tersedia di bawah ini ya, Kak.`
  );
  return { text, keyboard: VERIF_CODE_KEYBOARD };
}

// Build message shown when user taps "Masukkan Kode Verifikasi"
function buildVerifCodeMessage(): { text: string; keyboard: object } {
  return {
    text: `📝 *Masukkan Kode Verifikasi*\n\nSilakan ketik atau tempel *Kode Verifikasi* yang kamu dapat dari ADMIN, OFFICER, atau MANAGER LESAVI.\n\nFormat kode: *LV-XXXXXX* (6 karakter unik, case-insensitive)`,
    keyboard: VERIF_CODE_KEYBOARD,
  };
}

// Disconnection message — shown when chatId was previously linked to another account
function buildDisconnectedMessage(nama: string, nik: string, role: string): string {
  const roleLabel = ROLE_LABELS[role] ?? role;
  return (
    `⚠️ *Koneksi Telegram Terputus!*\n\n` +
    `Akun Telegram kamu telah terputus dari data berikut:\n\n` +
    `👤 *Nama:* ${nama}\n` +
    `🆔 *NIK:* ${nik}\n` +
    `🏷 *Role:* ${roleLabel}\n\n` +
    `Jika ini adalah *kesalahan*, silakan hubungi *ADMIN, OFFICER, atau MANAGER* LESAVI kamu untuk mendapatkan Kode Verifikasi baru dan menghubungkan ulang akun Telegram kamu.\n\n` +
    `Salam hangat dari *LESA VI Witel Suramadu* — semoga harimu lancar! 😊`
  );
}

// Get current YYYY-MM period
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Persist across poll cycles to prevent double-processing same update ID
// (module-level so it survives recursive pollOnce calls via setTimeout)
const processedUpdates = new Set<number>();
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_PROCESSED_ENTRIES = 500;

// Prune entries that are guaranteed-delivered (below lastUpdateId) to prevent unbounded growth
function pruneProcessedUpdates() {
  if (lastUpdateId <= 0) return;
  if (processedUpdates.size <= MAX_PROCESSED_ENTRIES) return;
  for (const id of processedUpdates) {
    if (id < lastUpdateId) processedUpdates.delete(id);
  }
  lastCleanupAt = Date.now();
}

// ── pollOnce: fetch + process one batch of Telegram updates ───────────────────
export async function pollOnce() {
  pruneProcessedUpdates();
  try {
    const [settings] = await db.select().from(appSettingsTable);
    if (!settings?.telegramBotToken) return;

    const token = settings.telegramBotToken;
    const offset = lastUpdateId > 0 ? lastUpdateId + 1 : 0;
    const url = `https://api.telegram.org/bot${token}/getUpdates?limit=50&offset=${offset}&timeout=0`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return;

    const data = await resp.json() as { ok: boolean; result: any[] };
    if (!data.ok || !data.result.length) return;

    for (const update of data.result) {
      // Skip already-processed updates (defensive against race conditions)
      if (processedUpdates.has(update.update_id)) continue;
      processedUpdates.add(update.update_id);

      // Advance lastUpdateId IMMEDIATELY so Telegram won't redeliver this
      // if a new poll cycle starts while we're still processing this batch.
      if (update.update_id > lastUpdateId) lastUpdateId = update.update_id;

      // Debug: log ALL incoming updates
      if (update.message) {
        const m = update.message;
        logger.info({ updateId: update.update_id, chatId: m.chat.id, text: m.text, from: m.from?.first_name }, "INCOMING MESSAGE");
      } else if (update.callback_query) {
        const cb = update.callback_query;
        console.log(`[TELEGRAM] INCOMING CALLBACK: data="${cb.data}", from=${cb.from?.first_name}, chatId=${cb.message?.chat?.id || cb.from?.id}`);
        logger.info({ updateId: update.update_id, cbData: cb.data, from: cb.from?.first_name, msgChatId: cb.message?.chat?.id }, "INCOMING CALLBACK");
      }

      // ── callback_query (inline keyboard buttons) ────────────────────────
      if (update.callback_query) {
        try {
          const cb = update.callback_query;
          const cbChatId = String(cb.message?.chat?.id || cb.from?.id || "");
          const cbData = (cb.data || "").trim();
          await answerCallbackQuery(token, cb.id);
          if (!cbChatId) continue;

          // ── Verification flow (works for unlinked users) ────────────────
          if (cbData === VERIF_CODE_UUID) {
            const codeMsg = buildVerifCodeMessage();
            await sendToTelegram(token, cbChatId, codeMsg.text, codeMsg.keyboard).catch(() => {});
            continue;
          }
          if (cbData === VERIF_LINK_UUID) {
            const linkMsg = await buildVerifLinkMessage();
            await sendToTelegram(token, cbChatId, linkMsg.text, linkMsg.keyboard).catch(() => {});
            continue;
          }
          if (cbData === "verif:back") {
            const [linkedAm] = await db.select().from(accountManagersTable)
              .where(eq(accountManagersTable.telegramChatId, cbChatId));
            if (linkedAm) {
              if (linkedAm.role === "ACCOUNT_MANAGER") {
                const p1 = await buildWelcomeAMP1(linkedAm.nama);
                const p2 = buildWelcomeAMP2();
                await sendToTelegram(token, cbChatId, p1).catch(() => {});
                await new Promise(r => setTimeout(r, 300));
                await sendToTelegram(token, cbChatId, p2.text, p2.keyboard).catch(() => {});
              } else {
                const text = await buildWelcomeAdmin(linkedAm.nama, linkedAm.role);
                await sendToTelegram(token, cbChatId, text, getMainKeyboard(linkedAm.role)).catch(() => {});
              }
            } else {
              const welcome = await buildWelcomeUnlinked(cb.message?.chat?.first_name || cb.from?.first_name || "Kak");
              await sendToTelegram(token, cbChatId, welcome.text, welcome.keyboard).catch(() => {});
            }
            continue;
          }

          // Look up linked AM by telegramUserId first (works from group & DM),
          // then fall back to telegramChatId (for DM-only scenarios).
          const cbFromId = Number(cb.from?.id) || 0;
          const [linkedAm] = await db.select().from(accountManagersTable)
            .where(eq(accountManagersTable.telegramUserId, cbFromId));
          const linkedAmByChatId = linkedAm ? null : await db.select().from(accountManagersTable)
            .where(eq(accountManagersTable.telegramChatId, cbChatId)).then(r => r[0]);
          const resolvedAm = linkedAm || linkedAmByChatId;

          if (!resolvedAm) {
            await sendToTelegram(token, cbChatId, `❌ Akun kamu belum terhubung. Minta ADMIN, OFFICER, atau MANAGER untuk generate Kode Verifikasi.`).catch(() => {});
            continue;
          }

          const amFirstName = resolvedAm.nama.split(" ")[0];

          // ── Funneling — show sub-menu ────────────────────────────────────
          if (cbData === "/funneling") {
            const firstName = resolvedAm.nama.split(" ")[0];
            await sendToTelegram(token, cbChatId,
              `📋 *Sales Funneling — LESA VI*\n\n` +
              `Halo kak *${firstName}*! 👋\n\n` +
              `Melalui fitur ini, kakak bisa mengakses data Sales Funneling yang meliputi:\n\n` +
              `📋 *Laporan Terkini*\n` +
              `Ringkasan kondisi funneling terkini dan perkembangan setiap LOP dibanding snapshot sebelumnya.\n\n` +
              `🏆 *Papan Peringkat*\n` +
              `Peringkat performansi Sales Funneling antar AM.\n\n` +
              `📊 *Visualisasi Data*\n` +
              `Grafik dan visualisasi data funneling untuk analisis lebih mendalam.`,
              FUNNEL_SUB_KEYBOARD
            ).catch(() => {});
            continue;
          }

          // ── Activity — show sub-menu ───────────────────────────────────────
          if (cbData === "/activity") {
            const firstName = resolvedAm.nama.split(" ")[0];
            await sendToTelegram(token, cbChatId,
              `📅 *Sales Activity — LESA VI*\n\n` +
              `Halo kak *${firstName}*! 👋\n\n` +
              `Pada fitur *Sales Activity* ini, kakak bisa mengetahui laporan terkini terkait daftar aktivitas penjualan yang sudah tercatat sekaligus melihat ketercapaian jumlah aktivitas yang memenuhi KPI.\n\n` +
              `Selain itu, kakak juga bisa mengetahui posisi peringkat capaian penuntasan KPI terhadap Account Manager lainnya.\n\n` +
              `Untuk lebih detailnya, kakak juga bisa lihat pada *Dashboard LESAVI* untuk visualisasi data yang lebih mudah dipahami.`,
              ACTIVITY_SUB_KEYBOARD
            ).catch(() => {});
            continue;
          }

          // ── Performansi: show period picker ─────────────────────────────
          if (cbData === "/performansi") {
            const now = new Date();
            const displayMonth = `${MONTH_NAMES[now.getMonth() + 1]} ${now.getFullYear()}`;
            const pickerKeyboard = {
              inline_keyboard: [
                [{ text: `📅 Bulan Terkini (${displayMonth})`, callback_data: "perf:current" }],
                [{ text: "🗓 Pilih Bulan Lain", callback_data: "perf:menu" }],
              ],
            };
            await sendToTelegram(token, cbChatId,
              `📊 *Performansi Revenue*\n\nMau lihat rekap performansi bulan apa, kak *${amFirstName}*?`,
              pickerKeyboard
            ).catch(() => {});
            continue;
          }

          // ── perf:current — current month, snapshot-aware ─────────────────
          if (cbData === "perf:current") {
            const period = currentPeriod();
            const msgs = await buildTelegramMessages(resolvedAm.nik, period, { includePerformance: true, includeFunnel: false, includeActivity: false });
            for (const m of msgs) await sendToTelegram(token, cbChatId, m).catch(() => {});
            if (!msgs.length) {
              const now = new Date();
              await sendToTelegram(token, cbChatId,
                `_Data performansi untuk *${MONTH_NAMES[now.getMonth() + 1]} ${now.getFullYear()}* belum tersedia kak *${amFirstName}*. Mungkin belum diimport bulan ini._`
              ).catch(() => {});
            } else {
              await sendToTelegram(token, cbChatId, `Butuh apa lagi kak *${amFirstName}*? 😊`, PERF_NAV_KEYBOARD).catch(() => {});
            }
            continue;
          }

          // ── perf:menu — show available month buttons ──────────────────────
          if (cbData === "perf:menu") {
            const periods = await getAvailablePerfPeriods(resolvedAm.nik);
            if (!periods.length) {
              await sendToTelegram(token, cbChatId, `❌ Belum ada data performansi tersimpan untuk akun kamu kak *${amFirstName}*.`).catch(() => {});
              continue;
            }
            const SHORT_MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
            const buttons = periods.map(p => ({
              text: `${SHORT_MONTHS[p.bulan]} ${p.tahun}`,
              callback_data: `perf:${p.tahun}-${String(p.bulan).padStart(2, "0")}`,
            }));
            const rows: typeof buttons[] = [];
            for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
            await sendToTelegram(token, cbChatId,
              `🗓 *Pilih Periode Performansi*\n\nSilakan pilih bulan yang ingin kamu lihat kak *${amFirstName}*:`,
              { inline_keyboard: rows }
            ).catch(() => {});
            continue;
          }

          // ── perf:YYYY-MM — specific period, snapshot-aware ────────────────
          if (cbData.startsWith("perf:")) {
            const periodStr = cbData.slice(5);
            if (/^\d{4}-\d{2}$/.test(periodStr)) {
              const msgs = await buildTelegramMessages(resolvedAm.nik, periodStr, { includePerformance: true, includeFunnel: false, includeActivity: false });
              for (const m of msgs) await sendToTelegram(token, cbChatId, m).catch(() => {});
              if (!msgs.length) {
                const [yr, mo] = periodStr.split("-").map(Number);
                await sendToTelegram(token, cbChatId,
                  `_Data performansi untuk *${MONTH_NAMES[mo]} ${yr}* tidak ditemukan kak *${amFirstName}*._`
                ).catch(() => {});
              } else {
                await sendToTelegram(token, cbChatId, `Butuh apa lagi kak *${amFirstName}*? 😊`, PERF_NAV_KEYBOARD).catch(() => {});
              }
            }
            continue;
          }

          // ── /prognosa — Prognosa FY ────────────────────────────────────────
          if (cbData === "/prognosa") {
            const firstName = resolvedAm.nama.split(" ")[0];
            await sendToTelegram(token, cbChatId,
              `📊 *Prognosa FY*\n\n` +
              `Halo kak *${firstName}*! 👋\n\n` +
              `Fitur *Prognosa FY* memungkinkan Kakak melihat proyeksi capaian Revenue, Sustain, Scaling, dan NGTMA berdasarkan data terbaru.\n\n` +
              `Fitur ini sedang dalam pengembangan dan akan segera tersedia.\n\n` +
              `Ditunggu ya kak! 🚀`,
              { inline_keyboard: [[{ text: "◀️ Kembali ke Menu", callback_data: "nav:main" }]] }
            ).catch(() => {});
            continue;
          }

          // ── funnel:laporan — Laporan Terkini Sales Funneling ──────────────
          if (cbData === "funnel:laporan") {
            const firstName = resolvedAm.nama.split(" ")[0];
            const reportYear = new Date().getFullYear().toString();

            // Get funnel snapshots — sorted by createdAt DESC (newest first)
            const funnelImportsRaw = await db.select()
              .from(dataImportsTable)
              .where(eq(dataImportsTable.type, "funnel"))
              .orderBy(desc(dataImportsTable.createdAt))
              .limit(10);

            if (funnelImportsRaw.length === 0) {
              await sendToTelegram(token, cbChatId, `Belum ada data Sales Funneling tersedia kak *${firstName}*.`).catch(() => {});
              continue;
            }

            // funnelImportsRaw[0] = newest, [1] = second newest
            const latestImport = funnelImportsRaw[0];
            const prevImport = funnelImportsRaw.length >= 2 ? funnelImportsRaw[1] : null;

            // Load active AM NIKs (same rule as dashboard: ACCOUNT_MANAGER or AM, aktif=true)
            const activeAms = await db.select().from(accountManagersTable);
            const activeNikSet = new Set(
              activeAms
                .filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role) && m.nik)
                .map(m => m.nik)
            );

            const allLopsRaw = await db.select().from(salesFunnelTable)
              .where(eq(salesFunnelTable.nikAm, resolvedAm.nik));

            // Build latest state (highest importId per lopid — same as dashboard)
            const lopLatest = new Map<string, typeof allLopsRaw[0]>();
            for (const l of allLopsRaw) {
              const existing = lopLatest.get(l.lopid);
              if (!existing || (l.importId || 0) > (existing.importId || 0)) {
                lopLatest.set(l.lopid, l);
              }
            }

            // Build prev state: lopids from prevImport only (for CR comparison)
            const prevLopIds = new Set<number>();
            if (prevImport) {
              for (const l of allLopsRaw) {
                if (l.importId === prevImport.id) prevLopIds.add(l.lopid);
              }
            }

            // Year from latest snapshot's period (same as dashboard auto-select year from snapshot)
            const latestSnapYear = latestImport.period
              ? latestImport.period.slice(0, 4)
              : reportYear;

            function isValidLop(l: typeof allLopsRaw[0] | undefined): boolean {
              if (!l) return false;
              // Filter by snapshot's year (same as dashboard: reportDate year matches snapshot period year)
              const rdYear = l.reportDate?.slice(0, 4);
              if (!rdYear || rdYear !== latestSnapYear) return false;
              if (["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase())) return false;
              const vReport = l.isReport;
              if (vReport && vReport.trim().toUpperCase() !== "Y") return false;
              const vType = l.projectType;
              if (vType && !["AO", "MO"].includes(vType.trim().toUpperCase())) return false;
              // Filter by kontrak type — GTMA & Own Channel only (sama kayak dashboard)
              const kontrak = l.kategoriKontrak || "";
              if (kontrak && !["GTMA", "Own Channel"].includes(kontrak)) return false;
              // Only include lopids from active AMs (same as dashboard API filter)
              if (!l.nikAm || !activeNikSet.has(l.nikAm)) return false;
              return true;
            }

            const latestLops = [...lopLatest.values()].filter(isValidLop);
            const prevLops = prevImport
              ? allLopsRaw.filter(l => prevLopIds.has(l.lopid) && isValidLop(l))
              : [];

            const FCOUNT = (lops: typeof latestLops, status: string) =>
              lops.filter(l => l.statusF === status).length;
            // Annualized nilaiProyek — kontrak <12 bln dihitung per tahun (nilai × 12 / bulan)
            const FVAL = (lops: typeof latestLops, status: string) =>
              lops.reduce((s, l) => {
                if (l.statusF !== status) return s;
                const m = l.monthSubs;
                const v = Number(l.nilaiProyek || 0);
                return s + (m && m < 12 ? Math.round(v * 12 / m) : v);
              }, 0);
            const fmt = (n: number) => n >= 1e9 ? `Rp${(n / 1e9).toFixed(2)}M` : n >= 1e6 ? `Rp${(n / 1e6).toFixed(2)}Jt` : n >= 1e3 ? `Rp${(n / 1e3).toFixed(0)}Rb` : `Rp${n}`;

            // Phase counts & nilai — same as dashboard funnel (F0/F1 excluded from display & totals)
            const f2 = FCOUNT(latestLops, "F2"); const v2 = FVAL(latestLops, "F2");
            const f3 = FCOUNT(latestLops, "F3"); const v3 = FVAL(latestLops, "F3");
            const f4 = FCOUNT(latestLops, "F4"); const v4 = FVAL(latestLops, "F4");
            const f5 = FCOUNT(latestLops, "F5"); const v5 = FVAL(latestLops, "F5");
            // Total from F2-F5 only (dashboard AM detail shows only F2+)
            const totalProj = f2 + f3 + f4 + f5;
            const totalNilai = v2 + v3 + v4 + v5;

            const currentSnap = latestImport.snapshotDate || latestImport.createdAt?.toISOString().slice(0, 10) || "-";
            const currentSnapLabel = latestImport.snapshotDate
              ? new Date(latestImport.snapshotDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
              : latestImport.createdAt?.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) || "-";

            // ── PESAN 1: LAPORAN TERKINI ────────────────────────────────
            let msg1 = `📋 *LAPORAN TERKINI SALES FUNNELING*\n\n`;
            msg1 += `Kak *${firstName}* — Edisi *${currentSnapLabel}*\n\n`;
            msg1 += `Berikut merupakan laporan perkembangan Sales Funneling LESA VI.\n\n`;
            msg1 += `📅 Report Date : *${latestSnapYear} (semua bulan)*\n`;
            msg1 += `📑 Jenis Kontrak : GTMA & Own Channel\n`;
            msg1 += `🧮 Perhitungan : Nilai Kontrak per Tahun\n\n`;
            msg1 += `📊 *Ringkasan LOP Kakak Saat Ini:*\n\n`;
            msg1 += `├ F2 (Quote)     : ${f2} proyek | ${fmt(v2)}\n`;
            msg1 += `├ F3 (Negosiasi) : ${f3} proyek | ${fmt(v3)}\n`;
            msg1 += `├ F4 (Closing)   : ${f4} proyek | ${fmt(v4)}\n`;
            msg1 += `└ F5 (Win) ✅   : ${f5} proyek | ${fmt(v5)}\n\n`;
            msg1 += `Total LOP        : *${totalProj} proyek | ${fmt(totalNilai)}*\n\n`;

            if (prevLops.length > 0) {
              const prevF5_val = FVAL(prevLops, "F5");
              const prevF345 = FVAL(prevLops, "F3") + FVAL(prevLops, "F4") + prevF5_val;
              const prevRate = prevF345 > 0 ? (prevF5_val / prevF345 * 100) : 0;
              const f345 = v3 + v4 + v5;
              const currRate = f345 > 0 ? (v5 / f345 * 100) : 0;
              const diff = currRate - prevRate;
              // Truncate (bukan round) agar 12.91% jadi 12.9%, bukan 13.0%
              const fmtRate = (r: number) => `${Math.trunc(r * 10) / 10}%`;
              const prevSnapLabel = prevImport.snapshotDate
                ? new Date(prevImport.snapshotDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
                : prevImport.createdAt?.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) || "-";

              msg1 += `📈 *Perubahan dibanding snapshot sebelumnya:*\n`;
              msg1 += `Conversion Rate : *${fmtRate(currRate)}* (${diff >= 0 ? "▲" : "▼"} ${fmtRate(Math.abs(diff))} vs ${fmtRate(prevRate)})\n`;
              msg1 += `_Snapshot sebelumnya: ${prevSnapLabel}_`;
            }

            await sendToTelegram(token, cbChatId, msg1).catch(() => {});

            // ── PESAN 2: ANALISIS PERKEMBANGAN LOP ───────────────────
            if (prevLops.length > 0) {
              const prevMap = new Map(prevLops.map(l => [l.lopid, l]));
              const stagnan: { lopid: string; pelanggan: string; status: string }[] = [];
              const bergerak: { lopid: string; pelanggan: string; lama: string; baru: string }[] = [];

              for (const lop of latestLops) {
                const prev = prevMap.get(lop.lopid);
                if (!prev) continue;
                const sb = lop.statusF || "";
                const sl = prev.statusF || "";
                if (sb === sl) {
                  if (sb !== "F5") stagnan.push({ lopid: lop.lopid, pelanggan: lop.pelanggan || "-", status: sb });
                } else {
                  bergerak.push({ lopid: lop.lopid, pelanggan: lop.pelanggan || "-", lama: sl, baru: sb });
                }
              }

              const prevSnapLabel = prevImport.snapshotDate
                ? new Date(prevImport.snapshotDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
                : prevImport.createdAt?.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) || "-";

              let msg2 = `📈 *ANALISIS PERKEMBANGAN LOP*\n\n`;
              msg2 += `Perbandingan berdasarkan snapshot terbaru dengan snapshot sebelumnya:\n`;
              msg2 += `📅 Snapshot sebelumnya: *${prevSnapLabel}*\n\n`;

              if (stagnan.length > 0) {
                msg2 += `⚠️ *LOP Belum Bergerak (${stagnan.length})*\n`;
                msg2 += `LOP dengan status yang masih sama dibandingkan snapshot sebelumnya:\n\n`;
                const show = stagnan.slice(0, 10);
                for (const l of show) {
                  msg2 += `• *${l.lopid}* — ${l.pelanggan}\n`;
                  msg2 += `  Status tetap *${l.status}* sejak *${prevSnapLabel}*\n\n`;
                }
                if (stagnan.length > 10) msg2 += `...dan *${stagnan.length - 10}* LOP lainnya belum bergerak\n\n`;
              }

              if (bergerak.length > 0) {
                msg2 += `✅ *LOP Sudah Bergerak (${bergerak.length})*\n`;
                msg2 += `LOP yang mengalami perubahan status dibandingkan snapshot sebelumnya:\n\n`;
                const show = bergerak.slice(0, 5);
                for (const l of show) {
                  msg2 += `• *${l.lopid}* — ${l.pelanggan}\n`;
                  msg2 += `  Bergerak dari *${l.lama}* → *${l.baru}*\n\n`;
                }
                if (bergerak.length > 5) msg2 += `...dan *${bergerak.length - 5}* LOP lainnya\n`;
              }

              msg2 += `\n💡 *Catatan:*\n`;
              msg2 += `Yuk, segera lakukan follow up dan update progress LOP yang masih belum bergerak agar setiap peluang dapat terus berkembang menuju tahap berikutnya.\n\n`;
              msg2 += `_Pastikan setiap aktivitas dan perkembangan terbaru sudah tercatat agar monitoring Sales Funneling tetap akurat._`;

              const stagnanKeyboard = stagnan.length > 10
                ? { inline_keyboard: [[{ text: `🔍 Lihat Semua ${stagnan.length} LOP`, url: `${getPublicBaseUrl()}/visualisasi/funnel` }]] }
                : undefined;
              await sendToTelegram(token, cbChatId, msg2, stagnanKeyboard).catch(() => {});
            }

            await sendToTelegram(token, cbChatId, `Mau apa lagi kak *${firstName}*? 😊`, FUNNEL_SUB_KEYBOARD).catch(() => {});
            continue;
          }

          // ── funnel:peringkat — Papan Peringkat ─────────────────────────
          if (cbData === "funnel:peringkat") {
            const firstName = resolvedAm.nama.split(" ")[0];

            // Get latest funnel snapshot
            const funnelImports = await db
              .select()
              .from(dataImportsTable)
              .where(eq(dataImportsTable.type, "funnel"))
              .orderBy(desc(dataImportsTable.createdAt))
              .limit(2);

            if (funnelImports.length === 0) {
              await sendToTelegram(token, cbChatId, `Belum ada data Sales Funneling kak *${firstName}*.`).catch(() => {});
              continue;
            }

            const latestImport = funnelImports[0];
            const snapYear = latestImport.period?.slice(0, 4) || new Date().getFullYear().toString();
            const snapLabel = latestImport.snapshotDate
              ? new Date(latestImport.snapshotDate).toLocaleDateString("id-ID", { month: "long", year: "numeric" })
              : latestImport.period
                ? `${latestImport.period.slice(4, 6)}/${latestImport.period.slice(0, 4)}`
                : "Terbaru";

            // Active AM NIKs
            const masterAms = await db.select().from(accountManagersTable);
            const activeAms = masterAms.filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role) && m.nik);
            const activeNikSet = new Set(activeAms.map(m => m.nik));
            const amNameByNik = new Map(activeAms.map(m => [m.nik, m.nama]));

            // All LOPs from latest import
            const allLops = await db.select().from(salesFunnelTable)
              .where(eq(salesFunnelTable.importId, latestImport.id));

            // Deduplicate by lopid
            const lopMap = new Map<string, typeof allLops[0]>();
            for (const l of allLops) {
              const existing = lopMap.get(l.lopid);
              if (!existing || (l.importId || 0) > (existing.importId || 0)) lopMap.set(l.lopid, l);
            }
            const uniqueLops = [...lopMap.values()];

            // Calc per-AM stats
            const getAnn = (l: typeof uniqueLops[0]) => {
              const m = l.monthSubs;
              const v = Number(l.nilaiProyek || 0);
              return (m && m < 12) ? Math.round(v * 12 / m) : v;
            };

            const amStats: { nik: string; nama: string; lop: number; f5: number; f345: number; cr: number }[] = [];
            for (const am of activeAms) {
              const lops = uniqueLops.filter(l => {
                if (l.nikAm !== am.nik) return false;
                const rdYear = l.reportDate?.slice(0, 4);
                if (rdYear !== snapYear) return false;
                if (["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase())) return false;
                const vReport = l.isReport;
                if (vReport && vReport.trim().toUpperCase() !== "Y") return false;
                const vType = l.projectType;
                if (vType && !["AO", "MO"].includes(vType.trim().toUpperCase())) return false;
                const kontrak = l.kategoriKontrak || "";
                if (kontrak && !["GTMA", "Own Channel"].includes(kontrak)) return false;
                return true;
              });

              const f3 = lops.filter(l => (l.statusF || "") === "F3").reduce((s, l) => s + getAnn(l), 0);
              const f4 = lops.filter(l => (l.statusF || "") === "F4").reduce((s, l) => s + getAnn(l), 0);
              const f5 = lops.filter(l => (l.statusF || "") === "F5").reduce((s, l) => s + getAnn(l), 0);
              const f345 = f3 + f4 + f5;
              const cr = f345 > 0 ? (f5 / f345) * 100 : 0;

              amStats.push({ nik: am.nik, nama: am.nama, lop: lops.length, f5, f345, cr });
            }

            // Sort by CR descending, then by total nilai
            amStats.sort((a, b) => b.cr - a.cr || b.f5 - a.f5);
            const top = amStats.slice(0, 15);

            const MEDALS = ["🥇", "🥈", "🥉"];
            const fmtVal = (n: number) => n >= 1e9 ? `Rp${(n / 1e9).toFixed(1)}M` : n >= 1e6 ? `Rp${(n / 1e6).toFixed(0)}Jt` : `Rp${(n / 1e3).toFixed(0)}Rb`;
            const fmtRate = (r: number) => `${Math.trunc(r * 10) / 10}%`;

            let msg = `🏆 *PAPAN PERINGKAT SALES FUNNEL*\n\n`;
            msg += `📅 Snapshot: *${snapLabel}*\n`;
            msg += `📑 Filter: GTMA & Own Channel · Nilai per Tahun\n\n`;

            for (let i = 0; i < top.length; i++) {
              const a = top[i];
              const r = i + 1;
              const medal = MEDALS[i] || `${r}.`;
              const badge = a.nik === resolvedAm.nik ? " 👈" : "";
              msg += `${medal} *${a.nama}*${badge}\n`;
              msg += `CR: *${fmtRate(a.cr)}* · LOP: *${a.lop}* proyek · Pipeline: ${fmtVal(a.f345)}\n\n`;
            }

            const isShown = top.some(a => a.nik === resolvedAm.nik);
            if (!isShown) {
              const myStat = amStats.find(a => a.nik === resolvedAm.nik);
              if (myStat) {
                const rank = amStats.findIndex(a => a.nik === resolvedAm.nik) + 1;
                msg += `📌 *${firstName}* · CR: *${fmtRate(myStat.cr)}* · LOP: *${myStat.lop}* proyek · Pipeline: ${fmtVal(myStat.f345)} (#${rank}/${amStats.length})\n`;
              }
            }

            await sendToTelegram(token, cbChatId, msg,
              { inline_keyboard: [[{ text: "◀️ Kembali ke Sales Funneling", callback_data: "/funneling" }]] }
            ).catch(() => {});
            continue;
          }

          // ── funnel:visualisasi — Visualisasi Data ────────────────────────
          if (cbData === "funnel:visualisasi") {
            const firstName = resolvedAm.nama.split(" ")[0];
            const base = getPublicBaseUrl();
            await sendToTelegram(token, cbChatId,
              `📊 *Visualisasi Data Sales Funneling*\n\n` +
              `Halo kak *${firstName}*! 👋\n\n` +
              `Kakak bisa melihat visualisasi data Sales Funneling secara lengkap melalui dashboard LESAVI.\n\n` +
              `📎 Langsung ke Dashboard LESAVI:\n${base}/visualisasi/funnel`,
              { inline_keyboard: [[{ text: "◀️ Kembali ke Sales Funneling", callback_data: "/funneling" }]] }
            ).catch(() => {});
            continue;
          }

          // ── activity:laporan — Laporan Terkini ─────────────────────────────
          if (cbData === "activity:laporan") {
            try {
              const period = currentPeriod();
              const report = await buildActivityReport(resolvedAm.nik);
              logger.info({ cbChatId, nik: resolvedAm.nik, totalActs: report?.totalActivities, pages: report?.totalPages }, "activity:laporan");

              if (!report || report.totalActivities === 0) {
                await sendToTelegram(token, cbChatId,
                  `📅 *SALES ACTIVITY — LESA VI*\n\n` +
                  `Halo kak *${amFirstName}*! 👋\n\n` +
                  `Belum ada data Sales Activity untuk periode ini kak.\n\n` +
                  `Data aktivitas mungkin belum tersedia atau sedang dalam proses import.`
                ).catch(() => {});
                await sendToTelegram(token, cbChatId, `Mau apa lagi kak *${amFirstName}*? 😊`, ACTIVITY_MORE_KEYBOARD).catch(() => {});
                continue;
              }

              // Store pagination state
              activityPageState.set(cbChatId, {
                period,
                summary: report.summary,
                details: report.details,
                totalPages: report.totalPages,
                currentPage: 0,
                nik: resolvedAm.nik,
              });

              // Message 1: summary (no keyboard)
              await sendToTelegram(token, cbChatId, report.summary).catch(() => {});

              // Message 2: first detail page with pagination keyboard
              const hasMultiplePages = report.totalPages > 1;
              const navKb = buildActivityNavKeyboard(0, report.totalPages, hasMultiplePages);
              await sendToTelegram(token, cbChatId, report.details[0], navKb).catch(() => {});
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error({ cbChatId, err: errMsg }, "activity:laporan error");
              await sendToTelegram(token, cbChatId,
                `Terjadi error saat memuat laporan: ${errMsg}`
              ).catch(() => {});
            }
            continue;
          }

          // ── activity:prev / activity:next — pagination ─────────────────────
          if (cbData === "activity:prev" || cbData === "activity:next") {
            const state = activityPageState.get(cbChatId);
            if (!state) {
              await sendToTelegram(token, cbChatId,
                `Sesi laporan sudah expired kak. Silakan minta laporan terbaru dulu ya 👇`,
                { inline_keyboard: [[{ text: "📋 Minta Laporan Baru", callback_data: "activity:laporan" }]] }
              ).catch(() => {});
              continue;
            }

            let nextPage = state.currentPage;
            if (cbData === "activity:prev") nextPage = Math.max(0, state.currentPage - 1);
            if (cbData === "activity:next") nextPage = Math.min(state.totalPages - 1, state.currentPage + 1);

            state.currentPage = nextPage;
            activityPageState.set(cbChatId, state);

            const hasMultiplePages = state.totalPages > 1;
            const navKb = buildActivityNavKeyboard(nextPage, state.totalPages, hasMultiplePages);
            await sendToTelegram(token, cbChatId, state.details[nextPage], navKb).catch(() => {});
            continue;
          }

          // ── activity:period_menu — show month picker from latest snapshot ──
          if (cbData === "activity:period_menu") {
            activityPageState.delete(cbChatId);

            // Get latest activity snapshot
            const [targetSnap] = await db.select().from(dataImportsTable)
              .where(eq(dataImportsTable.type, "activity"))
              .orderBy(desc(dataImportsTable.createdAt))
              .limit(1);

            if (!targetSnap) {
              await sendToTelegram(token, cbChatId,
                `Belum ada data Sales Activity tersimpan kak *${amFirstName}*.`
              ).catch(() => {});
              continue;
            }

            // Get distinct activity months from this snapshot
            const allActs = await db.select({ activityEndDate: salesActivityTable.activityEndDate })
              .from(salesActivityTable)
              .where(eq(salesActivityTable.importId, targetSnap.id));

            const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
            const seenMonths = new Set<string>();
            const monthRows: { y: number; m: number; label: string }[] = [];

            for (const a of allActs) {
              if (!a.activityEndDate) continue;
              const dateStr = a.activityEndDate.replace(/-/g, "");
              if (dateStr.length < 6) continue;
              const y = parseInt(dateStr.slice(0, 4));
              const m = parseInt(dateStr.slice(4, 6));
              const key = `${y}${String(m).padStart(2, "0")}`;
              if (seenMonths.has(key)) continue;
              seenMonths.add(key);
              monthRows.push({ y, m, label: `${MONTH_SHORT[m]} ${y}` });
            }

            if (monthRows.length === 0) {
              await sendToTelegram(token, cbChatId,
                `Belum ada data aktivitas tersimpan kak *${amFirstName}*.`
              ).catch(() => {});
              continue;
            }

            // Sort Jan → Dec
            monthRows.sort((a, b) => a.y !== b.y ? a.y - b.y : a.m - b.m);

            const keyboardRows = monthRows.map(mr => [
              { text: `📅 ${mr.label}`, callback_data: `activity:month:${mr.y}${String(mr.m).padStart(2, "0")}` }
            ]);
            keyboardRows.push([{ text: "◀️ Kembali ke Menu", callback_data: "nav:main" }]);

            await sendToTelegram(token, cbChatId,
              `🗓 *Pilih Bulan Sales Activity*\n\nSilakan pilih periode yang ingin dilihat kak *${amFirstName}*:`, { inline_keyboard: keyboardRows }
            ).catch(() => {});
            continue;
          }

          // ── activity:month:* — show report for specific month in latest snapshot ──
          if (cbData.startsWith("activity:month:")) {
            const monthKey = cbData.split(":")[2]; // YYYYMM
            if (!monthKey || monthKey.length !== 6) { continue; }
            const y = parseInt(monthKey.slice(0, 4));
            const m = parseInt(monthKey.slice(4, 6));
            const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
            const monthLabel = `${MONTH_SHORT[m]} ${y}`;

            // Get latest snapshot
            const [targetSnap] = await db.select().from(dataImportsTable)
              .where(eq(dataImportsTable.type, "activity"))
              .orderBy(desc(dataImportsTable.createdAt))
              .limit(1);

            if (!targetSnap) {
              await sendToTelegram(token, cbChatId, `Data snapshot tidak ditemukan kak *${amFirstName}*.`).catch(() => {});
              continue;
            }

            // Build report for this specific month
            const report = await buildActivityReport(resolvedAm.nik, monthKey);

            const MONTHS3 = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
            let snapYear = y, snapMonth = m;
            if (targetSnap.snapshotDate) {
              const d = new Date(targetSnap.snapshotDate);
              snapYear = d.getFullYear(); snapMonth = d.getMonth() + 1;
            } else if (targetSnap.period) {
              const p = targetSnap.period;
              if (/^\d{6}$/.test(p)) { snapYear = parseInt(p.slice(0,4)); snapMonth = parseInt(p.slice(4,6)); }
              else if (/^\d{4}-\d{2}$/.test(p)) { snapYear = parseInt(p.slice(0,4)); snapMonth = parseInt(p.slice(5,7)); }
              else if (/^\d{8}$/.test(p)) { snapYear = parseInt(p.slice(0,4)); snapMonth = parseInt(p.slice(4,6)); }
            }
            const snapshotLabel = `${MONTHS3[snapMonth]} ${snapYear}`;

            await sendToTelegram(token, cbChatId, `⏳ Memuat laporan periode ${monthLabel}...`).catch(() => {});

            if (!report || report.totalActivities === 0) {
              await sendToTelegram(token, cbChatId,
                `Belum ada data Sales Activity untuk ${monthLabel} kak *${amFirstName}*.`
              ).catch(() => {});
              continue;
            }

            // Store pagination state
            activityPageState.set(cbChatId, {
              period: monthKey,
              summary: report.summary,
              details: report.details,
              totalPages: report.totalPages,
              currentPage: 0,
              nik: resolvedAm.nik,
            });

            // Message 1: summary
            await sendToTelegram(token, cbChatId, report.summary).catch(() => {});

            // Message 2: first detail page
            const hasMultiplePages = report.totalPages > 1;
            const navKb = buildActivityNavKeyboard(0, report.totalPages, hasMultiplePages);
            await sendToTelegram(token, cbChatId, report.details[0], navKb).catch(() => {});
            continue;
          }

          // ── activity:noop — do nothing (just acknowledge) ──────────────────
          if (cbData === "activity:noop") {
            await answerCallbackQuery(token, cb.id).catch(() => {});
            continue;
          }

          // ── activity:peringkat — Papan Peringkat KPI Activity ──────────────
          if (cbData === "activity:peringkat") {
            const firstName = resolvedAm.nama.split(" ")[0];
            const masterAms = await db.select().from(accountManagersTable);
            const activeAms = masterAms.filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role) && m.nik);
            const kpiDefault = 25;

            // Get latest activity snapshot (like dashboard does)
            const latestImports = await db.select().from(dataImportsTable)
              .where(eq(dataImportsTable.type, "activity"))
              .orderBy(desc(dataImportsTable.createdAt))
              .limit(1);

            let snapshotLabel = currentPeriod();
            let allActs: typeof salesActivityTable.$inferSelect[] = [];

            if (latestImports.length > 0) {
              const latestImport = latestImports[0];
              allActs = await db.select().from(salesActivityTable)
                .where(eq(salesActivityTable.importId, latestImport.id));

              // Build snapshot label
              if (latestImport.snapshotDate) {
                const d = new Date(latestImport.snapshotDate);
                snapshotLabel = `${MONTH_NAMES[d.getMonth() + 1]} ${d.getFullYear()}`;
              } else if (latestImport.period) {
                const p = latestImport.period;
                const MONTH_SHORT2 = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
                if (/^\d{6}$/.test(p)) {
                  const y = parseInt(p.slice(0, 4));
                  const m = parseInt(p.slice(4, 6));
                  snapshotLabel = `${MONTH_SHORT2[m]} ${y}`;
                } else if (/^\d{4}-\d{2}$/.test(p)) {
                  const y = parseInt(p.slice(0, 4));
                  const m = parseInt(p.slice(5, 7));
                  snapshotLabel = `${MONTH_SHORT2[m]} ${y}`;
                }
              }
            }

            // Deduplicate by lopid + activity_end_date + label
            const seen = new Set<string>();
            allActs = allActs.filter(a => {
              const key = `${a.lopid ?? ""}|${a.activityEndDate ?? ""}|${a.label ?? ""}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });

            // KPI per AM (all snapshot activities, not filtered by month)
            const amStats: { nik: string; nama: string; total: number; valid: number; kpi: number; pct: number }[] = [];
            for (const am of activeAms) {
              const amAllActs = allActs.filter(a => a.nik === am.nik);
              const validActs = amAllActs.filter(a => a.label && !a.label.toLowerCase().includes("tanpa"));
              const kpiTarget = am.kpiActivity ?? kpiDefault;
              // KPI % capped at 100% (same as dashboard)
              const pct = kpiTarget > 0 ? Math.min(Math.round((validActs.length / kpiTarget) * 100), 100) : 0;
              amStats.push({ nik: am.nik, nama: am.nama, total: amAllActs.length, valid: validActs.length, kpi: kpiTarget, pct });
            }

            amStats.sort((a, b) => b.pct - a.pct || b.valid - a.valid);
            const top = amStats.slice(0, 15);

            const MEDALS = ["🥇", "🥈", "🥉"];

            let msg = `🏆 *PAPAN PERINGKAT SALES ACTIVITY*\n\n`;
            msg += `📅 Snapshot: *${snapshotLabel}*\n`;
            msg += `📑 KPI: Jumlah aktivitas yang memenuhi KPI (capped 100%)\n\n`;

            for (let i = 0; i < top.length; i++) {
              const a = top[i];
              const r = i + 1;
              const medal = MEDALS[i] || `${r}.`;
              const badge = a.nik === resolvedAm.nik ? " 👈" : "";
              msg += `${medal} *${a.nama}*${badge}\n`;
              msg += `KPI: *${a.valid}/${a.kpi}* aktivitas (${a.pct}%)\n\n`;
            }

            const isShown = top.some(a => a.nik === resolvedAm.nik);
            if (!isShown) {
              const myStat = amStats.find(a => a.nik === resolvedAm.nik);
              if (myStat) {
                const rank = amStats.findIndex(a => a.nik === resolvedAm.nik) + 1;
                msg += `📌 *${firstName}* · KPI: *${myStat.valid}/${myStat.kpi}* aktivitas (${myStat.pct}%) (#${rank}/${amStats.length})\n`;
              }
            }

            await sendToTelegram(token, cbChatId, msg, ACTIVITY_SUB_KEYBOARD).catch(() => {});
            continue;
          }

          // ── activity:visualisasi — Visualisasi Data ────────────────────────
          if (cbData === "activity:visualisasi") {
            const firstName = resolvedAm.nama.split(" ")[0];
            const base = getPublicBaseUrl();
            await sendToTelegram(token, cbChatId,
              `📊 *Visualisasi Data Sales Activity*\n\n` +
              `Halo kak *${firstName}*! 👋\n\n` +
              `Kakak bisa melihat visualisasi data Sales Activity secara lengkap melalui dashboard LESAVI.\n\n` +
              `📎 Langsung ke Dashboard LESAVI:\n${base}/visualisasi/activity`,
              { inline_keyboard: [[{ text: "◀️ Kembali ke Sales Activity", callback_data: "/activity" }]] }
            ).catch(() => {});
            continue;
          }

          // ── /logout — putuskan koneksi via inline button ──────────────────
          if (cbData === "/logout") {
            logger.info({ cbChatId, cbFromId, resolvedAmId: resolvedAm?.id, nama: resolvedAm?.nama }, "/logout handler reached");
            if (!resolvedAm) {
              await sendToTelegram(token, cbChatId, `Kamu belum terhubung ke sistem manapun kak.`).catch(() => {});
              continue;
            }
            await db.update(accountManagersTable)
              .set({ telegramChatId: null, telegramUserId: null, telegramUsername: null })
              .where(eq(accountManagersTable.id, resolvedAm.id));
            logger.info({ cbChatId, resolvedAmId: resolvedAm.id, nama: resolvedAm.nama, nik: resolvedAm.nik }, "DB updated — AM telegram fields cleared");
            await sendToTelegram(token, cbChatId,
              `🔓 *Koneksi akun berhasil diputuskan*\n\n` +
              `Terima kasih telah menggunakan *LESA VI*.\n\n` +
              `Jika membutuhkan bantuan terkait layanan LESA, silakan hubungi Admin, Officer, atau Manager LESA.\n\n` +
              `Untuk menggunakan kembali fitur bot, silakan tautkan akun kamu terlebih dahulu.`,
              { inline_keyboard: [[{ text: "🔗 Tautkan Akun", callback_data: VERIF_LINK_UUID }]] }
            ).catch(() => {});
            lastWelcomeSent.delete(cbChatId);
            continue;
          }

          // ── nav:main — kembali ke menu utama ─────────────────────────────
          if (cbData === "nav:main") {
            if (resolvedAm) {
              if (resolvedAm.role === "ACCOUNT_MANAGER") {
                const p1 = await buildWelcomeAMP1(resolvedAm.nama);
                const p2 = buildWelcomeAMP2();
                await sendToTelegram(token, cbChatId, p1).catch(() => {});
                await new Promise(r => setTimeout(r, 300));
                await sendToTelegram(token, cbChatId, p2.text, p2.keyboard).catch(() => {});
              } else {
                const text = await buildWelcomeAdmin(resolvedAm.nama, resolvedAm.role);
                await sendToTelegram(token, cbChatId, text, getMainKeyboard(resolvedAm.role)).catch(() => {});
              }
            } else {
              await sendToTelegram(token, cbChatId, `Ketik /start untuk memulai.`, MAIN_KEYBOARD_EMPTY).catch(() => {});
            }
            continue;
          }

          // ── /list — show list snapshot type menu ─────────────────────────
          if (cbData === "/list") {
            if (!resolvedAm || resolvedAm.role === "ACCOUNT_MANAGER") {
              await sendToTelegram(token, cbChatId, `Fitur ini hanya tersedia untuk *ADMIN*, *OFFICER*, dan *MANAGER*.`).catch(() => {});
              continue;
            }
            const amFirstName = resolvedAm.nama.split(" ")[0];
            snapshotState.delete(cbChatId);
            await sendToTelegram(token, cbChatId,
              `📋 *List Data Snapshot*\n\nPilih tipe data yang ingin dilihat kak *${amFirstName}*:`, LIST_SNAPSHOT_TYPE_KEYBOARD
            ).catch(() => {});
            continue;
          }

          // ── snap:back_to_list ───────────────────────────────────────────
          if (cbData === "snap:back_to_list") {
            const state = snapshotState.get(cbChatId);
            if (!state) {
              await sendToTelegram(token, cbChatId, `Silakan mulai dari menu *List Data Snapshot* kak.`, LIST_SNAPSHOT_TYPE_KEYBOARD).catch(() => {});
              continue;
            }
            const { text, keyboard } = await buildSnapshotListMsg(state.dataType);
            state.step = "choose_snapshot";
            snapshotState.set(cbChatId, state);
            await sendToTelegram(token, cbChatId, text, keyboard).catch(() => {});
            continue;
          }

          // ── snap:perf / snap:funnel / snap:activity ──────────────────────
          if (["snap:perf", "snap:funnel", "snap:activity"].includes(cbData)) {
            const dataType = cbData === "snap:perf" ? "performance" : cbData === "snap:funnel" ? "funnel" : "activity";
            try {
              const { text, keyboard, rows } = await buildSnapshotListMsg(dataType);
              snapshotState.set(cbChatId, { step: "choose_snapshot", dataType, snapshots: rows, selectedIndex: 0 });
              await sendToTelegram(token, cbChatId, text, keyboard).catch(() => {});
            } catch (e: any) {
              logger.error({ err: e, dataType, cbData }, "snap:buildSnapshotListMsg failed");
            }
            continue;
          }

          // ── snap:select ──────────────────────────────────────────────────
          if (cbData.startsWith("snap:select:")) {
            const parts = cbData.split(":");
            const dataType = parts[2] as "performance" | "funnel" | "activity";
            const snapId = parseInt(parts[3], 10);
            if (isNaN(snapId)) { continue; }
            const snaps = await db.select().from(dataImportsTable)
              .where(and(eq(dataImportsTable.id, snapId), eq(dataImportsTable.type, dataType))).limit(1);
            if (!snaps.length) {
              await sendToTelegram(token, cbChatId, `❌ Snapshot tidak ditemukan.`, LIST_SNAPSHOT_TYPE_KEYBOARD).catch(() => {});
              continue;
            }
            const snap = snaps[0];
            const typeLabel = dataType === "performance" ? "Performansi AM" : dataType === "funnel" ? "Sales Funnel" : "Sales Activity";
            const date = snap.snapshotDate
              ? new Date(snap.snapshotDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
              : "-";
            const rows = snap.rowsImported != null ? `${snap.rowsImported.toLocaleString("id-ID")} baris data` : "belum diketahui";
            const domain = getPublicBaseUrl();

            const msg =
              `✅ *Snapshot Dipilih*\n\n` +
              `📊 Tipe Data: *${typeLabel}*\n` +
              `📅 Tanggal: *${date}*\n` +
              `📦 Jumlah: *${rows}*\n\n` +
              `🔗 *Link Akses:*\n` +
              `• Akses Data: ${domain}/import/detail/${dataType}/${snapId}\n` +
              `• Lihat Visualisasi: ${domain}/presentation?type=${dataType}&snapshot=${snapId}\n\n` +
              `Silakan pilih aksi di bawah ya kak 👇`;

            const keyboard = {
              inline_keyboard: [
                [
                  { text: "🗑 Hapus Data", callback_data: `snap:delete:${dataType}:${snapId}` },
                  { text: "◀️ Pilih Snapshot Lain", callback_data: "snap:back_to_list" },
                ],
              ],
            };
            await sendToTelegram(token, cbChatId, msg, keyboard).catch(() => {});
            continue;
          }

          // ── snap:delete ─────────────────────────────────────────────────
          if (cbData.startsWith("snap:delete:")) {
            const parts = cbData.split(":");
            const dataType = parts[2];
            const snapId = parseInt(parts[3], 10);
            if (isNaN(snapId)) { continue; }
            const snap = await db.select().from(dataImportsTable)
              .where(and(eq(dataImportsTable.id, snapId), eq(dataImportsTable.type, dataType))).limit(1);
            if (!snap.length) {
              await sendToTelegram(token, cbChatId, `❌ Snapshot tidak ditemukan.`, LIST_SNAPSHOT_TYPE_KEYBOARD).catch(() => {});
              continue;
            }
            const date = snap[0].snapshotDate
              ? new Date(snap[0].snapshotDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
              : "-";
            const CONFIRM_DELETE_KEYBOARD = {
              inline_keyboard: [
                [
                  { text: "⚠️ Ya, Hapus", callback_data: `snap:confirm_delete:${dataType}:${snapId}` },
                  { text: "❌ Batal", callback_data: "snap:back_to_list" },
                ],
              ],
            };
            await sendToTelegram(token, cbChatId,
              `⚠️ *Konfirmasi Hapus Data*\n\nYakin ingin menghapus snapshot?\n\n📅 Tanggal: *${date}*\n📊 Tipe: *${dataType}*\n\nData yang dihapus tidak dapat dikembalikan.`, CONFIRM_DELETE_KEYBOARD
            ).catch(() => {});
            continue;
          }

          // ── snap:confirm_delete ─────────────────────────────────────────
          if (cbData.startsWith("snap:confirm_delete:")) {
            const parts = cbData.split(":");
            const dataType = parts[2];
            const snapId = parseInt(parts[3], 10);
            if (isNaN(snapId)) { continue; }
            const snap = await db.select().from(dataImportsTable)
              .where(and(eq(dataImportsTable.id, snapId), eq(dataImportsTable.type, dataType))).limit(1);
            if (!snap.length) {
              await sendToTelegram(token, cbChatId, `❌ Snapshot tidak ditemukan.`, LIST_SNAPSHOT_TYPE_KEYBOARD).catch(() => {});
              continue;
            }
            await db.delete(dataImportsTable).where(eq(dataImportsTable.id, snapId));
            await sendToTelegram(token, cbChatId, `✅ Snapshot berhasil dihapus.`).catch(() => {});
            continue;
          }

          // ── /import — show import type selection ─────────────────────────
          if (cbData === "/import") {
            if (!resolvedAm || resolvedAm.role === "ACCOUNT_MANAGER") {
              await sendToTelegram(token, cbChatId, `Fitur ini hanya tersedia untuk *ADMIN*, *OFFICER*, dan *MANAGER*.`).catch(() => {});
              continue;
            }
            importState.set(cbChatId, { step: "idle", importType: "funnel", period: "" });
            const IMPORT_TYPE_KEYBOARD = {
              inline_keyboard: [
                [{ text: "📊 Import Performance", callback_data: "import:type:performance" }],
                [{ text: "🔻 Import Sales Funnel", callback_data: "import:type:funnel" }],
                [{ text: "📅 Import Sales Activity", callback_data: "import:type:activity" }],
                [{ text: "◀️ Menu Utama", callback_data: "nav:main" }],
              ],
            };
            await sendToTelegram(token, cbChatId,
              `📥 *Import Data*\n\nPilih tipe data yang ingin diimport kak *${resolvedAm.nama.split(" ")[0]}*:`,
              IMPORT_TYPE_KEYBOARD
            ).catch(() => {});
            continue;
          }

          // ── /website — send website link ─────────────────────────────────
          if (cbData === "/website") {
            const domain = getPublicBaseUrl();
            await sendToTelegram(token, cbChatId,
              `🌐 *Akses Website*\n\nKlik link berikut untuk membuka dashboard:\n\n${domain}`, MAIN_KEYBOARD_ADMIN
            ).catch(() => {});
            continue;
          }

          // ── import:type:* — set import type and ask for file ─────────────
          if (cbData.startsWith("import:type:")) {
            const type = cbData.split(":")[2] as "performance" | "funnel" | "activity";
            if (!resolvedAm || resolvedAm.role === "ACCOUNT_MANAGER") {
              await sendToTelegram(token, cbChatId, `Fitur ini hanya tersedia untuk *ADMIN*, *OFFICER*, dan *MANAGER*.`).catch(() => {});
              continue;
            }
            const state: ImportState = { step: "waiting_file", importType: type, period: "" };
            importState.set(cbChatId, state);
            funnelFileData.delete(cbChatId);
            activityFileData.delete(cbChatId);
            const typeLabel = type === "performance" ? "Performance" : type === "funnel" ? "Sales Funnel" : "Sales Activity";
            const IMPORT_FILE_KEYBOARD = {
              inline_keyboard: [
                [{ text: "◀️ Kembali ke Menu Import", callback_data: "/import" }],
                [{ text: "🏠 Menu Utama", callback_data: "nav:main" }],
              ],
            };
            await sendToTelegram(token, cbChatId,
              `📥 *Import ${typeLabel}*\n\nKirim file *Excel (.xlsx)* atau *CSV* yang ingin diimport kak *${resolvedAm.nama.split(" ")[0]}*.\n\nPastikan nama file mengandung periode data (format: *DDMMYYYY* atau *YYYYMMDD*) ya kak.`,
              IMPORT_FILE_KEYBOARD
            ).catch(() => {});
            continue;
          }

          // ── import:confirm — process the uploaded file ─────────────────────
          if (cbData === "import:confirm") {
            console.log(`[DEBUG] import:confirm received! cbChatId=${cbChatId}, updateId=${update.update_id}`);
            if (!resolvedAm || resolvedAm.role === "ACCOUNT_MANAGER") {
              await sendToTelegram(token, cbChatId, `Fitur ini hanya tersedia untuk *ADMIN*, *OFFICER*, dan *MANAGER*.`).catch(() => {});
              continue;
            }

            const state = importState.get(cbChatId);
            if (!state) {
              console.error(`[IMPORT DEBUG] importState keys: ${JSON.stringify([...importState.keys()])}`);
              await sendToTelegram(token, cbChatId, `❌ Sesi import tidak ditemukan (state=null). ChatID: ${cbChatId}. Silakan mulai ulang dari menu *Impor Data*.`, getMainKeyboard(resolvedAm.role)).catch(() => {});
              continue;
            }
            if (state.step !== "waiting_confirm") {
              console.error(`[IMPORT DEBUG] state found but step=${state.step}, expected=waiting_confirm`);
              await sendToTelegram(token, cbChatId, `❌ Sesi import tidak ditemukan. Step: ${state.step}. Silakan mulai ulang dari menu *Impor Data*.`, getMainKeyboard(resolvedAm.role)).catch(() => {});
              continue;
            }

            // Get file data from storage
            const fileKey = state.importType === "activity" ? activityFileData : funnelFileData;
            const fileData = fileKey.get(cbChatId);
            if (!fileData) {
              await sendToTelegram(token, cbChatId, `❌ File tidak ditemukan. Silakan upload ulang.`, getMainKeyboard(resolvedAm.role)).catch(() => {});
              continue;
            }

            const typeLabel = state.importType === "performance" ? "Performance" : state.importType === "funnel" ? "Sales Funnel" : "Sales Activity";
            const dbType = state.importType === "performance" ? "performance" : state.importType === "funnel" ? "funnel" : "activity";

            // ── Check for existing snapshot ──────────────────────────────────
            const importPeriod = state.period || "";
            const [existingSnap] = await db.select().from(dataImportsTable)
              .where(and(eq(dataImportsTable.type, dbType), eq(dataImportsTable.period, importPeriod)));

            if (existingSnap) {
              // Ask user: overwrite or cancel
              const existingDate = existingSnap.createdAt
                ? new Date(existingSnap.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
                : "-";
              const existingRows = existingSnap.rowsImported ?? 0;

              state.step = "waiting_overwrite_confirm";
              importState.set(cbChatId, state);

              const OVERWRITE_KEYBOARD = {
                inline_keyboard: [
                  [{ text: "✅ Ya, Timpa Snapshot Lama", callback_data: "import:overwrite" }],
                  [{ text: "❌ Batalkan", callback_data: "import:cancel" }],
                ],
              };

              await sendToTelegram(token, cbChatId,
                `⚠️ *Snapshot Sudah Ada*\n\n` +
                `Untuk tipe *${typeLabel}* periode *${importPeriod}*, sudah ada snapshot yang diimport sebelumnya:\n\n` +
                `📅 Tanggal import : *${existingDate}*\n` +
                `📦 Jumlah baris   : *${existingRows}* baris\n\n` +
                `⚠️ Mengimpor ulang akan *MENIMPA* snapshot lama.\n\n` +
                `Lanjutkan timpa snapshot lama kak *${resolvedAm.nama.split(" ")[0]}*? 👇`,
                OVERWRITE_KEYBOARD
              ).catch(() => {});
              // return NOT continue — we must not fall through to doProcessImport
              return;
            }

            // ── No existing snapshot — proceed directly ─────────────────────
            await doProcessImport(token, cbChatId, state, fileData, resolvedAm);
            continue;
          }

          // ── import:overwrite — proceed with force overwrite ───────────────
          if (cbData === "import:overwrite") {
            if (!resolvedAm || resolvedAm.role === "ACCOUNT_MANAGER") {
              await sendToTelegram(token, cbChatId, `Fitur ini hanya tersedia untuk *ADMIN*, *OFFICER*, dan *MANAGER*.`).catch(() => {});
              continue;
            }

            const state = importState.get(cbChatId);
            if (!state || state.step !== "waiting_overwrite_confirm") {
              await sendToTelegram(token, cbChatId, `❌ Sesi import tidak ditemukan. Silakan mulai ulang dari menu *Impor Data*.`, getMainKeyboard(resolvedAm.role)).catch(() => {});
              continue;
            }

            const fileKey = state.importType === "activity" ? activityFileData : funnelFileData;
            const fileData = fileKey.get(cbChatId);
            if (!fileData) {
              await sendToTelegram(token, cbChatId, `❌ File tidak ditemukan.`, getMainKeyboard(resolvedAm.role)).catch(() => {});
              continue;
            }

            await doProcessImport(token, cbChatId, state, fileData, resolvedAm, true);
            continue;
          }

          // ── import:cancel — cancel import ─────────────────────────────────
          if (cbData === "import:cancel") {
            importState.delete(cbChatId);
            funnelFileData.delete(cbChatId);
            activityFileData.delete(cbChatId);
            await sendToTelegram(token, cbChatId,
              `❌ *Import Dibatalkan*\n\nImport telah dibatalkan kak *${resolvedAm?.nama.split(" ")[0] || "Kak"}*.\n\n` +
              `Silakan mulai ulang kapan saja melalui menu *Impor Data*.`,
              resolvedAm ? getMainKeyboard(resolvedAm.role) : undefined
            ).catch(() => {});
            continue;
          }
        } catch (cbErr) {
          logger.error({ err: cbErr, cbData, chatId: cbChatId }, "Callback handler error");
        }

        continue;

      }

      // ── Regular messages ───────────────────────────────────────────────
      const msg = update.message;
      if (!msg) continue;

      const chatId = String(msg.chat.id);
      const firstName = msg.from?.first_name || msg.chat?.first_name || "";
      const lastName = msg.from?.last_name || msg.chat?.last_name || "";
      const username = msg.from?.username || "";
      const text = (msg.text || "").trim();

      await upsertBotUser({
        chatId, firstName, lastName, username,
        lastMessage: text.slice(0, 80),
        lastSeen: new Date().toISOString(),
      });

      // ── Document / file handling — import flow ───────────────────────────
      const doc = (msg as any).document as { file_id: string; file_name?: string } | undefined;
      if (doc) {
        const state = importState.get(chatId);
        if (state?.step === "waiting_file") {
          try {
            await sendToTelegram(token, chatId,
              `📥 *File Diterima!*\n\n` +
              `⏳ Mendownload file dari Telegram...\n\n` +
              `_Sabarin sebentar ya kak_`
            ).catch(() => {});

            const [linkedAm] = await db.select().from(accountManagersTable)
              .where(eq(accountManagersTable.telegramChatId, chatId));

            const filename = doc.file_name || "file";
            const buffer = await downloadTelegramFile(token, doc.file_id);
            const base64 = buffer.toString("base64");

            const extractedPeriod = extractPeriodFromFilename(filename);
            const amFirstName = linkedAm?.nama.split(" ")[0] || "Kak";

            if (!extractedPeriod) {
              await sendToTelegram(token, chatId,
                `⚠️ *Nama File Tidak Mengandung Tanggal*\n\n` +
                `Bot tidak bisa mendeteksi periode dari nama file:\n*${filename}*\n\n` +
                `Pastikan nama file mengandung tanggal dengan format *DDMMYYYY* atau *YYYYMMDD* ya kak *${amFirstName}*. Silakan upload ulang filenya kak.`
              ).catch(() => {});
              continue;
            }

            // Store file data and period
            const fileKey = state.importType === "activity" ? activityFileData : funnelFileData;
            fileKey.set(chatId, base64);
            state.extractedDate = extractedPeriod;
            state.period = extractedPeriod.replace(/-/g, "");
            state.step = "waiting_confirm";
            importState.set(chatId, state);

            const typeLabel = state.importType === "performance" ? "Performance" : state.importType === "funnel" ? "Sales Funnel" : "Sales Activity";
            const [year, month, day] = extractedPeriod.split("-");
            const monthName = MONTH_NAMES[parseInt(month)] || month;
            const displayDate = `${day} ${monthName} ${year}`;

            const CONFIRM_KEYBOARD = {
              inline_keyboard: [
                [{ text: "✅ Ya, Proses Import", callback_data: "import:confirm" }],
                [{ text: "◀️ Kembali ke Menu Import", callback_data: "/import" }],
              ],
            };

            await sendToTelegram(token, chatId,
              `📄 *File Diterima!*\n\n` +
              `Nama file: *${filename}*\n` +
              `Tipe data : *${typeLabel}*\n` +
              `Periode   : *${displayDate}*\n\n` +
              `Data akan diimport ke sistem LESA VI.\n\n` +
              `Lanjutkan import kak *${amFirstName}*? 👇`,
              CONFIRM_KEYBOARD
            ).catch(() => {});
          } catch (err) {
            logger.error({ err }, "Failed to process uploaded file from Telegram");
            await sendToTelegram(token, chatId,
              `❌ Gagal mendownload file. Pastikan file dikirim ulang ya kak.`
            ).catch(() => {});
          }
          continue;
        }
      }

      const isVerifCode = (s: string) => /^LV-[A-Z0-9]{6}$/i.test(s);

      const tryLinkByCode = async (code: string, source: string) => {
        const now = new Date();

        // ── Check if chatId was previously linked to a different account ─────
        const [previousLinked] = await db.select({
          nama: accountManagersTable.nama,
          nik: accountManagersTable.nik,
          role: accountManagersTable.role,
        }).from(accountManagersTable)
          .where(eq(accountManagersTable.telegramChatId, chatId));
        const previousLinkedAm = previousLinked;

        // ── Try new LV-XXXXXX hashed access code table ────────────────────
        const activeCodes = await db.select().from(telegramAccessCodesTable)
          .where(and(
            gt(telegramAccessCodesTable.expiresAt, now),
            eq(telegramAccessCodesTable.status, "ACTIVE")
          ));

        for (const ac of activeCodes) {
          const valid = await bcrypt.compare(code, ac.codeHash);
          if (!valid) continue;

          const [am] = await db.select().from(accountManagersTable)
            .where(eq(accountManagersTable.id, ac.userId));
          if (!am) continue;

          // ── Disconnect previous link if exists ────────────────────────────
          if (previousLinkedAm) {
            await db.update(accountManagersTable)
              .set({ telegramChatId: null, telegramUserId: null, telegramUsername: null })
              .where(eq(accountManagersTable.telegramChatId, chatId));
            const disMsg = buildDisconnectedMessage(previousLinkedAm.nama, previousLinkedAm.nik, previousLinkedAm.role);
            await sendToTelegram(token, chatId, disMsg).catch(() => {});
          }

          await db.update(accountManagersTable)
            .set({ telegramChatId: chatId, telegramLinkedAt: now, telegramLinkedByAccessCodeId: ac.id })
            .where(eq(accountManagersTable.id, am.id));
          await db.update(telegramAccessCodesTable)
            .set({ usedAt: now, status: "USED" })
            .where(eq(telegramAccessCodesTable.id, ac.id));
          await upsertBotUser({ ...botUsersMap.get(chatId)!, lastMessage: `✅ Linked via ${source}` });
          await sendToTelegram(token, chatId, buildLinkedConfirm(am.nama, am.role), getMainKeyboard(am.role)).catch(() => {});
          logger.info({ amId: am.id, nama: am.nama, role: am.role, chatId, source, accessCodeId: ac.id }, "AM linked via access code");
          return true;
        }

        // No valid code found
        await sendToTelegram(token, chatId, `❌ Kode tidak valid atau sudah kadaluarsa.\n\nMinta ADMIN, OFFICER, atau MANAGER untuk generate Kode Verifikasi baru.`).catch(() => {});
        return false;
      };

      // /start
      if (text.startsWith("/start")) {
        logger.info({ chatId, text }, "PROCESSING /start");
        const deepLinkCode = text.slice(6).trim();
        if (isVerifCode(deepLinkCode)) {
          logger.info({ chatId, deepLinkCode }, "/start WITH valid code — linking");
          await tryLinkByCode(deepLinkCode, "magic link");
          continue;
        }
        const [linkedAm] = await db.select().from(accountManagersTable)
          .where(eq(accountManagersTable.telegramChatId, chatId));
        logger.info({ chatId, linkedAm_nama: linkedAm?.nama, linkedAm_nik: linkedAm?.nik }, "/start linkedAm check result");
        if (linkedAm) {
          logger.info({ chatId, nama: linkedAm.nama }, "SENDING LINKED WELCOME for linked account");
          const now = Date.now();
          const lastSent = lastWelcomeSent.get(chatId) ?? 0;
          if (now - lastSent >= WELCOME_COOLDOWN_MS) {
            if (linkedAm.role === "ACCOUNT_MANAGER") {
              // Split into 2 messages so neither is too long
              const p1 = await buildWelcomeAMP1(linkedAm.nama);
              const p2 = buildWelcomeAMP2();
              await sendToTelegram(token, chatId, p1).catch(() => {});
              await new Promise(r => setTimeout(r, 300));
              await sendToTelegram(token, chatId, p2.text, p2.keyboard).catch(() => {});
            } else {
              const text = await buildWelcomeAdmin(linkedAm.nama, linkedAm.role);
              await sendToTelegram(token, chatId, text, getMainKeyboard(linkedAm.role)).catch(() => {});
            }
            lastWelcomeSent.set(chatId, now);
          } else {
            // Still acknowledge but don't spam
            await sendToTelegram(token, chatId, `Menu utama sudah dikirim tadi kak! Coba pilih menu di bawah ya 👇`, getMainKeyboard(linkedAm.role)).catch(() => {});
          }
        } else {
          logger.info({ chatId, firstName }, "SENDING UNLINKED WELCOME");
          const welcome = await buildWelcomeUnlinked(firstName);
          await sendToTelegram(token, chatId, welcome.text, welcome.keyboard).catch(() => {});
        }
        continue;
      }

      // /myid
      if (text === "/myid") {
        await sendToTelegram(token, chatId,
          `🆔 *Chat ID kamu:* \`${chatId}\`\n\nBagikan ID ini ke admin LESA VI untuk menghubungkan akun kamu ke sistem.`
        ).catch(() => {});
        continue;
      }

      // /logout — putuskan koneksi Telegram
      if (text === "/logout") {
        const [linkedAm] = await db.select().from(accountManagersTable)
          .where(eq(accountManagersTable.telegramChatId, chatId));
        if (!linkedAm) {
          await sendToTelegram(token, chatId, `Kamu belum terhubung ke sistem manapun kak.`).catch(() => {});
          continue;
        }
        await db.update(accountManagersTable)
          .set({ telegramChatId: null, telegramUserId: null, telegramUsername: null })
          .where(eq(accountManagersTable.id, linkedAm.id));
        await sendToTelegram(token, chatId,
          `🔓 *Koneksi Terputus*\n\nAkun Telegram kamu sudah berhasil inúmer dari *${linkedAm.nama}* (${linkedAm.nik}).\n\nJika ingin terhubung kembali, minta ADMIN, OFFICER, atau MANAGER untuk generate Kode Verifikasi baru ya kak.`
        ).catch(() => {});
        lastWelcomeSent.delete(chatId);
        logger.info({ chatId, nama: linkedAm.nama, nik: linkedAm.nik }, "AM disconnected via /logout");
        continue;
      }

      // Text shortcuts
      if (["/activity", "/performansi"].includes(text)) {
        const [linkedAm] = await db.select().from(accountManagersTable)
          .where(eq(accountManagersTable.telegramChatId, chatId));
        if (!linkedAm) {
          await sendToTelegram(token, chatId, `❌ Akun kamu belum terhubung. Minta ADMIN, OFFICER, atau MANAGER untuk generate Kode Verifikasi.`).catch(() => {});
          continue;
        }
        const amFirstName = linkedAm.nama.split(" ")[0];

        // ADMIN/OFFICER/MANAGER should use /list instead
        if (linkedAm.role !== "ACCOUNT_MANAGER") {
          await sendToTelegram(token, chatId,
            `❌ Fitur ini hanya untuk *Account Manager* kak.\n\n` +
            `Untuk melihat data snapshot, silakan ketik */list* ya kak.`,
            getMainKeyboard(linkedAm.role)
          ).catch(() => {});
          continue;
        }

        // Send welcome message with cooldown
        const now = Date.now();
        const lastSent = lastWelcomeSent.get(chatId) ?? 0;
        if (now - lastSent >= WELCOME_COOLDOWN_MS) {
          if (linkedAm.role === "ACCOUNT_MANAGER") {
            const p1 = await buildWelcomeAMP1(linkedAm.nama);
            const p2 = buildWelcomeAMP2();
            await sendToTelegram(token, chatId, p1).catch(() => {});
            await new Promise(r => setTimeout(r, 300));
            await sendToTelegram(token, chatId, p2.text, p2.keyboard).catch(() => {});
          } else {
            const welcomeText = await buildWelcomeAdmin(linkedAm.nama, linkedAm.role);
            await sendToTelegram(token, chatId, welcomeText, getMainKeyboard(linkedAm.role)).catch(() => {});
          }
          lastWelcomeSent.set(chatId, now);
        }

        // /performansi → show period picker
        if (text === "/performansi") {
          const now2 = new Date();
          const displayMonth = `${MONTH_NAMES[now2.getMonth() + 1]} ${now2.getFullYear()}`;
          const pickerKeyboard = {
            inline_keyboard: [
              [{ text: `📅 Bulan Terkini (${displayMonth})`, callback_data: "perf:current" }],
              [{ text: "🗓 Pilih Bulan Lain", callback_data: "perf:menu" }],
            ],
          };
          await sendToTelegram(token, chatId,
            `📊 *Performansi Revenue*\n\nMau lihat rekap performansi bulan apa, kak *${amFirstName}*?`,
            pickerKeyboard
          ).catch(() => {});
          continue;
        }

        // /activity → show sub-menu (intro)
        if (text === "/activity") {
          await sendToTelegram(token, chatId,
            `📅 *Sales Activity — LESA VI*\n\n` +
            `Halo kak *${amFirstName}*! 👋\n\n` +
            `Pada fitur *Sales Activity* ini, kakak bisa mengetahui laporan terkini terkait daftar aktivitas penjualan yang sudah tercatat sekaligus melihat ketercapaian jumlah aktivitas yang memenuhi KPI.\n\n` +
            `Selain itu, kakak juga bisa mengetahui posisi peringkat capaian penuntasan KPI terhadap Account Manager lainnya.\n\n` +
            `Untuk lebih detailnya, kakak juga bisa lihat pada *Dashboard LESAVI* untuk visualisasi data yang lebih mudah dipahami.`,
            ACTIVITY_SUB_KEYBOARD
          ).catch(() => {});
          continue;
        }

        const period = currentPeriod();
        const opts = { includePerformance: false, includeFunnel: text === "/funneling", includeActivity: false };
        const msgs = await buildTelegramMessages(linkedAm.nik, period, opts);
        for (const m of msgs) await sendToTelegram(token, chatId, m).catch(() => {});
        if (!msgs.length) await sendToTelegram(token, chatId, `Belum ada data untuk periode ini kak *${amFirstName}*.`).catch(() => {});
        continue;
      }

      // /list — show snapshot list (for ADMIN/OFFICER/MANAGER)
      if (text === "/list") {
        const [linkedAm] = await db.select().from(accountManagersTable)
          .where(eq(accountManagersTable.telegramChatId, chatId));
        if (!linkedAm || linkedAm.role === "ACCOUNT_MANAGER") {
          await sendToTelegram(token, chatId,
            `❌ Fitur ini hanya tersedia untuk *ADMIN*, *OFFICER*, dan *MANAGER*.`,
            linkedAm ? getMainKeyboard(linkedAm.role) : undefined
          ).catch(() => {});
          continue;
        }
        const amFirstName = linkedAm.nama.split(" ")[0];
        snapshotState.delete(chatId);
        await sendToTelegram(token, chatId,
          `📋 *List Data Snapshot*\n\nPilih tipe data yang ingin dilihat kak *${amFirstName}*:`, LIST_SNAPSHOT_TYPE_KEYBOARD
        ).catch(() => {});
        continue;
      }

      // Verification code
      if (isVerifCode(text)) {
        await tryLinkByCode(text, "manual code");
        continue;
      }

      // ── AI chat for all other messages ─────────────────────────────────
      if (text && !text.startsWith("/")) {
        const [linkedAm] = await db.select().from(accountManagersTable)
          .where(eq(accountManagersTable.telegramChatId, chatId));

        const aiReply = await chatWithGemini(text, {
          amName: linkedAm?.nama,
          divisi: linkedAm?.divisi,
        });

        if (aiReply) {
          await sendToTelegram(token, chatId, aiReply).catch(() => {});
        } else if (!linkedAm) {
          // User is unlinked — send the full unlinked welcome
          const unlinked = await buildWelcomeUnlinked(firstName);
          await sendToTelegram(token, chatId, unlinked.text, unlinked.keyboard).catch(() => {});
        } else {
          // Fallback: unrecognized text from linked user, short message (no cooldown)
          const fallbackText = buildFallback();
          await sendToTelegram(token, chatId, fallbackText).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error(`[TELEGRAM POLLER ERROR] ${err}`);
    logger.error({ err }, "Telegram poller error");
  }
}

async function deleteWebhookIfAny(token: string) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
    const data = await resp.json() as { ok: boolean };
    if (data.ok) logger.info("Telegram webhook deleted — using getUpdates polling");
  } catch { /* non-fatal */ }
}

// Public commands (visible to everyone in / menu).
// Role-specific commands are shown via inline keyboard in the welcome message instead.
const PUBLIC_BOT_COMMANDS = [
  { command: "start", description: "Memulai bot & verifikasi akun" },
  { command: "list", description: "List Data Snapshot" },
  { command: "website", description: "Buka Dashboard LESA VI" },
];

async function registerBotCommands(token: string) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: PUBLIC_BOT_COMMANDS }),
    });
    const data = await resp.json() as { ok: boolean };
    if (data.ok) {
      logger.info({ count: PUBLIC_BOT_COMMANDS.length }, "Bot commands registered with Telegram");
    } else {
      logger.warn({ err: data }, "Failed to register bot commands");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to register bot commands (non-fatal)");
  }
}

export function startTelegramPoller(intervalMs = 3000) {
  const run = async () => {
    await pollOnce();
    pollerTimer = setTimeout(run, intervalMs);
  };
  db.select().from(appSettingsTable).then(([settings]) => {
    if (settings?.telegramBotToken) {
      deleteWebhookIfAny(settings.telegramBotToken).then(async () => {
        await registerBotCommands(settings.telegramBotToken!);
        logger.info({ intervalMs }, "Telegram background poller started");
        pollerTimer = setTimeout(run, 3000);
      });
    } else {
      logger.info({ intervalMs }, "Telegram background poller started (no token yet)");
      pollerTimer = setTimeout(run, 5000);
    }
  }).catch(() => { pollerTimer = setTimeout(run, 5000); });

  // Graceful shutdown: flush lastUpdateId before process exits (SIGTERM/SIGINT from pm2)
  const shutdown = async () => {
    logger.info("Received shutdown signal — flushing Telegram offset...");
    clearTimeout(pollerTimer);
    await flushLastUpdateId();
    logger.info("Graceful shutdown complete");
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function stopTelegramPoller() {
  if (pollerTimer) { clearTimeout(pollerTimer); pollerTimer = null; }
}

export function rescheduleTelegramPoller(newToken?: string) {
  logger.info("Telegram poller rescheduled — token updated");
  stopTelegramPoller();
  lastUpdateId = 0;
  processedUpdates.clear();
  const restart = async () => {
    if (newToken) {
      try { await (async () => {
        const resp = await fetch(`https://api.telegram.org/bot${newToken}/deleteWebhook?drop_pending_updates=false`);
        const data = await resp.json() as { ok: boolean };
        if (data.ok) logger.info("Webhook cleared for new token");
      })(); } catch { /* non-fatal */ }
    }
    startTelegramPoller(3000);
  };
  setTimeout(() => restart().catch(() => {}), 500);
}
