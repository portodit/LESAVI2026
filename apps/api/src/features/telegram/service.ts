import { db, appSettingsTable, accountManagersTable, performanceDataTable, salesFunnelTable, salesActivityTable, telegramLogsTable, dataImportsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../../shared/logger";
import { getPublicBaseUrl } from "../../shared/publicUrl";

const MONTH_NAMES = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function formatSnapshotDate(snapshotDate: string | null | undefined, period: string | null | undefined, fallback: string = "-"): string {
  const raw = snapshotDate || period || "";
  if (!raw) return fallback;
  if (raw.length === 10) {
    const [y, m, d] = raw.split("-").map(Number);
    if (y && m && d) return `${d} ${MONTH_NAMES[m] || m} ${y}`;
  }
  if (raw.length === 7) {
    const [y, m] = raw.split("-").map(Number);
    if (y && m) return `${MONTH_NAMES[m] || m} ${y}`;
  }
  return raw;
}

// ── Snapshot-aware helpers ──────────────────────────────────────────────────

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

  return db.select().from(performanceDataTable)
    .where(and(eq(performanceDataTable.tahun, year), eq(performanceDataTable.bulan, month)));
}

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

function greetingByTime(): string {
  const hourWib = (new Date().getUTCHours() + 7) % 24;
  if (hourWib >= 3 && hourWib < 11) return "Selamat pagi";
  if (hourWib >= 11 && hourWib < 15) return "Selamat siang";
  if (hourWib >= 15 && hourWib < 18) return "Selamat sore";
  return "Selamat malam";
}

function fmtRev(val: number): string {
  if (val >= 1_000_000_000) return `Rp ${(val / 1_000_000_000).toFixed(2).replace(".", ",")} Miliar`;
  if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(2).replace(".", ",")} Juta`;
  if (val >= 1_000) return `Rp ${(val / 1_000).toFixed(0)} Ribu`;
  if (val === 0) return `Rp 0`;
  return `Rp ${val.toLocaleString("id-ID")}`;
}

function achStatus(ach: number): string {
  if (ach >= 100) return "🟢 <b>Melewati Target</b>";
  if (ach >= 80) return "🟡 <b>Mendekati Target</b>";
  if (ach > 0) return "🟠 <b>Perlu Peningkatan</b>";
  return "🔴 <b>Belum Ada Revenue</b>";
}

function buildFeedback(firstName: string, achCm: number, achYtd: number, monthName: string): string {
  const cmLow = achCm < 80;
  const ytdLow = achYtd < 80;

  if (cmLow && ytdLow) {
    return `💪 Semangat kak <b>${firstName}</b>! Performa <b>${monthName}</b> masih butuh peningkatan — capaian bulan berjalan masih di bawah target. Fokuskan pada aktivitas customer, pipeline, dan peluang closing. Koordinasikan kebutuhan support dengan tim ya 🙏`;
  }
  if (cmLow && !ytdLow) {
    return `🔥 Tetap semangat kak <b>${firstName}</b>! Capaian <b>${monthName}</b> masih perlu ditingkatkan, namun secara akumulasi YTD performansi masih positif. Fokus jaga momentum dan kejar target bulan berjalan 💪`;
  }
  if (!cmLow && ytdLow) {
    return `🚀 Progress bagus kak <b>${firstName}</b>! Performa <b>${monthName}</b> sudah menunjukkan peningkatan. Pertahankan tren positif ini agar bisa mengejar gap pencapaian YTD 🙏`;
  }
  return `🎉 Mantap kak <b>${firstName}</b>! Performa <b>${monthName}</b> berhasil mencapai target, dan capaian YTD juga menunjukkan performansi yang kuat. Pertahankan konsistensi dan optimalkan peluang revenue berikutnya 💪`;
}

function getEmbedUrl(importId?: number): string {
  const base = `${getPublicBaseUrl()}/presentation`;
  if (importId) return `${base}?type=performance&id=${importId}`;
  return base;
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
): Promise<{ parts: string[]; keyboard: object } | null> {
  const [year, month] = period.split("-").map(Number);

  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, nik));
  if (!am) return null;

  const firstName = am.nama.split(" ")[0];
  const monthName = MONTH_NAMES[month] || String(month);

  // Get active AM NIKs (same rule as dashboard: ACCOUNT_MANAGER or AM, aktif=true)
  const allAms = await db.select().from(accountManagersTable);
  const activeNikSet = new Set(
    allAms
      .filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || "") && m.nik)
      .map(m => m.nik)
  );

  const allPerfs = await getSnapshotAwarePerfs(year, month);
  // Only include active AMs
  const activePerfs = allPerfs.filter(p => activeNikSet.has(p.nik));

  // Deduplicate: keep one entry per NIK (the one with highest achRate)
  const byNik = new Map<string, typeof activePerfs[0]>();
  for (const p of activePerfs) {
    const existing = byNik.get(p.nik);
    if (!existing || (parseFloat(String(p.achRate ?? 0)) > parseFloat(String(existing.achRate ?? 0)))) {
      byNik.set(p.nik, p);
    }
  }
  const uniquePerfs = [...byNik.values()];

  const p = uniquePerfs.find(x => x.nik === nik);
  // Rank relative to unique active AMs who have perf data
  const totalAMs = uniquePerfs.length;

  const sortedByCm = [...uniquePerfs].sort((a, b) =>
    (parseFloat(String(b.achRate ?? 0)) - parseFloat(String(a.achRate ?? 0))));
  const rankCm = sortedByCm.findIndex(x => x.nik === nik) + 1;
  const sortedByYtd = [...uniquePerfs].sort((a, b) =>
    (parseFloat(String(b.achRateYtd ?? 0)) - parseFloat(String(a.achRateYtd ?? 0))));
  const rankYtd = sortedByYtd.findIndex(x => x.nik === nik) + 1;

  const ytdPerfs = await db.select().from(performanceDataTable)
    .where(and(eq(performanceDataTable.nik, nik), eq(performanceDataTable.tahun, year)));
  const ytdUpTo = ytdPerfs.filter(x => x.bulan <= month);

  const fmtNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

  const realRegulerCm = fmtNum(p?.realReguler);
  const targetRegulerCm = fmtNum(p?.targetReguler);
  const realRegulerYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realReguler), 0);
  const targetRegulerYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetReguler), 0);

  const realSustainCm = fmtNum(p?.realSustain);
  const targetSustainCm = fmtNum(p?.targetSustain);
  const realSustainYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realSustain), 0);
  const targetSustainYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetSustain), 0);

  const realScalingCm = fmtNum(p?.realScaling);
  const targetScalingCm = fmtNum(p?.targetScaling);
  const realScalingYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realScaling), 0);
  const targetScalingYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetScaling), 0);

  const realNgtmaCm = fmtNum(p?.realNgtma);
  const targetNgtmaCm = fmtNum(p?.targetNgtma);
  const realNgtmaYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realNgtma), 0);
  const targetNgtmaYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetNgtma), 0);

  const achRegulerCm = targetRegulerCm > 0 ? (realRegulerCm / targetRegulerCm) * 100 : 0;
  const achRegulerYtd = targetRegulerYtd > 0 ? (realRegulerYtd / targetRegulerYtd) * 100 : 0;
  const achSustainCm = targetSustainCm > 0 ? (realSustainCm / targetSustainCm) * 100 : 0;
  const achSustainYtd = targetSustainYtd > 0 ? (realSustainYtd / targetSustainYtd) * 100 : 0;
  const achScalingCm = targetScalingCm > 0 ? (realScalingCm / targetScalingCm) * 100 : 0;
  const achScalingYtd = targetScalingYtd > 0 ? (realScalingYtd / targetScalingYtd) * 100 : 0;
  const achNgtmaCm = targetNgtmaCm > 0 ? (realNgtmaCm / targetNgtmaCm) * 100 : 0;
  const achNgtmaYtd = targetNgtmaYtd > 0 ? (realNgtmaYtd / targetNgtmaYtd) * 100 : 0;

  const totalRealCm = realRegulerCm + realSustainCm + realScalingCm + realNgtmaCm;
  const totalTargetCm = targetRegulerCm + targetSustainCm + targetScalingCm + targetNgtmaCm;
  const achTotalCm = totalTargetCm > 0 ? (totalRealCm / totalTargetCm) * 100 : 0;
  const totalRealYtd = realRegulerYtd + realSustainYtd + realScalingYtd + realNgtmaYtd;
  const totalTargetYtd = targetRegulerYtd + targetSustainYtd + targetScalingYtd + targetNgtmaYtd;
  const achTotalYtd = totalTargetYtd > 0 ? (totalRealYtd / totalTargetYtd) * 100 : 0;

  const [latestImport] = await db.select().from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(1);
  const snapDate = formatSnapshotDate(latestImport?.snapshotDate ?? null, latestImport?.period ?? null, "-");

  const noRealData = !p || (totalRealCm === 0 && totalRealYtd === 0);
  const feedback = noRealData ? null : buildFeedback(firstName, achTotalCm, achTotalYtd, monthName);

  // ── Part 1: Header + Section A, B, C, D ──────────────────────────────────
  let part1 = `<b>📊 LAPORAN PERFORMANSI ACCOUNT MANAGER</b>\n`;
  part1 += `<b>LESA VI — Witel Suramadu</b>\n\n`;
  part1 += `Halo kak <b>${firstName}</b>! 👋\n\n`;
  part1 += `Berikut rekap performansi kamu berdasarkan:\n\n`;
  part1 += `📸 <b>Snapshot:</b> ${snapDate}\n`;
  part1 += `📅 <b>Periode Current Month:</b> ${monthName} ${year}\n`;
  part1 += `📊 <b>Periode YTD:</b> Januari - ${monthName} ${year}\n\n`;

  part1 += `━━━━━━━━━━━━━━━━━━\n`;
  part1 += `<b>📌 A. REGULER REVENUE</b>\n`;
  part1 += `━━━━━━━━━━━━━━━━━━\n\n`;
  part1 += `<b>📅 Current Month (${monthName})</b>\n`;
  part1 += `├ Real Revenue   : <b>${fmtRev(realRegulerCm)}</b>\n`;
  part1 += `├ Target Revenue : <b>${fmtRev(targetRegulerCm)}</b>\n`;
  part1 += `├ Ach CM         : <b>${fmtPct(achRegulerCm)}</b>\n`;
  part1 += `└ Status         : ${achStatus(achRegulerCm)}\n\n`;
  part1 += `<b>📊 Year To Date (Jan - ${monthName})</b>\n`;
  part1 += `├ Real Revenue   : <b>${fmtRev(realRegulerYtd)}</b>\n`;
  part1 += `├ Target Revenue : <b>${fmtRev(targetRegulerYtd)}</b>\n`;
  part1 += `├ Ach YTD        : <b>${fmtPct(achRegulerYtd)}</b>\n`;
  part1 += `└ Status         : ${achStatus(achRegulerYtd)}\n\n`;

  part1 += `━━━━━━━━━━━━━━━━━━\n`;
  part1 += `<b>📌 B. SUSTAIN REVENUE</b>\n`;
  part1 += `━━━━━━━━━━━━━━━━━━\n\n`;
  part1 += `<b>📅 Current Month (${monthName})</b>\n`;
  part1 += `├ Real Revenue    : <b>${fmtRev(realSustainCm)}</b>\n`;
  part1 += `├ Target Sustain  : <b>${fmtRev(targetSustainCm)}</b>\n`;
  part1 += `├ Ach CM          : <b>${fmtPct(achSustainCm)}</b>\n`;
  part1 += `└ Status          : ${achStatus(achSustainCm)}\n\n`;
  part1 += `<b>📊 Year To Date (Jan - ${monthName})</b>\n`;
  part1 += `├ Real Revenue    : <b>${fmtRev(realSustainYtd)}</b>\n`;
  part1 += `├ Target Sustain  : <b>${fmtRev(targetSustainYtd)}</b>\n`;
  part1 += `├ Ach YTD         : <b>${fmtPct(achSustainYtd)}</b>\n`;
  part1 += `└ Status          : ${achStatus(achSustainYtd)}\n\n`;

  part1 += `━━━━━━━━━━━━━━━━━━\n`;
  part1 += `<b>📌 C. SCALING REVENUE</b>\n`;
  part1 += `━━━━━━━━━━━━━━━━━━\n\n`;
  part1 += `<b>📅 Current Month (${monthName})</b>\n`;
  part1 += `├ Real Revenue    : <b>${fmtRev(realScalingCm)}</b>\n`;
  part1 += `├ Target Scaling  : <b>${fmtRev(targetScalingCm)}</b>\n`;
  part1 += `├ Ach CM          : <b>${fmtPct(achScalingCm)}</b>\n`;
  part1 += `└ Status          : ${achStatus(achScalingCm)}\n\n`;
  part1 += `<b>📊 Year To Date (Jan - ${monthName})</b>\n`;
  part1 += `├ Real Revenue    : <b>${fmtRev(realScalingYtd)}</b>\n`;
  part1 += `├ Target Scaling  : <b>${fmtRev(targetScalingYtd)}</b>\n`;
  part1 += `├ Ach YTD         : <b>${fmtPct(achScalingYtd)}</b>\n`;
  part1 += `└ Status          : ${achStatus(achScalingYtd)}\n\n`;

  part1 += `━━━━━━━━━━━━━━━━━━\n`;
  part1 += `<b>📌 D. NGTMA REVENUE</b>\n`;
  part1 += `━━━━━━━━━━━━━━━━━━\n\n`;
  part1 += `<b>📅 Current Month (${monthName})</b>\n`;
  part1 += `├ Real Revenue    : <b>${fmtRev(realNgtmaCm)}</b>\n`;
  part1 += `├ Target NGTMA    : <b>${fmtRev(targetNgtmaCm)}</b>\n`;
  part1 += `├ Ach CM          : <b>${fmtPct(achNgtmaCm)}</b>\n`;
  part1 += `└ Status          : ${achStatus(achNgtmaCm)}\n\n`;
  part1 += `<b>📊 Year To Date (Jan - ${monthName})</b>\n`;
  part1 += `├ Real Revenue    : <b>${fmtRev(realNgtmaYtd)}</b>\n`;
  part1 += `├ Target NGTMA    : <b>${fmtRev(targetNgtmaYtd)}</b>\n`;
  part1 += `├ Ach YTD         : <b>${fmtPct(achNgtmaYtd)}</b>\n`;
  part1 += `└ Status          : ${achStatus(achNgtmaYtd)}`;

  // ── Part 2: Ringkasan + Feedback ─────────────────────────────────────────
  let part2 = `━━━━━━━━━━━━━━━━━━\n`;
  part2 += `<b>📈 RINGKASAN PERFORMANSI</b>\n`;
  part2 += `━━━━━━━━━━━━━━━━━━\n\n`;
  part2 += `<b>① Current Month — ${monthName} ${year}</b>\n`;
  part2 += `Capaian: <b>${fmtPct(achTotalCm)}</b> · Ranking: <b>#${rankCm}</b> dari <b>${totalAMs} AM</b>\n\n`;
  part2 += `<b>② Year To Date — Januari s/d ${monthName} ${year}</b>\n`;
  part2 += `Capaian: <b>${fmtPct(achTotalYtd)}</b> · Ranking: <b>#${rankYtd}</b> dari <b>${totalAMs} AM</b>\n\n`;

  part2 += `━━━━━━━━━━━━━━━━━━\n`;
  part2 += `<b>💬 FEEDBACK PERFORMANSI</b>\n`;
  part2 += `━━━━━━━━━━━━━━━━━━\n\n`;
  if (noRealData) {
    part2 += `Mohon maaf kak, data revenue untuk periode ini belum tercatat di sistem. Mohon menunggu info update terkait performa bulan ini ya — kami akan segera menginformasikan jika data sudah tersedia. 🙏`;
  } else {
    part2 += feedback ?? "";
  }

  const embedUrl = getEmbedUrl(latestImport?.id);
  const keyboard = {
    inline_keyboard: [
      [{ text: "🔄 Pilih Bulan", callback_data: "perf:menu" }],
      [{ text: "🏆 Papan Peringkat", callback_data: "perf:peringkat" }],
      [{ text: "📎 Lihat Dashboard", callback_data: "perf:dashboard" }],
      [{ text: "🏠 Kembali ke Menu", callback_data: "nav:main" }],
    ],
  };

  return { parts: [part1, part2], keyboard };
}

async function buildFunnelMessage(nik: string): Promise<string | null> {
  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, nik));
  if (!am) return null;

  const funnelImportsRaw = await db.select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(10);

  if (funnelImportsRaw.length === 0) return null;

  const funnelImports = [...funnelImportsRaw].sort((a, b) => {
    const aDate = a.snapshotDate;
    const bDate = b.snapshotDate;
    if (!aDate && !bDate) return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    if (!aDate) return -1;
    if (!bDate) return 1;
    if (bDate > aDate) return 1;
    if (aDate > bDate) return -1;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });

  const latestImport = funnelImports[0];
  const prevImport = funnelImports.length >= 2 ? funnelImports[1] : null;

  const relevantImportIds = [latestImport.id, ...(prevImport ? [prevImport.id] : [])];
  const allLopsRaw = await db.select().from(salesFunnelTable).where(eq(salesFunnelTable.nikAm, nik));

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

  if (msg.length > 4000) {
    const footer = `\n\n_[Pesan terpotong] Detail lengkap:\n${getFunnelDetailUrl()}_`;
    msg = msg.slice(0, 4000 - footer.length) + footer;
  }

  return msg;
}

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

  const [targetSnap] = await db.select().from(dataImportsTable)
    .where(eq(dataImportsTable.type, "activity"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(1);

  let allNikActs: typeof salesActivityTable.$inferSelect[] = [];

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

  const MONTH_NAMES3 = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const targetMonthStr = monthKey ?? `${snapYear}${String(snapMonth).padStart(2,"0")}`;
  const labelMonth = monthKey ? parseInt(monthKey.slice(4,6)) : snapMonth;
  const labelYear  = monthKey ? parseInt(monthKey.slice(0,4)) : snapYear;
  const labelSnapshot = `${MONTH_NAMES3[labelMonth]} ${labelYear}`;

  if (targetSnap) {
    const allActs = await db.select().from(salesActivityTable)
      .where(eq(salesActivityTable.importId, targetSnap.id));
    allNikActs = allActs.filter(a => a.nik === nik);

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

  const summary =
    `📅 *SALES ACTIVITY — LESA VI*\n` +
    `${divider}\n` +
    `👤 *${am.nama}*\n` +
    `📆 Periode : *${labelSnapshot}*\n` +
    `📦 Snapshot: *#${targetSnap?.id ?? "?"}*\n` +
    `${divider}\n` +
    `📊 *RINGKASAN AKTIVITAS*\n\n` +
    `├ 📋 Total      : *${allNikActs.length}* aktivitas\n` +
    `├ 👤 Pelanggan  : *${denganPelanggan}*\n` +
    `├ 📁 Proyek     : *${denganProyek}*\n` +
    `└ 🎯 KPI        : *${validCount}/${kpiTarget}* (*${kpiPercent}%*)\n\n` +
    `${kpiBar(kpiPercent)} *${kpiPercent}%* — ${kpiStatus}\n` +
    `${divider}`;

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
): Promise<{ messages: string[]; perfKeyboard?: object }> {
  const messages: string[] = [];
  let perfKeyboard: object | undefined;

  if (options.includePerformance) {
    const result = await buildPerformanceMessage(nik, period);
    if (result) {
      messages.push(...result.parts);
      perfKeyboard = result.keyboard;
    }
  }

  if (options.includeFunnel) {
    const m = await buildFunnelMessage(nik);
    if (m) messages.push(m);
  }

  if (options.includeActivity) {
    const msgs = await buildActivityMessage(nik, period);
    messages.push(...msgs);
  }

  return { messages, perfKeyboard };
}

/** @deprecated Use buildTelegramMessages (returns {messages, perfKeyboard}) instead */
export async function buildTelegramMessage(
  nik: string,
  period: string,
  options: { includePerformance: boolean; includeFunnel: boolean; includeActivity: boolean }
): Promise<string> {
  const result = await buildTelegramMessages(nik, period, options);
  return result.messages.join("\n\n");
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
      const { messages, perfKeyboard } = await buildTelegramMessages(am.nik, period, options);
      if (!messages.length) {
        skipped++;
        details.push({ nik: am.nik, namaAm: am.nama, status: "skipped" });
        continue;
      }

      for (let i = 0; i < messages.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 500));
        await sendToTelegramHtml(settings.telegramBotToken!, am.telegramChatId, messages[i]);
      }

      if (perfKeyboard) {
        await new Promise(r => setTimeout(r, 500));
        const firstName = am.nama.split(" ")[0];
        await sendToTelegramHtml(
          settings.telegramBotToken!, am.telegramChatId,
          `Mau apa lagi kak <b>${firstName}</b>? 😊`, perfKeyboard
        );
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
