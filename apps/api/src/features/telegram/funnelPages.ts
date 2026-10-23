/**
 * Pagination untuk pesan funnel berbasis data:
 *  - [REMINDER LOP STAGNAN] untuk AM
 *  - [UPDATE SNAPSHOT SALES FUNNEL] → daftar LOP per pergerakan
 *
 * Pesan dikirim sebagai notifikasi dorongan, jadi halaman di navigated lewat
 * inline keyboard. Tiap tombol memuat ulang halamannya dari data DB (tidak
 * menyimpan state di memori), sehingga tetap benar setelah restart server.
 */

import { formatLopTitle, htmlEscape, type FunnelHighlightCtx } from "./announcementTemplates";
import {
  FUNNEL_PHASE_LABELS,
  type FunnelLopHighlight,
  type FunnelMovementCounts,
  type FunnelScope,
} from "../funnel/analysis";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tanggal snapshot ringkas: "19 Jun 2026". */
export function formatTanggalPendek(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  return `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

export function buildScopeLabel(scope: FunnelScope): string {
  const kategori = scope.kategoriKontrak.join(", ");
  return scope.tahunAnggaran != null
    ? `${kategori} — Tahun Anggaran ${scope.tahunAnggaran}`
    : kategori;
}

/** Konversi highlight analisis → konteks template (label fase ikut diisi). */
export function toHighlightCtx(h: FunnelLopHighlight): FunnelHighlightCtx {
  const phase = h.phase || "F0";
  return {
    nama: h.nama,
    lopid: h.lopid,
    phase,
    phaseLabel: h.phaseLabel || FUNNEL_PHASE_LABELS[phase] || "",
    from: h.from,
    to: h.to,
    delta: h.delta,
    snapshotCount: h.snapshotCount,
    sinceLabel: formatTanggalPendek(h.since),
    namaAm: h.namaAm,
  };
}

/** Insight level AM: ringkasan pergerakan & ajakan follow-up. */
export function buildInsight(
  movements: FunnelMovementCounts,
  lists: {
    baru: FunnelLopHighlight[];
    naik: FunnelLopHighlight[];
    stagnan: FunnelLopHighlight[];
  },
  totalLop: number,
): string {
  const parts: string[] = [];
  const wonCount =
    lists.baru.filter((l) => l.to === "F5").length +
    lists.naik.filter((l) => l.to === "F5").length;
  if (wonCount > 0) {
    parts.push(`Selamat, terdapat ${wonCount} LOP sudah masuk Win/Closed! 🎉`);
  }
  if (movements.stagnan > 0) {
    const st = lists.stagnan[0];
    parts.push(
      `Namun masih ada ${movements.stagnan} LOP yang belum bergerak, yuk jadi prioritas follow-up${
        st && st.phase
          ? `, terutama yang sudah ${st.snapshotCount} snapshot di ${st.phase}${
              st.phaseLabel ? ` (${st.phaseLabel})` : ""
            }`
          : ""
      } 💪`,
    );
  } else if (parts.length === 0) {
    parts.push(`Semua ${totalLop} LOP kakak bergerak, tetap jaga ritmenya ya! 🔥`);
  } else {
    parts.push(`Semua LOP lain bergerak, tetap jaga ritmenya ya! 🔥`);
  }
  return parts.join(" ");
}

/** Jumlah item per halaman untuk daftar pergerakan LOP. */
export const FUNNEL_PAGE_SIZE = 4;
/** Jumlah item per halaman untuk reminder LOP stagnan. */
export const STAGNANT_PAGE_SIZE = 3;

export type FunnelPageKind = "mov" | "stag" | "mgr";

const PAGE_CALLBACK_PREFIX: Record<FunnelPageKind, string> = {
  mov: "fn:mov",
  stag: "fn:stag",
  mgr: "fn:mgr",
};

/** callback_data halaman. Panjang maksimal Telegram 64 byte — aman untuk "fn:stag:12:2026-10-09". */
export function funnelPageCallback(
  kind: FunnelPageKind,
  page: number,
  snapshotDate: string | null,
): string {
  return `${PAGE_CALLBACK_PREFIX[kind]}:${page + 1}:${snapshotDate || "-"}`;
}

export function parseFunnelPageCallback(
  cbData: string,
): { kind: FunnelPageKind; page: number; snapshotDate: string | null } | null {
  const parts = cbData.split(":");
  const kind = parts[1];
  if (kind !== "mov" && kind !== "stag" && kind !== "mgr") return null;
  const page = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(page) || page < 1) return null;
  const raw = parts.slice(3).join(":");
  return { kind, page: page - 1, snapshotDate: raw && raw !== "-" ? raw : null };
}

// ── Daftar LOP per pergerakan ────────────────────────────────────────────────

export interface FunnelMovementLists {
  baru: FunnelHighlightCtx[];
  naik: FunnelHighlightCtx[];
  turun: FunnelHighlightCtx[];
  stagnan: FunnelHighlightCtx[];
}

interface MovementEntry {
  icon: string;
  title: string;
  /** Jumlah LOP pada kategori ini (untuk judul seksi). */
  count: number;
  /** Nomor urut dalam kategorinya — berlanjut antar halaman. */
  no: number;
  item: FunnelHighlightCtx;
}

const MOVEMENT_SECTIONS: { key: keyof FunnelMovementLists; icon: string; title: string }[] = [
  { key: "baru", icon: "✦", title: "LOP Baru" },
  { key: "naik", icon: "▲", title: "LOP Naik Fase" },
  { key: "turun", icon: "▼", title: "LOP Turun Fase" },
  { key: "stagnan", icon: "■", title: "Stagnan" },
];

function buildMovementEntries(lists: FunnelMovementLists): MovementEntry[] {
  const entries: MovementEntry[] = [];
  for (const s of MOVEMENT_SECTIONS) {
    const items = lists[s.key] ?? [];
    items.forEach((item, i) => {
      entries.push({ icon: s.icon, title: s.title, count: items.length, no: i + 1, item });
    });
  }
  return entries;
}

export interface FunnelLopListPageCtx {
  amName: string;
  snapshotName: string;
  lists: FunnelMovementLists;
}

export function countFunnelPages(lists: FunnelMovementLists): number {
  const total = MOVEMENT_SECTIONS.reduce((n, s) => n + (lists[s.key]?.length ?? 0), 0);
  return Math.max(1, Math.ceil(total / FUNNEL_PAGE_SIZE));
}

/** Status LOP sesuai kategori pergerakan. */
function statusText(icon: string, h: FunnelHighlightCtx): string {
  if (icon === "▲") return `${h.from} naik ke ${h.to}`;
  if (icon === "▼") return `${h.from} turun ke ${h.to}`;
  return `${h.phase} ${h.phaseLabel}`.trim();
}

/** Keterangan/ajakan aksi sesuai kategori pergerakan. */
function keteranganText(icon: string, h: FunnelHighlightCtx): string {
  const next = nextPhaseCode(h.phase);
  const sudahAkhir = next == null;

  if (icon === "▲") {
    return sudahAkhir
      ? `naik fase dari ${h.from} ke ${h.to} sejak snapshot ${h.sinceLabel} 🎉 sudah Win/Closed — lengkapi pencatatan administrative-nya`
      : `naik fase dari ${h.from} ke ${h.to} sejak snapshot ${h.sinceLabel}. Lanjutkan dorongan ke ${next}`;
  }
  if (icon === "▼") {
    return `mundur dari ${h.from} ke ${h.to} sejak snapshot ${h.sinceLabel}. Perlu dicek kendalanya bersama AM`;
  }
  if (icon === "■") {
    return sudahAkhir
      ? `stagnan sejak data snapshot ${h.sinceLabel}. Sudah di fase akhir ${h.phase} ${h.phaseLabel} — tidak perlu didorong, cukup dimonitor`
      : `stagnan sejak data snapshot ${h.sinceLabel}. Segera didorong ke ${next} atau didrop juga lop ini dibatalkan`;
  }
  return sudahAkhir
    ? `baru muncul di snapshot ${h.sinceLabel} 🎉 sudah langsung di fase akhir ${h.phase} ${h.phaseLabel}`
    : `baru muncul di snapshot ${h.sinceLabel}. Segera lengkapi data dan dorong ke ${next}`;
}

/** Detail satu LOP: nama, ID, status, dan keterangan aksi — 4 baris. */
function movementDetailLines(icon: string, no: number, h: FunnelHighlightCtx): string[] {
  return [
    `${no}. <b>Nama LOP:</b> ${htmlEscape(formatLopTitle(h.nama, h.lopid))}`,
    `ID LOP: ${htmlEscape(h.lopid)}`,
    `Status: ${statusText(icon, h)}`,
    `Keterangan: ${keteranganText(icon, h)}`,
  ];
}

/** Urutan fase funnel — untuk menentukan fase berikutnya. */
const PHASE_ORDER = ["F0", "F1", "F2", "F3", "F4", "F5"];

/** Fase berikutnya (mis. F2 → "F3"), null bila sudah fase akhir. */
function nextPhaseCode(phase: string): string | null {
  const i = PHASE_ORDER.indexOf(phase);
  if (i < 0 || i >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[i + 1];
}

/**
 * Halaman daftar LOP beserta pergerakannya.
 *
 * Semua kategori digabung jadi satu aliran item lalu dipaginasi, jadi judul
 * seksi tetap muncul di halaman mana pun itemnya berada dan nomor urut LOP
 * stagnan berlanjut antar halaman.
 */
export function renderFunnelLopListPage(
  ctx: FunnelLopListPageCtx,
  page: number,
  totalPages: number,
): string {
  const entries = buildMovementEntries(ctx.lists);
  const slice = entries.slice(page * FUNNEL_PAGE_SIZE, (page + 1) * FUNNEL_PAGE_SIZE);

  const lines: string[] = [
    page === 0
      ? `<b>✨ List LOP beserta pergerakannya</b>`
      : `<b>✨ List LOP beserta pergerakannya (lanjutan)</b>`,
    ``,
  ];

  let lastIcon = "";
  for (const e of slice) {
    if (e.icon !== lastIcon) {
      lastIcon = e.icon;
      const suffix = e.icon === "■" ? " LOP, terlama dulu" : "";
      lines.push(`<b>${e.icon} ${e.title} (${e.count}${suffix})</b>`);
    }
    lines.push(...movementDetailLines(e.icon, e.no, e.item), ``);
  }

  if (page >= totalPages - 1) {
    lines.push(`<b>Itu daftar lengkapnya kak — semangat! 💪</b>`);
  } else {
    lines.push(`<b>Sisa daftarnya ada di halaman berikutnya 👇</b>`);
  }

  return lines.join("\n");
}

/**
 * Pesan terpisah (terakhir) berisi insight + ajakan membuka rincian.
 *
 * Sengaja dipisah dari pesan daftar LOP: pesan daftar memakai pagination,
 * jadi insight yang menempel di halaman terakhir akan hilang begitu AM
 * pindah halaman.
 */
export function renderFunnelInsightMessage(insight: string): string {
  const lines: string[] = [];
  if (insight) {
    const quoted = insight
      .split("\n")
      .map((l) => htmlEscape(l))
      .join("\n");
    lines.push(`<blockquote>${quoted}</blockquote>`);
  }
  lines.push(`Rincian dan riwayat per LOP ada di tombol di bawah 👇`);
  return lines.join("\n\n");
}

// ── Reminder LOP stagnan ──────────────────────────────────────────────────────

export interface StagnantReminderPageCtx {
  amName: string;
  greeting: string;
  snapshotName: string;
  scopeLabel: string;
  totalStagnant: number;
  /** Seluruh LOP stagnan AM, urut dari yang paling lama. */
  items: FunnelHighlightCtx[];
}

export function countStagnantPages(items: FunnelHighlightCtx[]): number {
  return Math.max(1, Math.ceil(items.length / STAGNANT_PAGE_SIZE));
}

export function renderStagnantReminderPage(
  ctx: StagnantReminderPageCtx,
  page: number,
  totalPages: number,
): string {
  const start = page * STAGNANT_PAGE_SIZE;
  const slice = ctx.items.slice(start, start + STAGNANT_PAGE_SIZE);

  const lines: string[] = [];
  if (page === 0) {
    lines.push(
      `<b>[REMINDER LOP STAGNAN]</b>`,
      ``,
      `Selamat ${ctx.greeting}, kak <b>${htmlEscape(ctx.amName)}</b> 👋`,
      ``,
      `Per snapshot <b>${htmlEscape(ctx.snapshotName)}</b>, ada <b>${ctx.totalStagnant} LOP</b> kakak yang fasenya belum bergerak. Mohon izin mengingatkan untuk ditindaklanjuti sebelum snapshot berikutnya:`,
      ``,
      `<blockquote>ℹ️ Daftar di bawah mencakup LOP kategori kontrak <b>${htmlEscape(ctx.scopeLabel)}</b>.</blockquote>`,
      ``,
      `<b>Diurutkan dari yang paling lama stagnan 👇</b>`,
      ``,
    );
  } else {
    lines.push(
      `<b>[REMINDER LOP STAGNAN] (lanjutan)</b>`,
      ``,
      `Halaman <b>${page + 1}/${totalPages}</b> — LOP stagnan kak <b>${htmlEscape(ctx.amName)}</b> per snapshot <b>${htmlEscape(ctx.snapshotName)}</b>:`,
      ``,
    );
  }

  slice.forEach((it, i) => {
    lines.push(...movementDetailLines("■", start + i + 1, it), ``);
  });

  return lines.join("\n");
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

export interface FunnelButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export function buildFunnelPageKeyboard(opts: {
  kind: FunnelPageKind;
  page: number;
  totalPages: number;
  snapshotDate: string | null;
  extraRows?: FunnelButton[][];
}): { inline_keyboard: FunnelButton[][] } {
  const rows: FunnelButton[][] = [];

  if (opts.totalPages > 1) {
    const navRow: FunnelButton[] = [];
    if (opts.page > 0) {
      navRow.push({
        text: "◀️ Halaman Sebelumnya",
        callback_data: funnelPageCallback(opts.kind, opts.page - 1, opts.snapshotDate),
      });
    }
    navRow.push({ text: `📄 ${opts.page + 1}/${opts.totalPages}`, callback_data: "fn:noop" });
    if (opts.page < opts.totalPages - 1) {
      navRow.push({
        text: "Halaman Selanjutnya ▶️",
        callback_data: funnelPageCallback(opts.kind, opts.page + 1, opts.snapshotDate),
      });
    }
    rows.push(navRow);
  }

  if (opts.extraRows?.length) rows.push(...opts.extraRows);

  return { inline_keyboard: rows };
}
