import { db, appSettingsTable, accountManagersTable, performanceDataTable, salesFunnelTable, salesActivityTable, telegramLogsTable, dataImportsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../../shared/logger";
import { getPublicBaseUrl } from "../../shared/publicUrl";
import { generatePerfFeedback } from "./ai";

const MONTH_NAMES = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function formatSnapshotDate(snapshotDate: string | null | undefined, period: string | null | undefined, fallback: string = "-"): string {
  const raw = snapshotDate || period || "";
  if (!raw) return fallback;
  if (raw.length === 10) {
    // YYYY-MM-DD
    const [y, m, d] = raw.split("-").map(Number);
    if (y && m && d) return `${d} ${MONTH_NAMES[m] || m} ${y}`;
  }
  if (raw.length === 7) {
    // YYYY-MM
    const [y, m] = raw.split("-").map(Number);
    if (y && m) return `${MONTH_NAMES[m] || m} ${y}`;
  }
  return raw;
}

// ── Snapshot-aware helpers ──────────────────────────────────────────────────

// Get performance rows for a period: try latest snapshot first, fallback to all snapshots
async function getSnapshotAwarePerfs(year: number, month: number) {
  const [latestImport] = await db.select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(1);

  if (latestImport) {
    const fromLatest = await db.select().from(performanceDataTable)
      .where(and(
        eq(performanceDataTable.importId, latestImport.id),
        eq(performanceDataTable.tahun, year),
        eq(performanceDataTable.bulan, month),
      ));
    if (fromLatest.length > 0) return fromLatest;
  }

  // Fallback: any data for that period across all snapshots
  return db.select().from(performanceDataTable)
    .where(and(eq(performanceDataTable.tahun, year), eq(performanceDataTable.bulan, month)));
}

// Get distinct periods that have data for a given NIK, ordered newest first
export async function getAvailablePerfPeriods(nik: string): Promise<{ tahun: number; bulan: number }[]> {
  const rows = await db.selectDistinct({
    tahun: performanceDataTable.tahun,
    bulan: performanceDataTable.bulan,
  }).from(performanceDataTable)
    .where(eq(performanceDataTable.nik, nik));
  return rows.sort((a, b) => b.tahun !== a.tahun ? b.tahun - a.tahun : b.bulan - a.bulan);
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatRupiah(val: number): string {
  if (val >= 1_000_000_000_000) return `Rp ${(val / 1_000_000_000_000).toFixed(2).replace(".", ",")} Triliun`;
  if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(2).replace(".", ",")} Miliar`;
  if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(2).replace(".", ",")} Juta`;
  if (val === 0) return `Rp 0`;
  return `Rp ${val.toLocaleString("id-ID")}`;
}

function fmtPct(val: number): string {
  return val.toFixed(2).replace(".", ",") + "%";
}

function achLabel(ach: number): string {
  if (ach >= 100) return "(Tercapai)";
  if (ach >= 80) return "(Mendekati)";
  return "(Di bawah target)";
}

function greetingByTime(): string {
  const hourWib = (new Date().getUTCHours() + 7) % 24;
  if (hourWib >= 3 && hourWib < 11) return "Selamat pagi";
  if (hourWib >= 11 && hourWib < 15) return "Selamat siang";
  if (hourWib >= 15 && hourWib < 18) return "Selamat sore";
  return "Selamat malam";
}

function rankFeedback(firstName: string, rankCm: number, achCm: number): string {
  if (achCm >= 100) return `✅ Selamat kak ${firstName}! Target bulan ini sudah tercapai. Mantap sekali, pertahankan momentum ini di bulan depan!`;
  if (rankCm === 1) return `🥇 Luar biasa kak ${firstName}! Kamu jadi yang terbaik bulan ini di antara seluruh AM Witel Suramadu. Pertahankan terus ya!`;
  if (rankCm <= 3) return `🥈 Keren kak ${firstName}! Kamu masuk podium top 3 bulan ini. Tinggal sedikit lagi menuju puncak — tetap semangat!`;
  if (rankCm <= 10) return `⚡ Good job kak ${firstName}! Kamu sudah di kelompok atas. Terus tingkatkan dan podium bukan hal yang mustahil buat kamu!`;
  return `💪 Semangat kak ${firstName}! Masih ada waktu tersisa di bulan ini — yuk kejar targetnya!\nJangan ragu koordinasi dengan tim kalau butuh support ya 🙏`;
}

function getEmbedUrl(): string {
  return `${getPublicBaseUrl()}/presentation`;
}

function getFunnelDetailUrl(): string {
  return `${getPublicBaseUrl()}/visualisasi/funnel`;
}

// ── Funnel helpers ──────────────────────────────────────────────────────────

function isFunnel5(status: string | null | undefined): boolean {
  return status === "F5" || status === "Won";
}

interface FunnelCounts { F0: number; F1: number; F2: number; F3: number; F4: number; F5: number }

function countByStatus(lops: { statusF?: string | null }[]): FunnelCounts {
  const counts: FunnelCounts = { F0: 0, F1: 0, F2: 0, F3: 0, F4: 0, F5: 0 };
  for (const l of lops) {
    const s = l.statusF || "";
    if (s === "F0") counts.F0++;
    else if (s === "F1") counts.F1++;
    else if (s === "F2") counts.F2++;
    else if (s === "F3") counts.F3++;
    else if (s === "F4") counts.F4++;
    else if (s === "F5" || s === "Won") counts.F5++;
  }
  return counts;
}

// --- BUILD FUNCTIONS: each returns ONE message string ---

async function buildPerformanceMessage(
  nik: string,
  period: string,
): Promise<string | null> {
  const [year, month] = period.split("-").map(Number);

  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, nik));
  if (!am) return null;

  const firstName = am.nama.split(" ")[0];

  // Fetch all AMs' performance data for this period — latest snapshot first, fallback to all
  const allPerfs = await getSnapshotAwarePerfs(year, month);

  const p = allPerfs.find(x => x.nik === nik);
  const totalAMs = allPerfs.length;

  // Both ranks computed dynamically from all AMs in this period
  const sortedByCm = [...allPerfs].sort((a, b) => (b.achRate || 0) - (a.achRate || 0));
  const rankCm = sortedByCm.findIndex(x => x.nik === nik) + 1;

  const sortedByYtd = [...allPerfs].sort((a, b) => (b.achRateYtd || 0) - (a.achRateYtd || 0));
  const rankYtd = sortedByYtd.findIndex(x => x.nik === nik) + 1;

  // Overall rates
  const achCm = p?.achRate || 0;
  const achYtd = p?.achRateYtd || 0;

  // Fetch YTD data for sub-categories: all months in same year up to this month
  const ytdPerfs = await db.select().from(performanceDataTable)
    .where(and(eq(performanceDataTable.nik, nik), eq(performanceDataTable.tahun, year)));
  const ytdUpTo = ytdPerfs.filter(x => x.bulan <= month);

  function sumYtdAch(realKey: keyof typeof ytdPerfs[0], targetKey: keyof typeof ytdPerfs[0]): number {
    const totalReal = ytdUpTo.reduce((s, x) => s + ((x[realKey] as number) || 0), 0);
    const totalTarget = ytdUpTo.reduce((s, x) => s + ((x[targetKey] as number) || 0), 0);
    return totalTarget > 0 ? (totalReal / totalTarget) * 100 : 0;
  }

  const achRegulerCm = (p?.targetReguler ?? 0) > 0 ? ((p?.realReguler ?? 0) / p!.targetReguler!) * 100 : 0;
  const achSustainCm = (p?.targetSustain ?? 0) > 0 ? ((p?.realSustain ?? 0) / p!.targetSustain!) * 100 : 0;
  const achScalingCm = (p?.targetScaling ?? 0) > 0 ? ((p?.realScaling ?? 0) / p!.targetScaling!) * 100 : 0;
  const achNgtmaCm   = (p?.targetNgtma ?? 0) > 0   ? ((p?.realNgtma ?? 0)   / p!.targetNgtma!)   * 100 : 0;

  const achRegulerYtd = sumYtdAch("realReguler", "targetReguler");
  const achSustainYtd = sumYtdAch("realSustain", "targetSustain");
  const achScalingYtd = sumYtdAch("realScaling", "targetScaling");
  const achNgtmaYtd   = sumYtdAch("realNgtma", "targetNgtma");

  const greeting = greetingByTime();

  // Detect zero-revenue condition: all real values are 0
  const totalReal = (p?.realReguler ?? 0) + (p?.realSustain ?? 0) + (p?.realScaling ?? 0) + (p?.realNgtma ?? 0);
  const noRealData = !p || totalReal === 0;

  // Only call AI for feedback when there's actual data (saves time on empty records)
  const fallbackFeedback = rankFeedback(firstName, rankCm, achCm);
  const feedback = noRealData
    ? null
    : await generatePerfFeedback(firstName, achCm, rankCm, totalAMs, MONTH_NAMES[month], year, fallbackFeedback);

  let msg = `📊 *LAPORAN PERFORMANSI ACCOUNT MANAGER*\n`;
  msg += `LESA VI — Witel Suramadu\n\n`;
  msg += `Halo kak *${firstName}*! 👋 ${greeting}\n\n`;
  msg += `Berikut rekap performansi kamu\n`;
  msg += `untuk periode *${MONTH_NAMES[month]} ${year}*:\n\n`;

  // Section A: Reguler — with rank
  msg += `*A. Reguler Revenue*\n`;
  msg += `├ *Real Revenue*   : ${formatRupiah(p?.realReguler ?? 0)}\n`;
  msg += `├ *Target Revenue* : ${formatRupiah(p?.targetReguler ?? 0)}\n`;
  msg += `├ *Ach CM*         : ${fmtPct(achRegulerCm)} ${achLabel(achRegulerCm)}\n`;
  msg += `├ *Ach YTD*        : ${fmtPct(achRegulerYtd)} ${achLabel(achRegulerYtd)}\n`;
  msg += `│   *Rank CM*      : #${rankCm} dari ${totalAMs}\n`;
  msg += `│   *Rank YTD*     : #${rankYtd} dari ${totalAMs}\n\n`;

  // Section B: Sustain
  msg += `*B. Sustain Revenue*\n`;
  msg += `├ *Real Revenue*   : ${formatRupiah(p?.realSustain ?? 0)}\n`;
  msg += `├ *Target Sustain* : ${formatRupiah(p?.targetSustain ?? 0)}\n`;
  msg += `├ *Ach CM*         : ${fmtPct(achSustainCm)} ${achLabel(achSustainCm)}\n`;
  msg += `└ *Ach YTD*        : ${fmtPct(achSustainYtd)} ${achLabel(achSustainYtd)}\n\n`;

  // Section C: Scaling
  msg += `*C. Scaling Revenue*\n`;
  msg += `├ *Real Revenue*   : ${formatRupiah(p?.realScaling ?? 0)}\n`;
  msg += `├ *Target Scaling* : ${formatRupiah(p?.targetScaling ?? 0)}\n`;
  msg += `├ *Ach CM*         : ${fmtPct(achScalingCm)} ${achLabel(achScalingCm)}\n`;
  msg += `└ *Ach YTD*        : ${fmtPct(achScalingYtd)} ${achLabel(achScalingYtd)}\n\n`;

  // Section D: NGTMA
  msg += `*D. NGTMA Revenue*\n`;
  msg += `├ *Real Revenue*   : ${formatRupiah(p?.realNgtma ?? 0)}\n`;
  msg += `├ *Target NGTMA*   : ${formatRupiah(p?.targetNgtma ?? 0)}\n`;
  msg += `├ *Ach CM*         : ${fmtPct(achNgtmaCm)} ${achLabel(achNgtmaCm)}\n`;
  msg += `└ *Ach YTD*        : ${fmtPct(achNgtmaYtd)} ${achLabel(achNgtmaYtd)}\n\n`;

  msg += `💬 *Feedback Performansi:*\n\n`;
  if (noRealData) {
    msg += `_Mohon maaf kak, sepertinya data revenue kamu untuk periode ini belum tercatat di sistem. Mohon menunggu info update terkait performa bulan ini ya — kami akan segera menginformasikan jika data sudah tersedia. 🙏_\n\n`;
  } else {
    msg += `${feedback}\n\n`;
  }
  msg += `📎 Untuk melihat performa lengkap kamu dan benchmarking dengan AM lain, silahkan akses link berikut:\n`;
  msg += `${getEmbedUrl()}`;

  return msg;
}

async function buildFunnelMessage(nik: string): Promise<string | null> {
  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, nik));
  if (!am) return null;

  // Get funnel import snapshots — sort: null snapshotDate first (most recent/current week),
  // then by snapshotDate DESC, then createdAt DESC as tiebreaker
  const funnelImportsRaw = await db.select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(10);

  if (funnelImportsRaw.length === 0) return null;

  // Sort: null snapshotDate (freshly uploaded, most recent week) comes first,
  // then by snapshotDate DESC, then by createdAt DESC
  const funnelImports = [...funnelImportsRaw].sort((a, b) => {
    const aDate = a.snapshotDate;
    const bDate = b.snapshotDate;
    if (!aDate && !bDate) return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    if (!aDate) return -1; // null = newest
    if (!bDate) return 1;
    if (bDate > aDate) return 1;
    if (aDate > bDate) return -1;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });

  // All LOPs for this AM in the 2 relevant snapshot imports
  const latestImport = funnelImports[0];
  const prevImport = funnelImports.length >= 2 ? funnelImports[1] : null;

  const relevantImportIds = [latestImport.id, ...(prevImport ? [prevImport.id] : [])];
  const allLopsRaw = await db.select().from(salesFunnelTable).where(eq(salesFunnelTable.nikAm, nik));

  // Filter to current year (2026) by reportDate only
  const REPORT_YEAR = new Date().getFullYear().toString();
  const allLops = allLopsRaw.filter(l =>
    relevantImportIds.includes(l.importId!) &&
    l.reportDate?.startsWith(REPORT_YEAR)
  );

  const latestLops = allLops.filter(l => l.importId === latestImport.id);
  const counts = countByStatus(latestLops);
  const total = latestLops.length;
  const snapshotDateLatest = formatSnapshotDate(
    latestImport.snapshotDate,
    latestImport.period,
    latestImport.createdAt?.toISOString()?.slice(0, 10) || "-"
  );

  // ── Kondisi C: Only 1 snapshot — no comparison possible ─────────────────
  if (!prevImport) {
    let msg = `📋 *MONITORING SALES FUNNELING*\n`;
    msg += `LESA VI — Witel Suramadu\n\n`;
    msg += `Halo kak *${am.nama}*! 👋\n\n`;
    msg += `Berikut data funneling kakak per *${snapshotDateLatest}* ya kak 🙏\n\n`;
    msg += `📊 *Ringkasan LOP Kakak Saat Ini:*\n`;
    msg += `├ F0 (Lead)        : ${counts.F0} proyek\n`;
    msg += `├ F1 (Prospect)    : ${counts.F1} proyek\n`;
    msg += `├ F2 (Quote)       : ${counts.F2} proyek\n`;
    msg += `├ F3 (Negosiasi)   : ${counts.F3} proyek\n`;
    msg += `├ F4 (Closing)     : ${counts.F4} proyek\n`;
    msg += `└ F5 (Won) ✅      : ${counts.F5} proyek\n`;
    msg += `*Total             : ${total} proyek*\n\n`;
    msg += `_ℹ️ Perbandingan belum tersedia — ini snapshot pertama yang tercatat._\n`;
    msg += `_Perbandingan akan muncul pada laporan berikutnya._\n\n`;
    msg += `📎 Detail lengkap:\n`;
    msg += getFunnelDetailUrl();
    return msg;
  }

  // ── 2+ snapshots: compare latest vs previous ─────────────────────────────
  const prevLops = allLops.filter(l => l.importId === prevImport.id);
  const snapshotDatePrev = formatSnapshotDate(
    prevImport.snapshotDate,
    prevImport.period,
    prevImport.createdAt?.toISOString()?.slice(0, 10) || "-"
  );

  const prevMap = new Map(prevLops.map(l => [l.lopid, l]));

  const lopStagnan: { lopid: string; pelanggan: string; status: string }[] = [];
  const lopBergerak: { lopid: string; pelanggan: string; statusLama: string; statusBaru: string }[] = [];
  const lopBaru: { lopid: string; pelanggan: string; status: string }[] = [];

  for (const lop of latestLops) {
    const prev = prevMap.get(lop.lopid);
    if (!prev) {
      lopBaru.push({ lopid: lop.lopid, pelanggan: lop.pelanggan, status: lop.statusF || "" });
      continue;
    }

    const statusBaru = lop.statusF || "";
    const statusLama = prev.statusF || "";

    if (statusBaru === statusLama) {
      if (!isFunnel5(statusBaru)) {
        lopStagnan.push({ lopid: lop.lopid, pelanggan: lop.pelanggan, status: statusBaru });
      }
    } else {
      lopBergerak.push({ lopid: lop.lopid, pelanggan: lop.pelanggan, statusLama, statusBaru });
    }
  }

  const hasStagnan = lopStagnan.length > 0;

  // ── Header ───────────────────────────────────────────────────────────────
  let msg = `📋 *MONITORING SALES FUNNELING*\n`;
  msg += `LESA VI — Witel Suramadu\n\n`;
  msg += `Halo kak *${am.nama}*! 👋\n\n`;
  msg += `Berikut data funneling kakak per *${snapshotDateLatest}* ya kak 🙏\n\n`;
  msg += `📊 *Ringkasan LOP Kakak Saat Ini:*\n`;
  msg += `├ F0 (Lead)        : ${counts.F0} proyek\n`;
  msg += `├ F1 (Prospect)    : ${counts.F1} proyek\n`;
  msg += `├ F2 (Quote)       : ${counts.F2} proyek\n`;
  msg += `├ F3 (Negosiasi)   : ${counts.F3} proyek\n`;
  msg += `├ F4 (Closing)     : ${counts.F4} proyek\n`;
  msg += `└ F5 (Won) ✅      : ${counts.F5} proyek\n`;
  msg += `*Total             : ${total} proyek*\n\n`;
  msg += `📅 _Dibandingkan dengan snapshot *${snapshotDatePrev}*_\n`;

  const MAX_LIST = 10;

  // ── LOP Baru (hanya ada di snapshot terkini) ──────────────────────────────
  if (lopBaru.length > 0) {
    msg += `\n🆕 *LOP Baru di Snapshot Ini (${lopBaru.length}):*\n`;
    const baruShow = lopBaru.slice(0, MAX_LIST);
    const baruRest = lopBaru.length - baruShow.length;
    for (const lop of baruShow) {
      msg += `\n• *${lop.lopid}* — ${lop.pelanggan}\n`;
      msg += `  Status: *${lop.status}*\n`;
    }
    if (baruRest > 0) {
      msg += `\n_...dan ${baruRest} LOP baru lainnya (lihat detail)_\n`;
    }
  }

  if (hasStagnan) {
    // ── Kondisi A: Ada LOP stagnan ─────────────────────────────────────────
    msg += `\n⚠️ *LOP Belum Bergerak (${lopStagnan.length}):*\n`;
    msg += `_(status sama dengan snapshot *${snapshotDatePrev}*)_\n`;
    const stagnanShow = lopStagnan.slice(0, MAX_LIST);
    const stagnanRest = lopStagnan.length - stagnanShow.length;
    for (const lop of stagnanShow) {
      msg += `\n• *${lop.lopid}* — ${lop.pelanggan}\n`;
      msg += `  Status masih *${lop.status}* sejak *${snapshotDatePrev}*\n`;
    }
    if (stagnanRest > 0) {
      msg += `\n_...dan ${stagnanRest} LOP lainnya belum bergerak (lihat detail)_\n`;
    }

    msg += `\n✅ *LOP yang Sudah Bergerak (${lopBergerak.length}):*\n`;
    msg += `_(ada perubahan status dibanding *${snapshotDatePrev}*)_\n`;
    if (lopBergerak.length > 0) {
      const bergerakShow = lopBergerak.slice(0, MAX_LIST);
      const bergerakRest = lopBergerak.length - bergerakShow.length;
      for (const lop of bergerakShow) {
        msg += `\n• *${lop.lopid}* — ${lop.pelanggan}\n`;
        msg += `  ${lop.statusLama} → *${lop.statusBaru}* 🎯\n`;
      }
      if (bergerakRest > 0) {
        msg += `\n_...dan ${bergerakRest} LOP lainnya (lihat detail)_\n`;
      }
    } else {
      msg += `\n_Belum ada pergerakan status pada periode ini._\n`;
    }
  } else {
    // ── Kondisi B: Semua LOP sudah bergerak / tidak ada LOP yang perlu dipantau ──
    if (lopBergerak.length > 0) {
      msg += `\n🎉 *Semua LOP Bergerak — Keren!*\n\n`;
      msg += `✅ *Perubahan Status LOP (${lopBergerak.length}):*\n`;
      const bergerakShow = lopBergerak.slice(0, MAX_LIST);
      const bergerakRest = lopBergerak.length - bergerakShow.length;
      for (const lop of bergerakShow) {
        msg += `\n• *${lop.lopid}* — ${lop.pelanggan}\n`;
        msg += `  ${lop.statusLama} → *${lop.statusBaru}* 🎯\n`;
      }
      if (bergerakRest > 0) {
        msg += `\n_...dan ${bergerakRest} LOP lainnya (lihat detail)_\n`;
      }
    } else {
      msg += `\n_Belum ada LOP tahun ${REPORT_YEAR} yang dapat dibandingkan pada snapshot ini._\n`;
    }
  }

  msg += `\n📎 Detail lengkap:\n`;
  msg += getFunnelDetailUrl();

  // Hard safety cap: Telegram max is 4096 chars
  if (msg.length > 4000) {
    const footer = `\n\n_[Pesan terpotong] Detail lengkap:\n${getFunnelDetailUrl()}_`;
    msg = msg.slice(0, 4000 - footer.length) + footer;
  }

  return msg;
}

// Return type for activity report — handler controls pagination UI
export interface ActivityReport {
  summary: string;
  details: string[];
  amFirstName: string;
  totalPages: number;
  totalActivities: number;
  validCount: number;
  kpiTarget: number;
  kpiPercent: number;
  snapshotLabel: string;
  nik: string;
}

export async function buildActivityReport(nik: string, monthKey?: string): Promise<ActivityReport | null> {
  function currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, nik));
  if (!am) return null;

  // Always get the latest activity snapshot
  const [targetSnap] = await db.select().from(dataImportsTable)
    .where(eq(dataImportsTable.type, "activity"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(1);

  let allNikActs: typeof salesActivityTable.$inferSelect[] = [];

  // Determine snapshot year and latest month
  let snapYear = new Date().getFullYear();
  let snapMonth = new Date().getMonth() + 1;
  if (targetSnap) {
    if (targetSnap.snapshotDate) {
      const d = new Date(targetSnap.snapshotDate);
      snapYear = d.getFullYear();
      snapMonth = d.getMonth() + 1;
    } else if (targetSnap.period) {
      const p = targetSnap.period;
      if (/^\d{6}$/.test(p)) { snapYear = parseInt(p.slice(0,4)); snapMonth = parseInt(p.slice(4,6)); }
      else if (/^\d{4}-\d{2}$/.test(p)) { snapYear = parseInt(p.slice(0,4)); snapMonth = parseInt(p.slice(5,7)); }
      else if (/^\d{8}$/.test(p)) { snapYear = parseInt(p.slice(0,4)); snapMonth = parseInt(p.slice(4,6)); }
    }
  }

  // Filter to selected month (or snapshot's latest month if no monthKey)
  const MONTH_NAMES3 = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const targetMonthStr = monthKey ?? `${snapYear}${String(snapMonth).padStart(2,"0")}`;
  // snapshotLabel: if monthKey provided, use that month; otherwise snapshot's latest month
  const labelMonth = monthKey ? parseInt(monthKey.slice(4,6)) : snapMonth;
  const labelYear  = monthKey ? parseInt(monthKey.slice(0,4)) : snapYear;
  const labelSnapshot = `${MONTH_NAMES3[labelMonth]} ${labelYear}`;

  if (targetSnap) {
    const allActs = await db.select().from(salesActivityTable)
      .where(eq(salesActivityTable.importId, targetSnap.id));
    allNikActs = allActs.filter(a => a.nik === nik);

    // Deduplicate
    const seen = new Set<string>();
    allNikActs = allNikActs.filter(a => {
      const key = `${a.lopid ?? ""}|${a.activityEndDate ?? ""}|${a.label ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    allNikActs = [];
  }

  // Filter to target month only
  allNikActs = allNikActs.filter(a => {
    const d = a.activityEndDate;
    if (!d) return false;
    return d.replace(/-/g, "").slice(0, 6) === targetMonthStr;
  });

  const validActs = allNikActs.filter(a => a.label && !a.label.toLowerCase().includes("tanpa"));
  const denganPelanggan = allNikActs.filter(a => a.label?.toLowerCase().includes("pelanggan") && !a.label?.toLowerCase().includes("proyek")).length;
  const denganProyek = allNikActs.filter(a => a.label?.toLowerCase().includes("proyek")).length;
  const kpiTarget = am.kpiActivity ?? 25;
  const validCount = validActs.length;
  const kpiPercent = kpiTarget > 0 ? Math.min(Math.round((validCount / kpiTarget) * 100), 100) : 0;

  const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const divider = `━━━━━━━━━━━━━━━━━━`;

  const fmtDate = (dateStr: string | null) => {
    if (!dateStr) return "-- ---";
    const parts = dateStr.split("-");
    if (parts.length < 3) return dateStr.slice(0, 10);
    const d = parseInt(parts[2], 10);
    const m = parseInt(parts[1], 10);
    return `${d} ${MONTH_SHORT[m] ?? "???"}`;
  };

  const kpiBar = (pct: number) => {
    const filled = Math.round(pct / 10);
    return `▓`.repeat(filled) + `░`.repeat(10 - filled);
  };

  const amFirstName = am.nama.split(" ")[0];
  const kpiStatus = kpiPercent >= 100 ? "✅ *Tercapai!*"
    : kpiPercent >= 70 ? "⚡ *Mendekati target*"
    : `📌 *${kpiTarget - validCount} aktivitas lagi*`;

  // ── SUMMARY MESSAGE ──────────────────────────────────────────────
  const summary =
    `📅 *SALES ACTIVITY — LESA VI*\n` +
    `${divider}\n` +
    `👤 *${am.nama}*\n` +
    `📆 Periode : *${labelSnapshot}*\n` +
    `${divider}\n` +
    `📊 *RINGKASAN AKTIVITAS*\n\n` +
    `├ 📋 Total      : *${allNikActs.length}* aktivitas\n` +
    `├ 👤 Pelanggan  : *${denganPelanggan}*\n` +
    `├ 📁 Proyek     : *${denganProyek}*\n` +
    `└ 🎯 KPI        : *${validCount}/${kpiTarget}* (*${kpiPercent}%*)\n\n` +
    `${kpiBar(kpiPercent)} *${kpiPercent}%* — ${kpiStatus}\n` +
    `${divider}`;

  // ── DETAIL PAGES ─────────────────────────────────────────────────
  // Sort by date descending
  const sorted = [...allNikActs].sort((a, b) => {
    const da = a.activityEndDate ?? ""; const db2 = b.activityEndDate ?? "";
    return db2 < da ? -1 : db2 > da ? 1 : 0;
  });

  const CHUNK_SIZE = 8;
  const chunks: typeof sorted[] = [];
  for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
    chunks.push(sorted.slice(i, i + CHUNK_SIZE));
  }

  const details: string[] = [];
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const baseIdx = c * CHUNK_SIZE;

    let partMsg = `📋 *DETAIL AKTIVITAS*\n`;

    for (let i = 0; i < chunk.length; i++) {
      const a = chunk[i];
      const num = baseIdx + i + 1;
      const dateStr = fmtDate(a.activityEndDate);
      const customer = a.caName?.toUpperCase() ?? a.picName?.toUpperCase() ?? "—";
      const notes = a.activityNotes?.split("\n")[0].trim() ?? "—";
      const kategori = a.activityType ?? a.label ?? "—";
      const shortNotes = notes.length > 65 ? notes.slice(0, 62) + "..." : notes;
      const isProyek = a.label?.toLowerCase().includes("proyek");
      const labelBadge = isProyek ? "📁 *Dg Proyek*" : "👤 *Dg Pelanggan*";

      partMsg += `──────────────────\n`;
      partMsg += `*#${num} · ${dateStr}*\n`;
      partMsg += `🏢 *${customer}*\n`;
      partMsg += `${shortNotes}\n`;
      partMsg += `📌 *${kategori}*  ${labelBadge}\n`;
      partMsg += `\n`;
    }

    // Footer per page
    partMsg += `──────────────────\n`;
    if (chunks.length > 1) {
      partMsg += `_Halaman ${c + 1}/${chunks.length} · ${allNikActs.length} aktivitas_`;
    }

    details.push(partMsg);
  }

  return {
    summary,
    details,
    amFirstName,
    totalPages: chunks.length,
    totalActivities: allNikActs.length,
    validCount,
    kpiTarget,
    kpiPercent,
    snapshotLabel: labelSnapshot,
    nik,
  };
}

// kept for backwards compat — delegates to buildActivityReport
async function buildActivityMessage(nik: string, _period: string): Promise<string[]> {
  const report = await buildActivityReport(nik);
  if (!report) return [];
  return [report.summary, ...report.details];
}

// --- PUBLIC API ---

export async function buildTelegramMessages(
  nik: string,
  period: string,
  options: { includePerformance: boolean; includeFunnel: boolean; includeActivity: boolean }
): Promise<string[]> {
  const messages: string[] = [];

  if (options.includePerformance) {
    const m = await buildPerformanceMessage(nik, period);
    if (m) messages.push(m);
  }

  if (options.includeFunnel) {
    const m = await buildFunnelMessage(nik);
    if (m) messages.push(m);
  }

  if (options.includeActivity) {
    const msgs = await buildActivityMessage(nik, period);
    messages.push(...msgs);
  }

  return messages;
}

/** @deprecated Use buildTelegramMessages (returns array) instead */
export async function buildTelegramMessage(
  nik: string,
  period: string,
  options: { includePerformance: boolean; includeFunnel: boolean; includeActivity: boolean }
): Promise<string> {
  const msgs = await buildTelegramMessages(nik, period, options);
  return msgs.join("\n\n");
}

export async function sendToTelegram(
  botToken: string,
  chatId: string,
  message: string,
  replyMarkup?: object
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: Record<string, unknown> = { chat_id: chatId, text: message, parse_mode: "Markdown" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const data = await response.json() as { description?: string };
    logger.error({ status: response.status, chatId, error: data.description }, "sendToTelegram failed");
    throw new Error(data.description || "Telegram API error");
  }
}

export async function sendToTelegramHtml(
  botToken: string,
  chatId: string,
  message: string,
  replyMarkup?: object
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: Record<string, unknown> = { chat_id: chatId, text: message, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json() as { description?: string };
    throw new Error(data.description || "Telegram API error");
  }
}

export async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => {});
}

export { greetingByTime };

export async function sendReminderToAllAMs(
  period: string,
  options: { includePerformance: boolean; includeFunnel: boolean; includeActivity: boolean },
  targetNiks?: string[]
): Promise<{ sent: number; failed: number; skipped: number; details: { nik: string; namaAm: string; status: string; error?: string }[] }> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) {
    return { sent: 0, failed: 0, skipped: 0, details: [] };
  }

  let ams = await db.select().from(accountManagersTable);
  if (targetNiks && targetNiks.length > 0) {
    ams = ams.filter(a => targetNiks.includes(a.nik));
  }

  let sent = 0, failed = 0, skipped = 0;
  const details: { nik: string; namaAm: string; status: string; error?: string }[] = [];

  for (const am of ams) {
    if (!am.telegramChatId) {
      skipped++;
      details.push({ nik: am.nik, namaAm: am.nama, status: "skipped" });
      continue;
    }

    try {
      // Build all messages for this AM — each type is a SEPARATE message
      const messages = await buildTelegramMessages(am.nik, period, options);
      if (!messages.length) {
        skipped++;
        details.push({ nik: am.nik, namaAm: am.nama, status: "skipped" });
        continue;
      }

      // Send each message individually with a small delay to avoid flood limits
      for (let i = 0; i < messages.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 500));
        await sendToTelegram(settings.telegramBotToken!, am.telegramChatId, messages[i]);
      }

      sent++;
      details.push({ nik: am.nik, namaAm: am.nama, status: "sent" });

      await db.insert(telegramLogsTable).values({
        nik: am.nik, namaAm: am.nama, telegramChatId: am.telegramChatId,
        status: "sent", period, messageType: "reminder",
      });
    } catch (error) {
      failed++;
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      details.push({ nik: am.nik, namaAm: am.nama, status: "failed", error: errMsg });

      await db.insert(telegramLogsTable).values({
        nik: am.nik, namaAm: am.nama, telegramChatId: am.telegramChatId || null,
        status: "failed", period, messageType: "reminder", error: errMsg,
      });

      logger.error({ nik: am.nik, error: errMsg }, "Failed to send Telegram message");
    }
  }

  return { sent, failed, skipped, details };
}
