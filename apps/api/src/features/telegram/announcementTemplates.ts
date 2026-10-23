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

// ── Activity Snapshot Announcement (per-AM) ─────────────────────────────────

export interface ActivityAmCtx {
  amName: string;
  officerName: string;
  officerRole: string;
  snapshotName: string;
  bulanLabel: string;       // "Agustus"
  tglDataLabel: string;     // "12 Agustus 2026"
  totalKegiatan: number;
  kpiTarget: number;        // default 25
  pct: number;              // 0..100+ (raw, not capped)
  greeting: string;
  isAwalBulan: boolean;     // snapshot day 1-7
}

export interface ActivityManagerCtx {
  managerName: string;
  managerHonorific: string;   // "Bu" / "Pak" / "kak"
  officerName: string;
  officerRole: string;
  snapshotName: string;
  bulanLabel: string;       // "Oktober"
  tglDataLabel: string;     // "16 Oktober 2026"
  totalAms: number;
  totalKegiatan: number;
  rataPct: number;          // 0..100+
  reachedCount: number;
  belumCount: number;
  greeting: string;
  // Daftar AM yang sudah/belum memenuhi KPI (sudah di-format sebagai numbered list, sorted desc by count)
  daftarMemenuhi: string;   // mis. "1. HANDIKA (5/25)\n2. ..."
  daftarBelum: string;
  pctAmMemenuhi: number;    // (reached / total) * 100
  isAwalBulan: boolean;
  kalimatStatus: string;    // pre-computed variant
}

/** Detect gender honorific from a person's full name (Indonesian heuristic). */
export function detectHonorific(fullName: string): "Bu" | "Pak" | "kak" {
  const firstName = fullName.replace(/^(Drs?|Dr|Ir|Hj|H|Prof)\.?\s+/i, "").trim().split(/\s+/)[0] || "";
  const lower = firstName.toLowerCase();
  // Common female endings/patterns
  if (/(i|a|ie|ah|ih|at|ik|un|asi|eti|ani|eni|ini|ita|ati|nti|uli|yati|yani)$/.test(lower)) return "Bu";
  // Common female prefixes
  if (/^(sri|siti|nur|ny|nyai|ni|miss)/i.test(firstName)) return "Bu";
  return "Pak";
}

function getManagerStatusSentence(reachedCount: number, totalAms: number, belumCount: number, isAwalBulan: boolean): string {
  if (isAwalBulan) {
    return "Bulan baru baru berjalan, belum ada AM yang memenuhi KPI. Yuk dorong tim untuk mulai mencatat kegiatan 🔥";
  }
  if (totalAms > 0 && reachedCount === totalAms) {
    return "Seluruh AM aktif sudah memenuhi KPI bulan ini 🎉 Kerja bagus, tim!";
  }
  if (totalAms > 0 && reachedCount / totalAms >= 0.7) {
    return `Mayoritas tim sudah on track. Tinggal dorong <b>${belumCount}</b> AM lagi supaya semuanya memenuhi KPI 💪`;
  }
  return `Masih ada <b>${belumCount}</b> AM yang perlu didorong untuk memenuhi KPI bulan ini.`;
}

export { getManagerStatusSentence };

function activityStatusSentence(total: number, kpiTarget: number, isAwalBulan: boolean): string {
  if (isAwalBulan) {
    return "Bulan baru baru dimulai, saatnya gas catat kegiatan kakak! 🔥";
  }
  const sisa = Math.max(0, kpiTarget - total);
  if (total === 0) {
    return `Belum ada kegiatan yang tercatat bulan ini. Yuk mulai catat, supaya progres KPI-nya terlihat! Tinggal <b>${sisa}</b> kegiatan lagi untuk mencapai target 🚀`;
  }
  const pct = kpiTarget > 0 ? (total / kpiTarget) * 100 : 0;
  if (pct >= 100) {
    return "KPI bulan ini sudah terpenuhi 🎉 Terus jaga ritmenya, kak!";
  }
  if (pct >= 80) {
    return `Sedikit lagi! Tinggal <b>${sisa}</b> kegiatan untuk memenuhi KPI bulan ini 💪`;
  }
  return `Masih ada <b>${sisa}</b> kegiatan lagi untuk mencapai KPI bulan ini. Yuk dicatat terus kegiatannya, kak!`;
}

export function renderActivityAmAnnouncement(ctx: ActivityAmCtx): string {
  const pct = ctx.pct;
  const pctDisplay = pct.toFixed(1).replace(".", ",");
  const statusSentence = activityStatusSentence(ctx.totalKegiatan, ctx.kpiTarget, ctx.isAwalBulan);

  const amNameEsc = htmlEscape(ctx.amName);
  const officerNameEsc = htmlEscape(ctx.officerName);
  const officerRoleEsc = htmlEscape(ctx.officerRole);
  const snapshotNameEsc = htmlEscape(ctx.snapshotName);
  const bulanLabelEsc = htmlEscape(ctx.bulanLabel);
  const tglDataLabelEsc = htmlEscape(ctx.tglDataLabel);

  return [
    `<b>[UPDATE SNAPSHOT SALES ACTIVITY]</b>`,
    ``,
    `Selamat ${ctx.greeting}, kak <b>${amNameEsc}</b> 👋`,
    ``,
    `Mohon izin menginformasikan bahwa <b>${officerRoleEsc}</b> baru saja mengunggah data <b>Sales Activity</b> terbaru untuk snapshot <b>${snapshotNameEsc}</b>.`,
    ``,
    `<b>Highlight ${bulanLabelEsc} (data s.d. ${tglDataLabelEsc}):</b>`,
    `├ <b>Total kegiatan:</b> ${ctx.totalKegiatan} kegiatan`,
    `├ <b>KPI bulanan:</b> ${ctx.kpiTarget} kegiatan`,
    `└ <b>Ketercapaian KPI:</b> ${pctDisplay}%`,
    ``,
    `<blockquote>${statusSentence}</blockquote>`,
    ``,
    `Lihat visualisasi datanya lewat tombol di bawah 👇`,
  ].join("\n");
}

// ── Sales Funnel Snapshot Announcement (per-AM) ────────────────────────────

/** Potong nama LOP di ±35 karakter; ID LOP tidak pernah dipotong. */
export function formatLopTitle(name: string | null | undefined, lopid: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return lopid;
  if (trimmed.length <= 35) return trimmed;
  return trimmed.slice(0, 34).trimEnd() + "…";
}

/** Nilai rupiah tanpa prefix "Rp" (template sudah menulis "Rp ..."). */
function rupiahValue(n: number): string {
  return formatRupiahId(n).replace(/^Rp\s*/, "");
}

export interface FunnelHighlightCtx {
  nama: string;
  lopid: string;
  phase: string;
  phaseLabel: string;
  from: string | null;
  to: string | null;
  delta: number;
  snapshotCount: number;
  sinceLabel: string;
  /** Nama AM pemilik LOP — dipakai pada daftar level divisi. */
  namaAm?: string;
}

export interface FunnelAnnouncementCtx {
  amName: string;
  officerName: string;
  officerRole: string;
  snapshotName: string;
  previousSnapshotName: string | null;
  greeting: string;
  /** Disclaimer scope (kategori kontrak + tahun anggaran). */
  scopeLabel: string;
  totalLop: number;
  totalNilai: number;
  realisasi: number;
  target: number;
  /** Capaian dalam persen (bisa > 100 bila melewati target). */
  capaianPct: number;
  /** Kelebihan realisasi di atas target (0 bila tidak melewati). */
  overTarget: number;
  /** Conversion rate F5 ÷ (F3+F4+F5) dalam persen, null bila denom 0. */
  crPct: number | null;
  /** Jumlah LOP di fase F3–F5 — penyebut conversion rate. */
  crLopCount: number;
  counts: Record<string, number>;
  movements: { baru: number; naik: number; turun: number; stagnan: number };
}

/** "Dian (OFFICER)" — kalau nama kosong atau sama dengan role, role saja yang tampil. */
export function formatOfficerLine(officerName: string, officerRole: string): string {
  const name = (officerName || "").trim();
  const role = (officerRole || "").trim();
  if (!name || name.toLowerCase() === role.toLowerCase()) {
    return htmlEscape(role || "Officer");
  }
  return `${htmlEscape(name)} (${htmlEscape(role)})`;
}

/** Pesan pertama: ringkasan funnel. */
export function renderFunnelAnnouncement(ctx: FunnelAnnouncementCtx): string {
  const amNameEsc = htmlEscape(ctx.amName);
  const snapshotNameEsc = htmlEscape(ctx.snapshotName);
  const scopeEsc = htmlEscape(ctx.scopeLabel);
  const prevEsc = htmlEscape(ctx.previousSnapshotName ?? "snapshot sebelumnya");

  // Capaian ditampilkan apa adanya (bukan di-cap 100) supaya AM tahu
  // sejauh mana melampaui target; kalimat "melebihi target" sudah terpisah.
  const pencapaian = formatPctId(Math.max(ctx.capaianPct, 0));
  const crDisplay = ctx.crPct == null ? "—" : formatPctId(ctx.crPct);

  const lines: string[] = [
    `<b>[UPDATE SNAPSHOT SALES FUNNEL]</b>`,
    ``,
    `Selamat ${ctx.greeting}, kak <b>${amNameEsc}</b> 👋`,
    ``,
    `Mohon izin menginformasikan bahwa ${formatOfficerLine(ctx.officerName, ctx.officerRole)} baru saja mengunggah data <b>Sales Funnel</b> terbaru untuk snapshot <b>${snapshotNameEsc}</b>.`,
    ``,
    `<blockquote>ℹ️ Daftar di bawah mencakup LOP kategori kontrak <b>${scopeEsc}</b>.</blockquote>`,
    ``,
    `<b>📌 Ringkasan Funnel</b>`,
    `├ <b>Total LOP:</b> ${ctx.totalLop} proyek senilai Rp ${rupiahValue(ctx.totalNilai)}`,
  ];

  if (ctx.target > 0) {
    const targetLine =
      ctx.overTarget > 0
        ? `<b>Realisasi funnel</b> Rp ${rupiahValue(ctx.realisasi)} dari target Rp ${rupiahValue(ctx.target)} (capaian <b>${pencapaian}%</b>, melebihi target Rp ${rupiahValue(ctx.overTarget)})`
        : `<b>Realisasi funnel</b> Rp ${rupiahValue(ctx.realisasi)} dari target Rp ${rupiahValue(ctx.target)} (capaian <b>${pencapaian}%</b>)`;
    lines.push(`├ ${targetLine}`);
  } else {
    lines.push(`├ <b>Realisasi funnel</b> Rp ${rupiahValue(ctx.realisasi)} (target belum diatur)`);
  }

  if (ctx.crPct == null) {
    lines.push(`└ <b>Conversion Rate:</b> — (belum ada LOP di F3–F5)`);
  } else {
    lines.push(
      `└ <b>Conversion Rate:</b> ${crDisplay}% (nilai F5 ÷ nilai F3+F4+F5 · ${ctx.crLopCount} LOP di F3–F5)`,
    );
  }

  lines.push(
    ``,
    `<b>🧭 Sebaran fase</b>`,
    renderPhaseLine(ctx.counts),
    ``,
    `<b>🔄 Pergerakan vs snapshot ${prevEsc}</b>`,
    `├ ✦ ${ctx.movements.baru} LOP baru muncul`,
    `├ ▲ ${ctx.movements.naik} LOP naik fase`,
    `├ ▼ ${ctx.movements.turun} LOP turun fase`,
    `└ ■ ${ctx.movements.stagnan} LOP stagnan`,
    ``,
    `Daftar LOP beserta pergerakannya ada di pesan berikutnya 👇`,
  );

  return lines.join("\n");
}

/**
 * Sebaran fase sebagai satu baris angka.
 *
 * Baris "— jumlah LOP per fase" dalam satu baris; memakai bar/grafik
 * menyesatkan karena panjangnya relatif, jadi angkanya yang jadi acuan.
 */
export function renderPhaseLine(counts: Record<string, number>): string {
  return ["F0", "F1", "F2", "F3", "F4", "F5"]
    .map((p) => `<b>${p}</b> ${counts[p] ?? 0} LOP`)
    .join(" | ");
}

/**
 * Pesan pertama versi manager: ringkasan level divisi.
 *
 * Bedanya dengan pesan AM: angka agregat seluruh AM aktif, dan CR memakai
 * basis jumlah LOP (bukan nilai) supaya manager bisa membaca proporsi LOP.
 */
export interface FunnelManagerAnnouncementCtx {
  managerName: string;
  /** Sapaan untuk manager, mis. "Bu" atau "kak". */
  managerHonorific: string;
  officerName: string;
  officerRole: string;
  snapshotName: string;
  previousSnapshotName: string | null;
  greeting: string;
  /** Kategori kontrak yang tercakup, mis. "GTMA, Own Channel". */
  kategoriKontrak: string;
  tahunAnggaran: number | null;
  /** Jumlah AM aktif yang tercakup dalam ringkasan. */
  activeAmCount: number;
  totalLop: number;
  totalNilai: number;
  realisasi: number;
  target: number;
  capaianPct: number;
  overTarget: number;
  /** CR berbasis jumlah LOP: nF5 ÷ (nF3+nF4+nF5) dalam persen. */
  crPct: number | null;
  crF5Count: number;
  crLopCount: number;
  counts: Record<string, number>;
  movements: { baru: number; naik: number; turun: number; stagnan: number };
  /** Persentase LOP stagnan terhadap total LOP divisi. */
  stagnantPct: number;
}

export function renderFunnelManagerAnnouncement(ctx: FunnelManagerAnnouncementCtx): string {
  const managerNameEsc = htmlEscape(ctx.managerName);
  const snapshotNameEsc = htmlEscape(ctx.snapshotName);
  const kategoriEsc = htmlEscape(ctx.kategoriKontrak);
  const prevEsc = htmlEscape(ctx.previousSnapshotName ?? "snapshot sebelumnya");
  const officerBlock = `<b>${formatOfficerLine(ctx.officerName, ctx.officerRole)}</b>`;

  const pencapaian = formatPctId(Math.max(ctx.capaianPct, 0));
  const crDisplay = ctx.crPct == null ? "—" : formatPctId(ctx.crPct);
  const tahunLine = ctx.tahunAnggaran != null ? String(ctx.tahunAnggaran) : "—";

  const lines: string[] = [
    `<b>[UPDATE SNAPSHOT SALES FUNNEL]</b>`,
    ``,
    `Selamat ${ctx.greeting}, ${ctx.managerHonorific} <b>${managerNameEsc}</b> 👋`,
    ``,
    `Mohon izin menginformasikan bahwa ${officerBlock} baru saja mengunggah data Sales Funnel terbaru untuk snapshot <b>${snapshotNameEsc}</b>.`,
    ``,
    `<blockquote>ℹ️ Ringkasan mencakup LOP kategori kontrak <b>${kategoriEsc}</b>, Tahun Anggaran ${tahunLine}, dari ${ctx.activeAmCount} AM aktif LESA VI.</blockquote>`,
    ``,
    `<b>📌 Ringkasan Divisi</b>`,
    `├ <b>Total LOP:</b> ${ctx.totalLop} proyek senilai Rp ${rupiahValue(ctx.totalNilai)}`,
  ];

  if (ctx.target > 0) {
    const targetLine =
      ctx.overTarget > 0
        ? `<b>Realisasi funnel:</b> Rp ${rupiahValue(ctx.realisasi)} dari target Rp ${rupiahValue(ctx.target)} (capaian <b>${pencapaian}%</b>, melebihi target Rp ${rupiahValue(ctx.overTarget)})`
        : `<b>Realisasi funnel:</b> Rp ${rupiahValue(ctx.realisasi)} dari target Rp ${rupiahValue(ctx.target)} (capaian <b>${pencapaian}%</b>)`;
    lines.push(`├ ${targetLine}`);
  } else {
    lines.push(`├ <b>Realisasi funnel:</b> Rp ${rupiahValue(ctx.realisasi)} (target belum diatur)`);
  }

  if (ctx.crPct == null) {
    lines.push(`└ <b>Conversion Rate:</b> — (belum ada LOP di F3–F5)`);
  } else {
    lines.push(
      `└ <b>Conversion Rate:</b> ${crDisplay}% (F5 ÷ F3+F4+F5, ${ctx.crF5Count} dari ${ctx.crLopCount} LOP)`,
    );
  }

  lines.push(
    ``,
    `<b>🧭 Sebaran fase</b>`,
    renderPhaseLine(ctx.counts),
    ``,
    `<b>🔄 Pergerakan vs snapshot ${prevEsc}</b>`,
    `├ ✦ ${ctx.movements.baru} LOP baru muncul`,
    `├ ▲ ${ctx.movements.naik} LOP naik fase`,
    `├ ▼ ${ctx.movements.turun} LOP turun fase`,
    `└ ■ ${ctx.movements.stagnan} LOP stagnan (${formatPctId(ctx.stagnantPct)}% dari total)`,
    ``,
    `Rincian per AM ada di pesan berikutnya 👇`,
  );

  return lines.join("\n");
}

export function renderActivityManagerAnnouncement(ctx: ActivityManagerCtx): string {
  const rataPctDisplay = ctx.rataPct.toFixed(1).replace(".", ",");
  const pctAmDisplay = ctx.pctAmMemenuhi.toFixed(0);

  const amNameEsc = htmlEscape(ctx.managerName);
  const snapshotNameEsc = htmlEscape(ctx.snapshotName);
  const bulanLabelEsc = htmlEscape(ctx.bulanLabel);
  const tglDataLabelEsc = htmlEscape(ctx.tglDataLabel);

  // Smart officer: kalau nama == role label, tampilkan sekali
  const officer = ctx.officerName.toLowerCase() === ctx.officerRole.toLowerCase()
    ? ctx.officerRole
    : `${ctx.officerName} (${ctx.officerRole})`;
  const officerEsc = htmlEscape(officer);

  // Stats lines (conditional baris ⏳ jika belumCount = 0)
  const summaryLines: string[] = [
    `<b>Gambaran ${ctx.totalAms} AM aktif LESA VI untuk ${bulanLabelEsc} (data s.d. ${tglDataLabelEsc}):</b>`,
    `├ <b>Total kegiatan tim:</b> ${ctx.totalKegiatan.toLocaleString("id-ID")} kegiatan`,
  ];
  if (ctx.reachedCount > 0) {
    summaryLines.push(
      `├ ✅ <b>${ctx.reachedCount} AM sudah memenuhi KPI (≥25 kegiatan):</b>\n   ${ctx.daftarMemenuhi}`,
    );
  }
  if (ctx.belumCount > 0) {
    summaryLines.push(
      `├ ⏳ <b>${ctx.belumCount} AM belum memenuhi KPI:</b>\n   ${ctx.daftarBelum}`,
    );
  }
  summaryLines.push(
    `└ <b>Ketercapaian KPI tim:</b> ${pctAmDisplay}% AM (${ctx.reachedCount}/${ctx.totalAms})`,
  );

  return [
    `<b>[UPDATE SNAPSHOT SALES ACTIVITY]</b>`,
    ``,
    `Selamat ${ctx.greeting}, ${ctx.managerHonorific} <b>${amNameEsc}</b> 👋`,
    ``,
    `Mohon izin menginformasikan bahwa <b>${officerEsc}</b> baru saja mengunggah data <b>Sales Activity</b> terbaru untuk snapshot <b>${snapshotNameEsc}</b>.`,
    ``,
    ...summaryLines,
    ``,
    `<blockquote>${ctx.kalimatStatus}</blockquote>`,
    ``,
    `Detail per AM bisa dicek lewat tombol di bawah 👇`,
  ].join("\n");
}
