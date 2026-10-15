import { db, appSettingsTable, accountManagersTable, performanceDataTable, salesFunnelTable, salesActivityTable, telegramLogsTable, dataImportsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../../shared/logger";
import { getPublicBaseUrlSafe, toHttpsUrl, isLocalUrl } from "../../shared/publicUrl";
import {
  type PerfAnnouncementCtx,
  renderPerfAnnouncement,
  formatSnapshotNameId,
  getGreetingWIB,
} from "./announcementTemplates";

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

interface SnapshotPerfResult {
  rows: typeof performanceDataTable.$inferSelect[];
  importId: number | null;
}

export async function getLatestSnapshotId(): Promise<number | null> {
  const [snap] = await db.select({ id: dataImportsTable.id })
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.id))
    .limit(1);
  return snap?.id ?? null;
}

async function getSnapshotAwarePerfs(snapshotId: number, year: number, month: number): Promise<SnapshotPerfResult> {
  const rows = await db.select().from(performanceDataTable)
    .where(and(
      eq(performanceDataTable.importId, snapshotId),
      eq(performanceDataTable.tahun, year),
      eq(performanceDataTable.bulan, month),
    ));
  return { rows, importId: snapshotId };
}

export async function getAvailablePerfPeriods(nik: string): Promise<{ tahun: number; bulan: number }[]> {
  const rows = await db.selectDistinct({
    tahun: performanceDataTable.tahun,
    bulan: performanceDataTable.bulan,
  }).from(performanceDataTable)
    .where(and(
      eq(performanceDataTable.nik, nik),
      sql`(${performanceDataTable.realReguler} > 0 OR ${performanceDataTable.realSustain} > 0 OR ${performanceDataTable.realScaling} > 0)`,
    ));
  return rows.sort((a, b) => b.tahun !== a.tahun ? b.tahun - a.tahun : b.bulan - a.bulan);
}

export async function getAvailablePerfPeriodsAll(): Promise<{ tahun: number; bulan: number }[]> {
  const rows = await db.selectDistinct({
    tahun: performanceDataTable.tahun,
    bulan: performanceDataTable.bulan,
  }).from(performanceDataTable)
    .where(sql`(${performanceDataTable.realReguler} > 0 OR ${performanceDataTable.realSustain} > 0 OR ${performanceDataTable.realScaling} > 0)`);
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
  const base = getPublicBaseUrlSafe();
  if (importId) return `${base}/presentation?type=performance&id=${importId}`;
  return `${base}/presentation`;
}

function getFunnelDetailUrl(): string {
  return `${getPublicBaseUrlSafe()}/visualisasi/funnel`;
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
  options: { autoFallback?: boolean } = {},
): Promise<{ parts: string[]; keyboard: object } | null> {
  // Period may come in as "YYYY-MM" (2026-08) or "YYYYMM" (202608)
  const parsedYear = period.length === 6
    ? Number(period.slice(0, 4))
    : Number(period.split("-")[0]);

  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, nik));
  if (!am) return null;

  const firstName = am.nama.split(" ")[0];

  // Get active AM NIKs (same rule as dashboard: ACCOUNT_MANAGER or AM, aktif=true)
  const allAms = await db.select().from(accountManagersTable);
  const activeNikSet = new Set(
    allAms
      .filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || "") && m.nik)
      .map(m => m.nik)
  );

  // ── Auto-fallback: when autoFallback is on (Laporan Terkini, current month),
  //    we lock onto the LATEST snapshot, then walk back to find the latest month
  //    in THAT snapshot that has real revenue. This is the "bulan terkini yang ada
  //    data lengkapnya" — the most recent month in the latest snapshot.
  const snapshotId = await getLatestSnapshotId();

  let [year, month] = parsedYear > 2000
    ? [parsedYear, Number(period.length === 6 ? period.slice(4, 6) : period.split("-")[1])]
    : [parsedYear, Number(period.slice(4, 6))];

  if (options.autoFallback && snapshotId) {
    // Walk back within the latest snapshot to find month with real revenue
    for (let step = 0; step < 12; step++) {
      const { rows: probePerfs } = await getSnapshotAwarePerfs(snapshotId, year, month);
      const probeByNik = new Map<string, typeof probePerfs[0]>();
      for (const x of probePerfs) {
        if (!activeNikSet.has(x.nik)) continue;
        const existing = probeByNik.get(x.nik);
        if (!existing || parseFloat(String(x.achRate ?? 0)) > parseFloat(String(existing.achRate ?? 0))) {
          probeByNik.set(x.nik, x);
        }
      }
      const probeRow = probeByNik.get(nik);
      const probeTotalReal =
        parseFloat(String(probeRow?.realReguler ?? 0)) +
        parseFloat(String(probeRow?.realSustain ?? 0)) +
        parseFloat(String(probeRow?.realScaling ?? 0)) +
        parseFloat(String(probeRow?.realNgtma ?? 0));
      if (probeTotalReal > 0) break;
      month--;
      if (month === 0) { month = 12; year--; }
    }
  }

  const monthName = MONTH_NAMES[month] || String(month);

  // CM: query from the locked snapshot for (year, month)
  const { rows: allPerfs } = snapshotId
    ? await getSnapshotAwarePerfs(snapshotId, year, month)
    : ({ rows: [], importId: null } as SnapshotPerfResult);

  // Aggregate all rows per NIK to get AM-level sums (same as dashboard).
  // Each NIK can have multiple customer rows; we SUM all of them to get the
  // true AM-level real/target/achievement — NOT pick one customer row.
  const fmtNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
  const byNik = new Map<string, {
    nik: string;
    realReguler: number; targetReguler: number;
    realSustain: number; targetSustain: number;
    realScaling: number; targetScaling: number;
    realNgtma: number; targetNgtma: number;
  }>();
  for (const p of allPerfs) {
    if (!activeNikSet.has(p.nik)) continue;
    const cur = byNik.get(p.nik) ?? {
      nik: p.nik,
      realReguler: 0, targetReguler: 0,
      realSustain: 0, targetSustain: 0,
      realScaling: 0, targetScaling: 0,
      realNgtma: 0, targetNgtma: 0,
    };
    byNik.set(p.nik, {
      nik: p.nik,
      realReguler: cur.realReguler + fmtNum(p.realReguler),
      targetReguler: cur.targetReguler + fmtNum(p.targetReguler),
      realSustain: cur.realSustain + fmtNum(p.realSustain),
      targetSustain: cur.targetSustain + fmtNum(p.targetSustain),
      realScaling: cur.realScaling + fmtNum(p.realScaling),
      targetScaling: cur.targetScaling + fmtNum(p.targetScaling),
      realNgtma: cur.realNgtma + fmtNum(p.realNgtma),
      targetNgtma: cur.targetNgtma + fmtNum(p.targetNgtma),
    });
  }

  const amList = [...byNik.values()].filter(a =>
    (a.realReguler + a.realSustain + a.realScaling + a.realNgtma) > 0
    || (a.targetReguler + a.targetSustain + a.targetScaling + a.targetNgtma) > 0
  );
  const totalAMs = amList.length;

  const myAm = byNik.get(nik);
  if (!myAm) return null;

  // Rank CM: by Reguler achievement only (matching dashboard /am-rank default "Reguler")
  const computeAch = (real: number, target: number) => target > 0 ? (real / target) * 100 : 0;
  const sortedByCm = [...amList].sort((a, b) => {
    const achA = computeAch(a.realReguler, a.targetReguler);
    const achB = computeAch(b.realReguler, b.targetReguler);
    return achB - achA;
  });
  const rankCm = sortedByCm.findIndex(a => a.nik === nik) + 1;

  // YTD: query all months Jan→month from the same snapshot for this AM
  const ytdPerfs = snapshotId
    ? await db.select().from(performanceDataTable)
        .where(and(
          eq(performanceDataTable.nik, nik),
          eq(performanceDataTable.tahun, year),
          eq(performanceDataTable.importId, snapshotId),
        ))
    : [];
  const ytdUpTo = ytdPerfs.filter(x => x.bulan <= month);

  // Aggregate YTD per-AM for ranking (include all active AMs, not just this one)
  const ytdByNik = new Map<string, { nik: string; realReguler: number; targetReguler: number; realSustain: number; targetSustain: number; realScaling: number; targetScaling: number; realNgtma: number; targetNgtma: number }>();
  for (const row of (snapshotId
    ? await db.select().from(performanceDataTable)
        .where(and(eq(performanceDataTable.importId, snapshotId), eq(performanceDataTable.tahun, year)))
    : [])) {
    if (!activeNikSet.has(row.nik)) continue;
    if (row.bulan > month) continue;
    const cur = ytdByNik.get(row.nik) ?? {
      nik: row.nik,
      realReguler: 0, targetReguler: 0,
      realSustain: 0, targetSustain: 0,
      realScaling: 0, targetScaling: 0,
      realNgtma: 0, targetNgtma: 0,
    };
    ytdByNik.set(row.nik, {
      nik: row.nik,
      realReguler: cur.realReguler + fmtNum(row.realReguler),
      targetReguler: cur.targetReguler + fmtNum(row.targetReguler),
      realSustain: cur.realSustain + fmtNum(row.realSustain),
      targetSustain: cur.targetSustain + fmtNum(row.targetSustain),
      realScaling: cur.realScaling + fmtNum(row.realScaling),
      targetScaling: cur.targetScaling + fmtNum(row.targetScaling),
      realNgtma: cur.realNgtma + fmtNum(row.realNgtma),
      targetNgtma: cur.targetNgtma + fmtNum(row.targetNgtma),
    });
  }
  // Rank YTD: by Reguler achievement only (matching dashboard /am-rank default "Reguler")
  const ytdList = [...ytdByNik.values()].filter(a =>
    a.realReguler > 0 || a.targetReguler > 0
  );
  const sortedByYtd = [...ytdList].sort((a, b) => {
    const achA = computeAch(a.realReguler, a.targetReguler);
    const achB = computeAch(b.realReguler, b.targetReguler);
    return achB - achA;
  });
  const rankYtd = sortedByYtd.findIndex(a => a.nik === nik) + 1;

  const realRegulerCm = myAm.realReguler;
  const targetRegulerCm = myAm.targetReguler;
  const realSustainCm = myAm.realSustain;
  const targetSustainCm = myAm.targetSustain;
  const realScalingCm = myAm.realScaling;
  const targetScalingCm = myAm.targetScaling;
  const realNgtmaCm = myAm.realNgtma;
  const targetNgtmaCm = myAm.targetNgtma;

  const realRegulerYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realReguler), 0);
  const targetRegulerYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetReguler), 0);
  const realSustainYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realSustain), 0);
  const targetSustainYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetSustain), 0);
  const realScalingYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.realScaling), 0);
  const targetScalingYtd = ytdUpTo.reduce((s, x) => s + fmtNum(x.targetScaling), 0);
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

  const [snapshotInfo] = snapshotId
    ? await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, snapshotId))
    : [];
  const snapDate = formatSnapshotDate(snapshotInfo?.snapshotDate ?? null, snapshotInfo?.period ?? null, "-");

  const noRealData = !myAm || (totalRealCm === 0 && totalRealYtd === 0);
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
  part2 += `Capaian: <b>${fmtPct(achRegulerCm)}</b> · Ranking: <b>#${rankCm}</b> dari <b>${totalAMs} AM</b>\n\n`;
  part2 += `<b>② Year To Date — Januari s/d ${monthName} ${year}</b>\n`;
  part2 += `Capaian: <b>${fmtPct(achRegulerYtd)}</b> · Ranking: <b>#${rankYtd}</b> dari <b>${totalAMs} AM</b>\n\n`;

  part2 += `━━━━━━━━━━━━━━━━━━\n`;
  part2 += `<b>💬 FEEDBACK PERFORMANSI</b>\n`;
  part2 += `━━━━━━━━━━━━━━━━━━\n\n`;
  if (noRealData) {
    part2 += `Mohon maaf kak, data revenue untuk periode ini belum tercatat di sistem. Mohon menunggu info update terkait performa bulan ini ya — kami akan segera menginformasikan jika data sudah tersedia. 🙏`;
  } else {
    part2 += feedback ?? "";
  }

  const embedUrl = getEmbedUrl(snapshotId ?? undefined);
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
  options: { includePerformance: boolean; includeFunnel: boolean; includeActivity: boolean; autoFallback?: boolean }
): Promise<{ messages: string[]; perfKeyboard?: object }> {
  const messages: string[] = [];
  let perfKeyboard: object | undefined;

  if (options.includePerformance) {
    const result = await buildPerformanceMessage(nik, period, { autoFallback: options.autoFallback });
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
  options: { includePerformance: boolean; includeFunnel: boolean; includeActivity: boolean; autoFallback?: boolean }
): Promise<string> {
  const result = await buildTelegramMessages(nik, period, options);
  return result.messages.join("\n\n");
}

async function fetchWith429Retry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), ...init });
    if (response.status !== 429) return response;
    const data = await response.json() as { parameters?: { retry_after?: number } };
    const waitSec = data.parameters?.retry_after ?? Math.pow(2, attempt);
    logger.warn({ attempt, waitSec, url }, "Telegram 429 rate limited — waiting before retry");
    await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
  }
  // Final attempt without retry-after
  return fetch(url, { signal: AbortSignal.timeout(15000), ...init });
}

export async function sendToTelegram(
  botToken: string,
  chatId: string,
  message: string,
  replyMarkup?: object
): Promise<number | null> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: Record<string, unknown> = { chat_id: chatId, text: message, parse_mode: "Markdown" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const response = await fetchWith429Retry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json() as { description?: string };
    logger.error({ status: response.status, chatId, error: data.description }, "sendToTelegram failed");
    throw new Error(data.description || "Telegram API error");
  }

  const data = await response.json() as { ok: boolean; result?: { message_id?: number } };
  return data.result?.message_id ?? null;
}

export async function sendPhotoToTelegram(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string,
  replyMarkup?: object
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    photo: photoUrl,
  };
  if (caption) {
    body.caption = caption;
    body.parse_mode = "Markdown";
  }
  if (replyMarkup) body.reply_markup = replyMarkup;
  const response = await fetchWith429Retry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json() as { description?: string };
    logger.error({ status: response.status, chatId, error: data.description }, "sendPhotoToTelegram failed");
  }
}

export async function editMessageText(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: object
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "Markdown",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const response = await fetchWith429Retry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json() as { description?: string };
    logger.error({ status: response.status, chatId, messageId, error: data.description }, "editMessageText failed");
  }
}

export async function answerCallbackQueryAndEdit(
  botToken: string,
  callbackId: string,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup?: object
): Promise<void> {
  await Promise.all([
    editMessageText(botToken, chatId, messageId, text, replyMarkup),
    answerCallbackQuery(botToken, callbackId),
  ]);
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
  const response = await fetchWith429Retry(url, {
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
  await fetchWith429Retry(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
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

      // Delay between different AMs to avoid rate limiting (Telegram limit ~30 msg/sec)
      await new Promise(r => setTimeout(r, 120));
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

// ── Performance Snapshot Notification (personalized per-AM) ─────────────────────

interface RankedAm {
  nik: string;
  namaAm: string;
  telegramChatId: string | null;
  /** Latest month (tahun, bulan) with real revenue in the snapshot. */
  periodYear: number;
  periodMonth: number;
  /** Reguler component current-month totals (used in CM highlight). */
  realReguler: number;
  targetReguler: number;
  achReguler: number;
  /** Aggregated current-month totals across all customers (kept for compatibility). */
  realRevenue: number;
  targetRevenue: number;
  achRate: number;
  /** Aggregated YTD totals (Jan..periodMonth, same year). */
  realRevenueYtd: number;
  targetRevenueYtd: number;
  achRateYtd: number;
  /** Reguler component YTD (used in the highlight). */
  ytdRegulerActual: number;
  ytdRegulerTarget: number;
  ytdRegulerAchPct: number;
  rankCm: number;
  rankYtd: number;
  /** Total AMs in the CM ranking (so the rank sentence says "dari N AM" correctly). */
  rankCmTotal: number;
  /** Total AMs in the YTD ranking. */
  rankYtdTotal: number;
}

function fmtNum(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}

const MONTH_NAMES_ID = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * Walk back inside a snapshot from the latest (tahun, bulan) until we find
 * a month that actually has revenue (any of realReguler/Sustain/Scaling/Ngtma
 * is > 0). Returns the (tahun, bulan) of that month, or 0/0 if the snapshot
 * has no revenue-bearing rows at all.
 *
 * Mirrors the autoFallback logic in buildPerformanceMessage so the
 * notification uses the same data period as the Laporan Terkini view.
 */
function resolveDataPeriod(rows: { tahun: number; bulan: number; realReguler: unknown; realSustain: unknown; realScaling: unknown; realNgtma: unknown }[]): { year: number; month: number } {
  let year = 0, month = 0;
  for (const r of rows) {
    if (r.tahun > year || (r.tahun === year && r.bulan > month)) {
      year = r.tahun;
      month = r.bulan;
    }
  }
  if (year === 0) return { year, month };

  for (let step = 0; step < 12; step++) {
    const totalAtMonth = rows.reduce((s, r) => {
      if (r.tahun !== year || r.bulan !== month) return s;
      return s + fmtNum(r.realReguler) + fmtNum(r.realSustain) + fmtNum(r.realScaling) + fmtNum(r.realNgtma);
    }, 0);
    if (totalAtMonth > 0) return { year, month };
    month--;
    if (month === 0) { month = 12; year--; }
  }
  return { year, month };
}

async function computeSnapshotRanks(snapshotId: number): Promise<Map<string, RankedAm>> {
  const allAms = await db.select().from(accountManagersTable);
  const activeNikSet = new Set(
    allAms
      .filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || ""))
      .map(m => m.nik)
  );
  const chatIdMap = new Map(allAms.map(m => [m.nik, m.telegramChatId]));
  const nameMap = new Map(allAms.map(m => [m.nik, m.nama]));

  const rows = await db.select().from(performanceDataTable)
    .where(eq(performanceDataTable.importId, snapshotId));

  // Filter to active AMs only — keep NIKs for ranking set
  const activeRows = rows.filter(r => r.nik && activeNikSet.has(r.nik));
  if (activeRows.length === 0) return new Map<string, RankedAm>();

  const { year: periodYear, month: periodMonth } = resolveDataPeriod(activeRows);
  if (periodYear === 0) return new Map<string, RankedAm>();

  // Aggregate CM totals per NIK: SUM all customer rows for the data period
  interface AmTotals {
    nik: string;
    realReguler: number; targetReguler: number;
    realSustain: number; targetSustain: number;
    realScaling: number; targetScaling: number;
    realNgtma: number; targetNgtma: number;
  }
  const cmByNik = new Map<string, AmTotals>();
  for (const r of activeRows) {
    if (r.tahun !== periodYear || r.bulan !== periodMonth) continue;
    const cur = cmByNik.get(r.nik) ?? {
      nik: r.nik,
      realReguler: 0, targetReguler: 0,
      realSustain: 0, targetSustain: 0,
      realScaling: 0, targetScaling: 0,
      realNgtma: 0, targetNgtma: 0,
    };
    cmByNik.set(r.nik, {
      nik: r.nik,
      realReguler: cur.realReguler + fmtNum(r.realReguler),
      targetReguler: cur.targetReguler + fmtNum(r.targetReguler),
      realSustain: cur.realSustain + fmtNum(r.realSustain),
      targetSustain: cur.targetSustain + fmtNum(r.targetSustain),
      realScaling: cur.realScaling + fmtNum(r.realScaling),
      targetScaling: cur.targetScaling + fmtNum(r.targetScaling),
      realNgtma: cur.realNgtma + fmtNum(r.realNgtma),
      targetNgtma: cur.targetNgtma + fmtNum(r.targetNgtma),
    });
  }

  // Aggregate YTD per NIK: SUM all customer rows where tahun=periodYear AND bulan<=periodMonth
  const ytdByNik = new Map<string, AmTotals>();
  for (const r of activeRows) {
    if (r.tahun !== periodYear) continue;
    if (r.bulan > periodMonth) continue;
    const cur = ytdByNik.get(r.nik) ?? {
      nik: r.nik,
      realReguler: 0, targetReguler: 0,
      realSustain: 0, targetSustain: 0,
      realScaling: 0, targetScaling: 0,
      realNgtma: 0, targetNgtma: 0,
    };
    ytdByNik.set(r.nik, {
      nik: r.nik,
      realReguler: cur.realReguler + fmtNum(r.realReguler),
      targetReguler: cur.targetReguler + fmtNum(r.targetReguler),
      realSustain: cur.realSustain + fmtNum(r.realSustain),
      targetSustain: cur.targetSustain + fmtNum(r.targetSustain),
      realScaling: cur.realScaling + fmtNum(r.realScaling),
      targetScaling: cur.targetScaling + fmtNum(r.targetScaling),
      realNgtma: cur.realNgtma + fmtNum(r.realNgtma),
      targetNgtma: cur.targetNgtma + fmtNum(r.targetNgtma),
    });
  }

  // Rank by Reguler achievement only (matching dashboard /am-rank default)
  const computeAch = (real: number, target: number) => target > 0 ? (real / target) * 100 : 0;
  const sumTotals = (a: AmTotals) => ({
    real: a.realReguler + a.realSustain + a.realScaling + a.realNgtma,
    target: a.targetReguler + a.targetSustain + a.targetScaling + a.targetNgtma,
  });
  const achReguler = (a: AmTotals) => computeAch(a.realReguler, a.targetReguler);

  // For ranking we include any AM that has either CM data or YTD data with
  // a non-zero Reguler target, so we don't push AMs with only target rows off the board.
  const candidates = new Set<string>([...cmByNik.keys(), ...ytdByNik.keys()]);
  const candidateRows = [...candidates].map(nik => {
    const cm = cmByNik.get(nik) ?? null;
    const ytd = ytdByNik.get(nik) ?? null;
    return { nik, cm, ytd };
  });

  // CM rank — sort by Reguler achievement (CM), include AMs that have CM data
  const cmRanked = candidateRows
    .filter(c => c.cm !== null)
    .map(c => ({ nik: c.nik, ach: achReguler(c.cm!), target: c.cm!.targetReguler }))
    .filter(c => c.target > 0 || c.ach > 0)
    .sort((a, b) => b.ach - a.ach);

  // YTD rank — sort by Reguler achievement (YTD)
  const ytdRanked = candidateRows
    .filter(c => c.ytd !== null)
    .map(c => ({ nik: c.nik, ach: achReguler(c.ytd!), target: c.ytd!.targetReguler }))
    .filter(c => c.target > 0 || c.ach > 0)
    .sort((a, b) => b.ach - a.ach);

  const result = new Map<string, RankedAm>();
  cmRanked.forEach((c, i) => {
    const cm = cmByNik.get(c.nik)!;
    const ytd = ytdByNik.get(c.nik);
    const cmSum = sumTotals(cm);
    const ytdSum = ytd ? sumTotals(ytd) : { real: 0, target: 0 };
    const ytdRegulerAchPct = ytd ? achReguler(ytd) : 0;
    result.set(c.nik, {
      nik: c.nik,
      namaAm: cm ? (nameMap.get(c.nik) ?? c.nik) : (nameMap.get(c.nik) ?? c.nik),
      telegramChatId: chatIdMap.get(c.nik) ?? null,
      periodYear, periodMonth,
      realReguler: cm.realReguler,
      targetReguler: cm.targetReguler,
      achReguler: cm.targetReguler > 0 ? (cm.realReguler / cm.targetReguler) * 100 : 0,
      realRevenue: cmSum.real,
      targetRevenue: cmSum.target,
      achRate: cmSum.target > 0 ? (cmSum.real / cmSum.target) * 100 : 0,
      realRevenueYtd: ytdSum.real,
      targetRevenueYtd: ytdSum.target,
      achRateYtd: ytdSum.target > 0 ? (ytdSum.real / ytdSum.target) * 100 : 0,
      ytdRegulerActual: ytd?.realReguler ?? 0,
      ytdRegulerTarget: ytd?.targetReguler ?? 0,
      ytdRegulerAchPct,
      rankCm: i + 1,
      rankYtd: 0,
      rankCmTotal: cmRanked.length,
      rankYtdTotal: ytdRanked.length,
    });
  });
  ytdRanked.forEach((y, i) => {
    const existing = result.get(y.nik);
    if (existing) {
      existing.rankYtd = i + 1;
    } else {
      // AM has YTD data but no CM data — include with rankYtd only
      const ytd = ytdByNik.get(y.nik)!;
      const ytdSum = sumTotals(ytd);
      result.set(y.nik, {
        nik: y.nik,
        namaAm: nameMap.get(y.nik) ?? y.nik,
        telegramChatId: chatIdMap.get(y.nik) ?? null,
        periodYear, periodMonth,
        realReguler: 0,
        targetReguler: 0,
        achReguler: 0,
        realRevenue: 0,
        targetRevenue: 0,
        achRate: 0,
        realRevenueYtd: ytdSum.real,
        targetRevenueYtd: ytdSum.target,
        achRateYtd: ytdSum.target > 0 ? (ytdSum.real / ytdSum.target) * 100 : 0,
        ytdRegulerActual: ytd.realReguler,
        ytdRegulerTarget: ytd.targetReguler,
        ytdRegulerAchPct: ytd.targetReguler > 0 ? (ytd.realReguler / ytd.targetReguler) * 100 : 0,
        rankCm: 0,
        rankYtd: i + 1,
        rankCmTotal: cmRanked.length,
        rankYtdTotal: ytdRanked.length,
      });
    }
  });

  return result;
}

// ── Manager Snapshot Notification (ringkasan level manager ke semua MANAGER) ──────

export interface ManagerSnapshotCtx {
  greeting: string;
  managerName: string;
  snapshotName: string;
  periodMonth: string;           // e.g. "Juli 2026"
  bulanYtd: string;              // e.g. "Januari s.d. Juli 2026"
  uploaderName: string;          // bold
  uploaderRole: string;          // italic
  // CM
  capaianCm: string;             // "79,8%"
  gapCm: string;                 // "Rp 110,91 jt"
  // YTD
  revRegulerYtd: string;         // "Rp 4,44 M"
  targetYtd: string;             // "Rp 4,38 M"
  capaianYtd: string;             // "101,4%"
  // Ranks
  rankCm: number;
  rankYtd: number;
  totalAms: number;
}

export function renderManagerSnapshot(ctx: ManagerSnapshotCtx): string {
  const lines: string[] = [
    `<b>[UPDATE SNAPSHOT REVENUE PERFORMANCE]</b>`,
    ``,
    `Selamat ${ctx.greeting}, kak <b>${ctx.managerName}</b> 👋`,
    ``,
    `Mohon izin menginformasikan bahwa <b>${ctx.uploaderName}</b> (<i>${ctx.uploaderRole}</i>) baru saja mengunggah data Revenue Performance terbaru untuk snapshot <b>${ctx.snapshotName}</b>.`,
    ``,
    `Berikut highlight untuk data <b>${ctx.bulanYtd}</b>:`,
    ``,
    `<b>1. Capaian CM (bulan berjalan) ${ctx.periodMonth}</b>: baru <b>${ctx.capaianCm}</b>, masih kurang <b>${ctx.gapCm}</b> lagi untuk mencapai target.`,
    ``,
    `<b>2. YTD Reguler ${ctx.bulanYtd}</b>: ${ctx.revRegulerYtd} dari target ${ctx.targetYtd} (sebesar <b>${ctx.capaianYtd}%</b>). Target YTD tercapai, pertahankan! 🎊`,
    ``,
    `<b>3. Peringkat Performansi</b>: <b>#${ctx.rankCm}</b> untuk CM dan <b>#${ctx.rankYtd}</b> untuk YTD (berdasarkan % capaian reguler) dari <b>${ctx.totalAms} AM aktif</b> di LESA VI.`,
    ``,
    `<b>Klik tombol di bawah untuk lihat laporan lengkap dan visualisasi datanya 👇</b>`,
    ``,
    `<b>Ayo genjot closing, yuk kejar target bareng! Gas lanjut, kak! 🔥</b>`,
  ];

  return lines.join("\n");
}

export async function notifyManagerSnapshot(
  importId: number,
  uploader?: { nama: string; role: string; nik?: string },
): Promise<{
  sent: number; failed: number; skipped: number;
  details: { nama: string; status: string; error?: string }[];
}> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) {
    return { sent: 0, failed: 0, skipped: 0, details: [] };
  }
  const token = settings.telegramBotToken;
  const base = getPublicBaseUrlSafe();

  // Latest snapshot
  const [latestImp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, importId));
  if (!latestImp) return { sent: 0, failed: 0, skipped: 0, details: [] };

  // Resolve the actual data period from the rows (walk back to month with real revenue)
  const MONTH_NAMES_ID = [
    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const MONTH_SHORT_ID = [
    "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
  ];

  // Find the latest month that has real revenue (same walk-back as computeSnapshotRanks)
  const allRows = await db.select().from(performanceDataTable)
    .where(eq(performanceDataTable.importId, importId));

  const fmtNum = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

  // Find latest month with revenue
  const allAms = await db.select().from(accountManagersTable);
  const activeNikSet = new Set(
    allAms
      .filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || ""))
      .map(m => m.nik)
  );
  const nameMap = new Map(allAms.map(m => [m.nik, m.nama]));

  let periodYear = 0, periodMonth = 0;
  for (const r of allRows) {
    if (!activeNikSet.has(r.nik)) continue;
    const total = fmtNum(r.realReguler) + fmtNum(r.realSustain) + fmtNum(r.realScaling) + fmtNum(r.realNgtma);
    if (total <= 0) continue;
    if (r.tahun > periodYear || (r.tahun === periodYear && r.bulan > periodMonth)) {
      periodYear = r.tahun;
      periodMonth = r.bulan;
    }
  }

  // Walk back to find month with real revenue
  for (let step = 0; step < 12; step++) {
    const totalHere = allRows.reduce((s, r) => {
      if (r.tahun !== periodYear || r.bulan !== periodMonth) return s;
      if (!activeNikSet.has(r.nik)) return s;
      return s + fmtNum(r.realReguler) + fmtNum(r.realSustain) + fmtNum(r.realScaling) + fmtNum(r.realNgtma);
    }, 0);
    if (totalHere > 0) break;
    periodMonth--;
    if (periodMonth === 0) { periodMonth = 12; periodYear--; }
  }

  const periodMonthName = MONTH_NAMES_ID[periodMonth] ?? String(periodMonth);
  const periodMonthShort = MONTH_SHORT_ID[periodMonth] ?? String(periodMonth);

  // Aggregate CM totals (Reguler only) for ALL active AMs
  const cmReguler = allRows
    .filter(r => r.tahun === periodYear && r.bulan === periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realReguler), 0);
  const cmTargetReguler = allRows
    .filter(r => r.tahun === periodYear && r.bulan === periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.targetReguler), 0);
  const cmSustain = allRows
    .filter(r => r.tahun === periodYear && r.bulan === periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realSustain), 0);
  const cmScaling = allRows
    .filter(r => r.tahun === periodYear && r.bulan === periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realScaling), 0);
  const cmNgtma = allRows
    .filter(r => r.tahun === periodYear && r.bulan === periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realNgtma), 0);

  // Aggregate YTD totals (Jan..periodMonth) for ALL active AMs
  const ytdReguler = allRows
    .filter(r => r.tahun === periodYear && r.bulan <= periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realReguler), 0);
  const ytdTargetReguler = allRows
    .filter(r => r.tahun === periodYear && r.bulan <= periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.targetReguler), 0);
  const ytdSustain = allRows
    .filter(r => r.tahun === periodYear && r.bulan <= periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realSustain), 0);
  const ytdScaling = allRows
    .filter(r => r.tahun === periodYear && r.bulan <= periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realScaling), 0);
  const ytdNgtma = allRows
    .filter(r => r.tahun === periodYear && r.bulan <= periodMonth && activeNikSet.has(r.nik))
    .reduce((s, r) => s + fmtNum(r.realNgtma), 0);

  // Achievement percentages
  const achCm = cmTargetReguler > 0 ? (cmReguler / cmTargetReguler) * 100 : 0;
  const achYtd = ytdTargetReguler > 0 ? (ytdReguler / ytdTargetReguler) * 100 : 0;

  // Per-AM CM and YTD for breakdown
  const cmByNik = new Map<string, number>();
  const cmTargetByNik = new Map<string, number>();
  const ytdByNik = new Map<string, number>();
  const ytdTargetByNik = new Map<string, number>();
  const namaByNik = new Map<string, string>();

  for (const r of allRows) {
    if (!activeNikSet.has(r.nik)) continue;
    const nik = r.nik;
    namaByNik.set(nik, nameMap.get(nik) ?? r.namaAm ?? nik);
    if (r.tahun === periodYear && r.bulan === periodMonth) {
      cmByNik.set(nik, (cmByNik.get(nik) ?? 0) + fmtNum(r.realReguler));
      cmTargetByNik.set(nik, (cmTargetByNik.get(nik) ?? 0) + fmtNum(r.targetReguler));
    }
    if (r.tahun === periodYear && r.bulan <= periodMonth) {
      ytdByNik.set(nik, (ytdByNik.get(nik) ?? 0) + fmtNum(r.realReguler));
      ytdTargetByNik.set(nik, (ytdTargetByNik.get(nik) ?? 0) + fmtNum(r.targetReguler));
    }
  }

  // AM breakdown
  const reached100Cm = [...cmByNik.entries()]
    .filter(([, real]) => real > 0)
    .filter(([nik, real]) => {
      const target = cmTargetByNik.get(nik) ?? 0;
      return target > 0 && real / target >= 1;
    })
    .map(([nik]) => namaByNik.get(nik) ?? nik);

  const notReachedCm = [...cmByNik.entries()]
    .filter(([nik]) => !reached100Cm.includes(namaByNik.get(nik) ?? nik))
    .filter(([, real]) => {
      const target = cmTargetByNik.get(reached100Cm.find(n => n === reached100Cm.find(() => false)) ?? "") ?? 0;
      return true;
    })
    .filter(([nik, real]) => {
      const target = cmTargetByNik.get(nik) ?? 0;
      return target > 0 || real > 0;
    })
    .map(([nik]) => namaByNik.get(nik) ?? nik);

  // Cleaner approach for not reached CM
  const allNikWithData = [...cmByNik.keys()];
  const notReachedCmClean = allNikWithData
    .filter(nik => !reached100Cm.includes(namaByNik.get(nik) ?? nik))
    .filter(nik => {
      const real = cmByNik.get(nik) ?? 0;
      const target = cmTargetByNik.get(nik) ?? 0;
      return target > 0 || real > 0;
    })
    .map(nik => namaByNik.get(nik) ?? nik);

  const reached100Ytd = [...ytdByNik.entries()]
    .filter(([, real]) => real > 0)
    .filter(([nik, real]) => {
      const target = ytdTargetByNik.get(nik) ?? 0;
      return target > 0 && real / target >= 1;
    })
    .map(([nik]) => namaByNik.get(nik) ?? nik);

  const notReachedYtdClean = [...ytdByNik.keys()]
    .filter(nik => !reached100Ytd.includes(namaByNik.get(nik) ?? nik))
    .filter(nik => {
      const real = ytdByNik.get(nik) ?? 0;
      const target = ytdTargetByNik.get(nik) ?? 0;
      return target > 0 || real > 0;
    })
    .map(nik => namaByNik.get(nik) ?? nik);

  // Count active AMs with performance data
  const activeAmCount = [...cmByNik.entries()].filter(([, real]) => {
    const target = cmTargetByNik.get(reached100Cm.find(() => false) ?? "") ?? 0;
    return true;
  }).length;
  const activeAmCountClean = allNikWithData.filter(nik => {
    const real = cmByNik.get(nik) ?? 0;
    const target = cmTargetByNik.get(nik) ?? 0;
    return target > 0 || real > 0;
  }).length;

  // Helper: format currency
  function fmtCurrency(v: number): string {
    if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2).replace(".", ",")} M`;
    if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(2).replace(".", ",")} jt`;
    if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)} rb`;
    if (v === 0) return `Rp 0`;
    return `Rp ${v.toLocaleString("id-ID")}`;
  }

  function fmtPct(v: number): string {
    return v.toFixed(1).replace(".", ",");
  }

  // Format list names (shorten if too many)
  const fmtNames = (names: string[], max: number = 3): string => {
    if (names.length === 0) return "—";
    if (names.length <= max) return names.join(", ");
    const first = names.slice(0, max).join(", ");
    const rest = names.slice(max);
    // Shorten long names
    const shortRest = rest.map(n => n.split(" ")[0]);
    return `${first}, ${shortRest.join(", ")} (+${rest.length})`;
  };

  const publicHttps = toHttpsUrl(base);
  const reportUrl = `${publicHttps}/presentation?type=performance&id=${importId}`;
  const visualizationUrl = `${publicHttps}/visualisasi/performa`;
  const localMode = isLocalUrl(publicHttps);

  const bulanYtd = `Januari s.d. ${periodMonthName} ${periodYear}`;

  // Compute uploader's rank
  const latestRanks = await computeSnapshotRanks(importId);
  if (latestRanks.size === 0) {
    return { sent: 0, failed: 0, skipped: 0, details: [] };
  }

  const totalAms = activeAmCountClean;
  let rankCm = 0, rankYtd = 0;
  if (uploader?.nik) {
    const rankedAm = latestRanks.get(uploader.nik);
    if (rankedAm) {
      rankCm = rankedAm.rankCm > 0 ? rankedAm.rankCm : rankedAm.rankCmTotal;
      rankYtd = rankedAm.rankYtd > 0 ? rankedAm.rankYtd : rankedAm.rankYtdTotal;
    }
  }

  const gap = cmTargetReguler - cmReguler;

  const baseCtx = {
    greeting: getGreetingWIB(new Date()),
    snapshotName: formatSnapshotNameId(latestImp.snapshotDate),
    periodMonth: `${periodMonthName} ${periodYear}`,
    bulanYtd,
    uploaderName: uploader?.nama || "Officer",
    uploaderRole: uploader?.role === "OFFICER" ? "Officer"
      : uploader?.role === "ACCOUNT_MANAGER" ? "Account Manager"
      : uploader?.role === "MANAGER" ? "Manager"
      : uploader?.role || "Officer",
    capaianCm: fmtPct(achCm),
    gapCm: fmtCurrency(gap),
    revRegulerYtd: fmtCurrency(ytdReguler),
    targetYtd: fmtCurrency(ytdTargetReguler),
    capaianYtd: fmtPct(achYtd),
    rankCm,
    rankYtd,
    totalAms,
  };

  // Inline keyboard buttons
  const keyboard = localMode
    ? {
        inline_keyboard: [
          [{ text: "📊 Visualisasi Data", callback_data: "perf:vis" }],
          [{ text: "🏆 Leaderboard", callback_data: "perf:peringkat" }],
        ],
      }
    : {
        inline_keyboard: [
          [
            { text: "📊 Visualisasi Data", url: visualizationUrl },
            { text: "🏆 Leaderboard", url: `${publicHttps}/presentation?type=performance&id=${importId}` },
          ],
        ],
      };

  // Get all MANAGER role users with telegramChatId
  const managers = await db.select().from(accountManagersTable)
    .where(eq(accountManagersTable.role, "MANAGER"));

  const linkedManagers = managers.filter(m => m.telegramChatId);
  if (linkedManagers.length === 0) {
    return { sent: 0, failed: 0, skipped: linkedManagers.length, details: [] };
  }

  let sent = 0, failed = 0;
  const details: { nama: string; status: string; error?: string }[] = [];

  for (const mgr of linkedManagers) {
    if (!mgr.telegramChatId) {
      details.push({ nama: mgr.nama, status: "skipped" });
      continue;
    }
    const ctx: ManagerSnapshotCtx = { ...baseCtx, managerName: mgr.nama };
    const body = renderManagerSnapshot(ctx);
    try {
      await sendToTelegramHtml(token, mgr.telegramChatId, body, keyboard);
      await db.insert(telegramLogsTable).values({
        nik: mgr.nik ?? null,
        namaAm: mgr.nama,
        telegramChatId: mgr.telegramChatId,
        status: "sent",
        period: latestImp.period,
        messageType: "manager_snapshot_notification",
      });
      sent++;
      details.push({ nama: mgr.nama, status: "sent" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      logger.error({ nik: mgr.nik, error: errMsg }, "notifyManagerSnapshot failed");
      await db.insert(telegramLogsTable).values({
        nik: mgr.nik ?? null,
        namaAm: mgr.nama,
        telegramChatId: mgr.telegramChatId,
        status: "failed",
        period: latestImp.period,
        messageType: "manager_snapshot_notification",
        error: errMsg,
      });
      failed++;
      details.push({ nama: mgr.nama, status: "failed", error: errMsg });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return { sent, failed, skipped: managers.length - linkedManagers.length, details };
}

export async function notifyPerformanceSnapshot(
  importId: number,
  uploader?: { nama: string; role: string },
): Promise<{
  sent: number; failed: number; skipped: number;
  details: { nik: string; status: string; error?: string }[];
}> {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) {
    return { sent: 0, failed: 0, skipped: 0, details: [] };
  }
  const token = settings.telegramBotToken;
  const base = getPublicBaseUrlSafe();

  // Latest snapshot
  const [latestImp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, importId));
  if (!latestImp) return { sent: 0, failed: 0, skipped: 0, details: [] };

  // Previous snapshot (2nd newest)
  const allImports = await db.select().from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(10);
  const prevImp = allImports.find(imp => imp.id !== importId) ?? null;

  const latestRanks = await computeSnapshotRanks(importId);
  const prevRanks = prevImp ? await computeSnapshotRanks(prevImp.id) : new Map<string, RankedAm>();

  const snapshotName = formatSnapshotNameId(latestImp.snapshotDate);
  const greeting = getGreetingWIB(new Date());
  const publicHttps = toHttpsUrl(base);
  const reportUrl = `${publicHttps}/presentation?type=performance&id=${importId}`;
  const visualizationUrl = `${publicHttps}/visualisasi/performa`;
  const localMode = isLocalUrl(publicHttps);

  let sent = 0, failed = 0, skipped = 0;
  const details: { nik: string; status: string; error?: string }[] = [];

  for (const [nik, curr] of latestRanks) {
    if (!curr.telegramChatId) {
      skipped++;
      details.push({ nik, status: "skipped" });
      continue;
    }

    const prev = prevRanks.get(nik) ?? null;
    // Use Reguler-only values to match the dashboard "Revenue: Reguler" slide
    const achRate = curr.targetReguler > 0 ? (curr.realReguler / curr.targetReguler) * 100 : 0;

    const periodLabel = `${MONTH_NAMES_ID[curr.periodMonth] ?? curr.periodMonth} ${curr.periodYear}`;
    const cmMonthName = `${MONTH_NAMES_ID[curr.periodMonth] ?? curr.periodMonth} ${curr.periodYear}`;
    const ytdLabel = `Januari – ${MONTH_NAMES_ID[curr.periodMonth] ?? curr.periodMonth} ${curr.periodYear}`;

    const uploaderName = uploader?.nama?.split(" ")[0] || "Officer";
    const uploaderRole = uploader?.role || "OFFICER";

    const perfCtx: PerfAnnouncementCtx = {
      amName: curr.namaAm,
      officerName: uploaderName,
      officerRole: uploaderRole,
      snapshotName,
      revenueActual: curr.realReguler,
      achievementPct: achRate,
      targetRevenue: curr.targetReguler,
      rankCurrent: curr.rankCm,
      rankTotal: curr.rankCmTotal,
      rankPrevious: prev?.rankCm ?? null,
      greeting,
      periodLabel,
      cmMonthName,
      ytdLabel,
      ytdRegulerActual: curr.ytdRegulerActual,
      ytdRegulerTarget: curr.ytdRegulerTarget,
      ytdRegulerAchPct: curr.ytdRegulerAchPct,
      rankCm: curr.rankCm,
      rankYtd: curr.rankYtd,
      rankYtdTotal: curr.rankYtdTotal,
    };

    const textBody = renderPerfAnnouncement(perfCtx);

    // 2 inline buttons. In local/dev mode Telegram rejects URL buttons that
    // point to private hosts, so fall back to callback buttons which the
    // bot responds to with a text containing the URL.
    const keyboard = localMode
      ? {
          inline_keyboard: [
            [{ text: "📄 Laporan Terkini", callback_data: "perf:lap" }],
            [{ text: "📊 Visualisasi Data", callback_data: "perf:vis" }],
          ],
        }
      : {
          inline_keyboard: [
            [
              { text: "📄 Laporan Terkini", url: reportUrl },
              { text: "📊 Visualisasi Data", url: visualizationUrl },
            ],
          ],
        };

    try {
      await sendToTelegramHtml(token, curr.telegramChatId, textBody, keyboard);
      await db.insert(telegramLogsTable).values({
        nik, namaAm: curr.namaAm,
        telegramChatId: curr.telegramChatId,
        status: "sent",
        period: latestImp.period,
        messageType: "snapshot_notification",
      });
      sent++;
      details.push({ nik, status: "sent" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown";
      logger.error({ nik, error: errMsg }, "notifyPerformanceSnapshot failed");
      await db.insert(telegramLogsTable).values({
        nik, namaAm: curr.namaAm,
        telegramChatId: curr.telegramChatId,
        status: "failed",
        period: latestImp.period,
        messageType: "snapshot_notification",
        error: errMsg,
      });
      failed++;
      details.push({ nik, status: "failed", error: errMsg });
    }

    // Rate limit between sends (500ms + retry backoff handles 429s gracefully)
    await new Promise(r => setTimeout(r, 500));
  }

  return { sent, failed, skipped, details };
}
