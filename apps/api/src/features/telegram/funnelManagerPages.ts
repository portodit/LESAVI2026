/**
 * Pesan Telegram versi manager:
 *  - msg 2: pergerakan per AM (dipaginasi, tombol per AM → laporan terkini AM)
 *  - msg 3: AM yang perlu didorong + LOP stagnan terlama + insight (quote)
 *
 * Pagination bersifat stateless: callback memuat ulang data dari DB memakai
 * tanggal snapshot yang disertakan, jadi tetap benar setelah restart server.
 */

import { formatLopTitle, htmlEscape } from "./announcementTemplates";
import { funnelPageCallback, type FunnelButton } from "./funnelPages";
import type { FunnelLopHighlight } from "../funnel/analysis";

/** Jumlah AM per halaman pada daftar pergerakan per AM. */
export const MANAGER_AM_PAGE_SIZE = 6;
/** Jumlah LOP stagnan yang ditampilkan di msg 3. */
export const MANAGER_STAGNANT_CAP = 5;

export interface ManagerAmRow {
  nik: string;
  namaAm: string;
  baru: number;
  naik: number;
  turun: number;
  stagnan: number;
}

export function countManagerAmPages(rows: ManagerAmRow[]): number {
  return Math.max(1, Math.ceil(rows.length / MANAGER_AM_PAGE_SIZE));
}

/**
 * Msg 2: daftar pergerakan per AM.
 *
 * Nomor urut berlanjut antar halaman supaya mudah dikaitkan dengan tombol
 * per AM di bawahnya.
 */
export function renderFunnelManagerAmListPage(
  rows: ManagerAmRow[],
  page: number,
  totalPages: number,
): string {
  const start = page * MANAGER_AM_PAGE_SIZE;
  const slice = rows.slice(start, start + MANAGER_AM_PAGE_SIZE);

  const lines: string[] = [
    `<b>👥 Pergerakan per AM</b>`,
    `(✦ baru | ▲ naik | ▼ turun | ■ stagnan, urut stagnan terbanyak)`,
    ``,
  ];

  slice.forEach((r, i) => {
    lines.push(
      `${start + i + 1}. ${htmlEscape(r.namaAm)}: ✦${r.baru} ▲${r.naik} ▼${r.turun} ■${r.stagnan}`,
    );
  });

  if (totalPages > 1) {
    lines.push(
      ``,
      page < totalPages - 1
        ? `Halaman ${page + 1}/${totalPages} — AM lain bisa dibuka lewat tombol di bawah 👇`
        : `Itu daftar lengkapnya kak — semangat! 💪`,
    );
  }

  return lines.join("\n");
}

export interface ManagerInsightCtx {
  /** AM tanpa LOP naik fase — perlu didorong. */
  needPush: string[];
  /** LOP stagnan, urut dari yang paling lama. */
  stagnant: FunnelLopHighlight[];
  /** Total LOP stagnan di divisi. */
  stagnantTotal: number;
  /** Insight divisi — ditampilkan dalam blockquote. */
  insight: string;
}

/**
 * Msg 3: dorongan ke AM + LOP stagnan terlama + insight divisi.
 */
export function renderFunnelManagerInsightMessage(ctx: ManagerInsightCtx): string {
  const lines: string[] = [];

  if (ctx.needPush.length > 0) {
    const names = ctx.needPush.slice(0, 10).map((n) => htmlEscape(n)).join(", ");
    const more =
      ctx.needPush.length > 10 ? ` dan ${ctx.needPush.length - 10} AM lainnya` : "";
    lines.push(
      `<b>⚠️ Perlu didorong:</b> ${ctx.needPush.length} AM belum ada LOP naik fase: ${names}${more}`,
      ``,
    );
  }

  lines.push(`<b>■ Stagnan terlama di divisi</b>`, ``);
  const shown = ctx.stagnant.slice(0, MANAGER_STAGNANT_CAP);
  shown.forEach((it, i) => {
    lines.push(
      `${i + 1}. ${htmlEscape(formatLopTitle(it.nama, it.lopid))} - ${htmlEscape(it.lopid)} (${htmlEscape(it.namaAm || "")}, ${it.phase}, ${it.snapshotCount} snapshot)`,
      ``,
    );
  });
  const stagnantRest = ctx.stagnantTotal - shown.length;
  if (stagnantRest > 0) {
    lines.push(`…dan ${stagnantRest} LOP stagnan lainnya di laporan`, ``);
  }

  if (ctx.insight) {
    const quoted = ctx.insight
      .split("\n")
      .map((l) => htmlEscape(l))
      .join("\n");
    lines.push(`<blockquote>${quoted}</blockquote>`, ``);
  }

  lines.push(`Detail per AM dan riwayat per LOP ada di tombol di bawah 👇`);

  return lines.join("\n");
}

/** Teks tombol per AM: nomor urut + nama, dipotong agar ringkas. */
function amButtonText(no: number, namaAm: string): string {
  const name = namaAm.length > 26 ? `${namaAm.slice(0, 25)}…` : namaAm;
  return `${no}. ${name}`;
}

/**
 * Keyboard msg 2: tombol per AM + navigasi halaman.
 *
 * Tombol per AM tidak berupa tautan, tapi memunculkan "Laporan Terkini"
 * versi bot AM (isi yang sama persis dengan laporan yang diterima AM).
 */
export function buildManagerAmKeyboard(opts: {
  rows: ManagerAmRow[];
  page: number;
  totalPages: number;
  snapshotDate: string | null;
  extraRows?: FunnelButton[][];
}): { inline_keyboard: FunnelButton[][] } {
  const rowsOut: FunnelButton[][] = [];

  const start = opts.page * MANAGER_AM_PAGE_SIZE;
  const slice = opts.rows.slice(start, start + MANAGER_AM_PAGE_SIZE);

  const buttons: FunnelButton[] = slice.map((r, i) => ({
    text: amButtonText(start + i + 1, r.namaAm),
    callback_data: `mgr:am:${r.nik}`,
  }));

  // Dua tombol per baris supaya keyboard tidak terlalu tinggi.
  for (let i = 0; i < buttons.length; i += 2) {
    rowsOut.push(buttons.slice(i, i + 2));
  }

  if (opts.totalPages > 1) {
    const navRow: FunnelButton[] = [];
    if (opts.page > 0) {
      navRow.push({
        text: "◀️ Halaman Sebelumnya",
        callback_data: funnelPageCallback("mgr", opts.page - 1, opts.snapshotDate),
      });
    }
    navRow.push({ text: `📄 ${opts.page + 1}/${opts.totalPages}`, callback_data: "fn:noop" });
    if (opts.page < opts.totalPages - 1) {
      navRow.push({
        text: "Halaman Selanjutnya ▶️",
        callback_data: funnelPageCallback("mgr", opts.page + 1, opts.snapshotDate),
      });
    }
    rowsOut.push(navRow);
  }

  if (opts.extraRows?.length) rowsOut.push(...opts.extraRows);

  return { inline_keyboard: rowsOut };
}
