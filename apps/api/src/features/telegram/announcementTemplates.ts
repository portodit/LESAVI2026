/**
 * Performance snapshot announcement templates.
 *
 * HTML output (parse_mode=HTML). The Telegram HTML parser is strict about
 * entity escaping, so any variable interpolated into the message body must
 * go through `htmlEscape` first.
 */

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const ID_FMT_INT = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const ID_FMT_2 = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ID_FMT_PCT1 = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatRupiahId(n: number): string {
  if (!Number.isFinite(n)) return "Rp 0";
  if (n === 0) return "Rp 0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${sign}Rp ${ID_FMT_2.format(abs / 1_000_000_000_000)} T`;
  if (abs >= 1_000_000_000) return `${sign}Rp ${ID_FMT_2.format(abs / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `${sign}Rp ${ID_FMT_2.format(abs / 1_000_000)} jt`;
  if (abs >= 1_000) return `${sign}Rp ${ID_FMT_INT.format(abs / 1_000)} rb`;
  return `${sign}Rp ${ID_FMT_INT.format(abs)}`;
}

export function formatPctId(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return ID_FMT_PCT1.format(n);
}

export function formatSnapshotNameId(snapshotDate: string | Date | null | undefined): string {
  if (!snapshotDate) return "—";
  const d = typeof snapshotDate === "string" ? new Date(snapshotDate) : snapshotDate;
  if (isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTH_NAMES_ID[d.getMonth()]} ${d.getFullYear()}`;
}

export function getGreetingWIB(date: Date = new Date()): string {
  const wibHour = (date.getUTCHours() + 7) % 24;
  if (wibHour >= 4 && wibHour < 11) return "Pagi";
  if (wibHour >= 11 && wibHour < 15) return "Siang";
  if (wibHour >= 15 && wibHour < 18) return "Sore";
  return "Malam";
}

/** Escape HTML entities for safe interpolation into Telegram HTML messages. */
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface RankData {
  rank_current: number;
  rank_previous: number | null;
  rank_total: number;
  rank_delta: number | null;
  /** Optional period label so the sentence can disambiguate CM vs YTD rank. */
  period_label?: string;
}

export function getRankSentence(d: RankData): string {
  const periodSuffix = d.period_label ? ` untuk periode ${d.period_label}` : "";
  if (d.rank_current === 1) {
    return `Luar biasa! 🏆 Kakak memimpin di peringkat #1 dari ${d.rank_total} AM aktif di divisi LESA VI${periodSuffix}. Pertahankan ya, kak!`;
  }
  if (d.rank_previous == null) {
    return `Posisi kakak saat ini di peringkat #${d.rank_current} dari ${d.rank_total} AM aktif di divisi LESA VI${periodSuffix}.`;
  }
  const delta = d.rank_previous - d.rank_current;
  if (delta > 0) {
    return `Peringkat kakak naik ${delta} tingkat dari #${d.rank_previous} ke #${d.rank_current} dari ${d.rank_total} AM aktif di divisi LESA VI${periodSuffix}. Pertahankan momentumnya! 🎉`;
  }
  if (delta < 0) {
    return `Peringkat kakak turun ${Math.abs(delta)} tingkat dari #${d.rank_previous} ke #${d.rank_current} dari ${d.rank_total} AM aktif di divisi LESA VI${periodSuffix}. Masih ada waktu untuk mengejar, yuk kita kejar bareng! 💪`;
  }
  return `Posisi kakak masih stabil di peringkat #${d.rank_current} dari ${d.rank_total} AM aktif di divisi LESA VI${periodSuffix}. Sedikit dorongan lagi bisa membawa kakak naik peringkat!`;
}

export function getRevenueSentence(
  achievementPct: number,
  revenueActual: number,
  revenueGap: number,
): string {
  const rev = formatRupiahId(revenueActual);
  const pct = formatPctId(achievementPct);
  if (achievementPct >= 100) {
    return `Revenue yang sudah kakak hasilkan sebesar ${rev}, atau ${pct}% dari target. Artinya target bulan ini sudah tercapai, selamat ya! 🎊`;
  }
  return `Revenue yang sudah kakak hasilkan sebesar ${rev}, atau ${pct}% dari target. Masih ada gap ${formatRupiahId(revenueGap)} lagi untuk mencapai target.`;
}

export function getClosingSentence(achievementPct: number): string {
  if (achievementPct >= 100) {
    return "Yuk semangat tambah terus capaiannya! Gas lanjut, kak! 🔥";
  }
  return "Ayo genjot closing, yuk kejar target bareng! Gas lanjut, kak! 🔥";
}

export interface PerfAnnouncementCtx {
  amName: string;
  officerName: string;
  officerRole: string;
  snapshotName: string;
  revenueActual: number;
  achievementPct: number;
  targetRevenue: number;
  rankCurrent: number;
  rankTotal: number;
  rankPrevious: number | null;
  greeting: string;
  /** Data period label for the main highlight (e.g. "Juli 2026"). */
  periodLabel: string;
  /** Just the month name (e.g. "Juli 2026") — used inline in the CM percentage sentence. */
  cmMonthName: string;
  /** YTD window label (e.g. "Januari – Juli 2026"). Empty string if not provided. */
  ytdLabel?: string;
  /** YTD Reguler revenue (sum of realReguler across Jan..currentMonth). */
  ytdRegulerActual?: number;
  /** YTD Reguler target. */
  ytdRegulerTarget?: number;
  /** YTD Reguler achievement in percent (0..100+). */
  ytdRegulerAchPct?: number;
  /** CM rank (1-based) — same as rankCurrent. */
  rankCm: number;
  /** YTD rank (1-based). 0 if AM has no YTD data. */
  rankYtd: number;
  /** Total AMs in the YTD ranking. */
  rankYtdTotal: number;
}

export function renderPerfAnnouncement(ctx: PerfAnnouncementCtx): string {
  // Achievement flags
  const cmReached = ctx.achievementPct >= 100;
  const ytdReached = (ctx.ytdRegulerAchPct ?? 0) >= 100;
  const cmPct = formatPctId(ctx.achievementPct);
  const ytdPct = formatPctId(ctx.ytdRegulerAchPct);

  // Gaps (only meaningful when not yet reached)
  const cmGap = Math.max(0, ctx.targetRevenue - ctx.revenueActual);
  const hasYtd = !!(ctx.ytdLabel &&
    ctx.ytdRegulerActual != null &&
    ctx.ytdRegulerTarget != null &&
    ctx.ytdRegulerTarget > 0);
  const ytdGap = hasYtd
    ? Math.max(0, (ctx.ytdRegulerTarget as number) - (ctx.ytdRegulerActual as number))
    : 0;

  // CM sentence — varies on whether target is reached
  let cmSentence: string;
  if (cmReached) {
    cmSentence = `Capaian <b>CM (bulan berjalan) ${ctx.cmMonthName}</b>: <b>${cmPct}%</b>. Target reguler tercapai, mantap! 🎉`;
  } else {
    cmSentence = `Capaian <b>CM (bulan berjalan) ${ctx.cmMonthName}</b>: baru <b>${cmPct}%</b>, masih kurang <b>${formatRupiahId(cmGap)}</b> lagi ke target.`;
  }

  // YTD sentence — only if data available
  let ytdSentence: string | null = null;
  if (hasYtd) {
    const ytdLabelEsc = htmlEscape(ctx.ytdLabel as string);
    if (ytdReached) {
      ytdSentence = `YTD Reguler <b>${ytdLabelEsc}</b>: <b>${formatRupiahId(ctx.ytdRegulerActual!)}</b> dari target <b>${formatRupiahId(ctx.ytdRegulerTarget!)}</b> (sebesar <b>${ytdPct}%</b>). Target YTD tercapai, pertahankan! 🎊`;
    } else {
      ytdSentence = `YTD Reguler <b>${ytdLabelEsc}</b>: <b>${formatRupiahId(ctx.ytdRegulerActual!)}</b> dari target <b>${formatRupiahId(ctx.ytdRegulerTarget!)}</b> (sebesar <b>${ytdPct}%</b>), masih kurang <b>${formatRupiahId(ytdGap)}</b>.`;
    }
  }

  // Rank sentence — explicit basis so AM knows how they're ranked
  const rankCmStr = ctx.rankCm > 0 ? `#${ctx.rankCm}` : "—";
  const rankYtdStr = ctx.rankYtd > 0 ? `#${ctx.rankYtd}` : "—";
  const totalAm = ctx.rankCmTotal || ctx.rankTotal;
  const rankSentence = `Peringkat: <b>${rankCmStr}</b> untuk CM dan <b>${rankYtdStr}</b> untuk YTD (berdasarkan <b>% capaian reguler</b>) dari <b>${totalAm}</b> AM aktif di LESA VI.`;

  // Closing — varies on achievement
  let closing: string;
  if (cmReached && ytdReached) {
    closing = "Pertahankan performa terbaik ini! 💪";
  } else if (cmReached) {
    closing = "CM sudah tercapai, jaga konsistensi di bulan-bulan berikutnya! 💪";
  } else {
    closing = "Ayo genjot closing, yuk kejar target bareng! Gas lanjut, kak! 🔥";
  }

  // Escape user-controlled fields that go into HTML
  const amNameEsc = htmlEscape(ctx.amName);
  const officerNameEsc = htmlEscape(ctx.officerName);
  const officerRoleEsc = htmlEscape(ctx.officerRole);
  const snapshotNameEsc = htmlEscape(ctx.snapshotName);
  const periodLabelEsc = htmlEscape(ctx.periodLabel);
  const cmMonthNameEsc = htmlEscape(ctx.cmMonthName);

  const lines: string[] = [
    `Selamat ${ctx.greeting}, kak <b>${amNameEsc}</b> 👋`,
    ``,
    `Mohon izin menginformasikan bahwa <b>${officerNameEsc}</b> baru saja mengunggah data Revenue Performance terbaru untuk snapshot ${snapshotNameEsc}.`,
    ``,
    `Berikut highlight untuk <b>data s.d. ${periodLabelEsc}</b>:`,
    ``,
  ];

  // Numbered list — each bullet gets a number prefix and is followed by a
  // blank line so the items read as separate, scannable highlights.
  lines.push(
    `<b>1.</b> ${cmSentence}`,
    ``,
  );

  if (ytdSentence) {
    lines.push(
      `<b>2.</b> ${ytdSentence}`,
      ``,
    );
  }

  lines.push(
    `<b>3.</b> ${rankSentence}`,
    ``,
  );

  lines.push(
    `<blockquote>Klik tombol di bawah untuk lihat laporan lengkap dan visualisasi datanya 👇</blockquote>`,
    ``,
    closing,
  );

  return lines.join("\n");
}
