/**
 * "Laporan Terkini Sales Funneling" versi bot Telegram.
 *
 * Dipakai oleh AM lewat menu bot (callback "funnel:laporan") dan juga oleh
 * manager ketika menekan tombol per AM di pengumuman snapshot — supaya isi
 * yang dilihat manager persis sama dengan laporan yang diterima AM.
 */

import {
  db,
  dataImportsTable,
  salesFunnelTable,
  accountManagersTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export interface LatestFunnelReport {
  /** Ringkasan LOP (F2–F5) + perubahan dibanding snapshot sebelumnya. */
  msg1: string;
  /** Analisis perkembangan LOP — null bila tidak ada snapshot sebelumnya. */
  msg2: string | null;
  /** Jumlah LOP belum bergerak (untuk tombol "Lihat Semua"). */
  stagnantCount: number;
  /** Label snapshot terbaru, mis. "9 Oktober 2026". */
  snapshotLabel: string;
}

function snapshotLabelOf(d: Date | string | null | undefined): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Susun laporan terkini untuk satu AM.
 *
 * Aturan filter sengaja disamakan dengan dashboard publik: kategori kontrak
 * GTMA & Own Channel, LOP aktif dari AM aktif, dan nilai kontrak dihitung
 * per tahun.
 */
export async function buildLatestFunnelReport(
  nik: string,
  nama: string,
  header?: string,
): Promise<LatestFunnelReport | null> {
  const firstName = (nama || "").split(" ")[0];
  const reportYear = new Date().getFullYear().toString();

  const funnelImportsRaw = await db
    .select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel"))
    .orderBy(desc(dataImportsTable.createdAt))
    .limit(10);

  if (funnelImportsRaw.length === 0) return null;

  const latestImport = funnelImportsRaw[0];
  const prevImport = funnelImportsRaw.length >= 2 ? funnelImportsRaw[1] : null;

  const activeAms = await db.select().from(accountManagersTable);
  const activeNikSet = new Set(
    activeAms
      .filter((m) => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role) && m.nik)
      .map((m) => m.nik),
  );

  const allLopsRaw = await db
    .select()
    .from(salesFunnelTable)
    .where(eq(salesFunnelTable.nikAm, nik));

  const lopLatest = new Map<string, (typeof allLopsRaw)[0]>();
  for (const l of allLopsRaw) {
    const existing = lopLatest.get(l.lopid);
    if (!existing || (l.importId || 0) > (existing.importId || 0)) {
      lopLatest.set(l.lopid, l);
    }
  }

  const prevLopIds = new Set<string>();
  if (prevImport) {
    for (const l of allLopsRaw) {
      if (l.importId === prevImport.id) prevLopIds.add(l.lopid);
    }
  }

  const latestSnapYear = latestImport.period
    ? latestImport.period.slice(0, 4)
    : reportYear;

  function isValidLop(l: (typeof allLopsRaw)[0] | undefined): boolean {
    if (!l) return false;
    const rdYear = l.reportDate?.slice(0, 4);
    if (!rdYear || rdYear !== latestSnapYear) return false;
    if (["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase())) return false;
    const vReport = l.isReport;
    if (vReport && vReport.trim().toUpperCase() !== "Y") return false;
    const vType = l.projectType;
    if (vType && !["AO", "MO"].includes(vType.trim().toUpperCase())) return false;
    const kontrak = l.kategoriKontrak || "";
    if (kontrak && !["GTMA", "Own Channel"].includes(kontrak)) return false;
    if (!l.nikAm || !activeNikSet.has(l.nikAm)) return false;
    return true;
  }

  const latestLops = [...lopLatest.values()].filter(isValidLop);
  const prevLops = prevImport
    ? allLopsRaw.filter((l) => prevLopIds.has(l.lopid) && isValidLop(l))
    : [];

  const FCOUNT = (lops: typeof latestLops, status: string) =>
    lops.filter((l) => l.statusF === status).length;
  const FVAL = (lops: typeof latestLops, status: string) =>
    lops.reduce((s, l) => {
      if (l.statusF !== status) return s;
      const m = l.monthSubs;
      const v = Number(l.nilaiProyek || 0);
      return s + (m && m < 12 ? Math.round((v * 12) / m) : v);
    }, 0);
  const fmt = (n: number) =>
    n >= 1e9
      ? `Rp${(n / 1e9).toFixed(2)}M`
      : n >= 1e6
        ? `Rp${(n / 1e6).toFixed(2)}Jt`
        : n >= 1e3
          ? `Rp${(n / 1e3).toFixed(0)}Rb`
          : `Rp${n}`;

  const f2 = FCOUNT(latestLops, "F2");
  const v2 = FVAL(latestLops, "F2");
  const f3 = FCOUNT(latestLops, "F3");
  const v3 = FVAL(latestLops, "F3");
  const f4 = FCOUNT(latestLops, "F4");
  const v4 = FVAL(latestLops, "F4");
  const f5 = FCOUNT(latestLops, "F5");
  const v5 = FVAL(latestLops, "F5");
  const totalProj = f2 + f3 + f4 + f5;
  const totalNilai = v2 + v3 + v4 + v5;

  const currentSnapLabel = snapshotLabelOf(
    latestImport.snapshotDate || latestImport.createdAt?.toISOString().slice(0, 10),
  );

  let msg1 = `${header ? `${header}\n\n` : ""}📋 *LAPORAN TERKINI SALES FUNNELING*\n\n`;
  msg1 += `Kak *${firstName}* — Edisi *${currentSnapLabel}*\n\n`;
  msg1 += `Berikut merupakan laporan perkembangan Sales Funneling LESA VI.\n\n`;
  msg1 += `📅 Report Date : *${latestSnapYear} (semua bulan)*\n`;
  msg1 += `📋 Snapshot    : *#${latestImport.id}*\n`;
  msg1 += `📑 Jenis Kontrak : GTMA & Own Channel\n`;
  msg1 += `🧮 Perhitungan : Nilai Kontrak per Tahun\n\n`;
  msg1 += `📊 *Ringkasan LOP Kakak Saat Ini:*\n\n`;
  msg1 += `├ F2 (Quote)     : ${f2} proyek | ${fmt(v2)}\n`;
  msg1 += `├ F3 (Negosiasi) : ${f3} proyek | ${fmt(v3)}\n`;
  msg1 += `├ F4 (Closing)   : ${f4} proyek | ${fmt(v4)}\n`;
  msg1 += `└ F5 (Win) ✅   : ${f5} proyek | ${fmt(v5)}\n\n`;
  msg1 += `Total LOP        : *${totalProj} proyek | ${fmt(totalNilai)}*\n\n`;

  if (prevImport && prevLops.length > 0) {
    const prevF5_val = FVAL(prevLops, "F5");
    const prevF345 = FVAL(prevLops, "F3") + FVAL(prevLops, "F4") + prevF5_val;
    const prevRate = prevF345 > 0 ? (prevF5_val / prevF345) * 100 : 0;
    const f345 = v3 + v4 + v5;
    const currRate = f345 > 0 ? (v5 / f345) * 100 : 0;
    const diff = currRate - prevRate;
    const fmtRate = (r: number) => `${Math.trunc(r * 10) / 10}%`;
    const prevSnapLabel = snapshotLabelOf(
      prevImport.snapshotDate || prevImport.createdAt?.toISOString().slice(0, 10),
    );

    msg1 += `📈 *Perubahan dibanding snapshot sebelumnya:*\n`;
    msg1 += `Conversion Rate : *${fmtRate(currRate)}* (${diff >= 0 ? "▲" : "▼"} ${fmtRate(Math.abs(diff))} vs ${fmtRate(prevRate)})\n`;
    msg1 += `_Snapshot sebelumnya: #${prevImport.id} (${prevSnapLabel})_`;
  }

  if (!prevImport || prevLops.length === 0) {
    return { msg1, msg2: null, stagnantCount: 0, snapshotLabel: currentSnapLabel };
  }

  const prevMap = new Map(prevLops.map((l) => [l.lopid, l]));
  const stagnan: { lopid: string; pelanggan: string; status: string }[] = [];
  const bergerak: { lopid: string; pelanggan: string; lama: string; baru: string }[] = [];
  const baru: { lopid: string; pelanggan: string; status: string }[] = [];

  for (const lop of latestLops) {
    const prev = prevMap.get(lop.lopid);
    if (!prev) {
      baru.push({
        lopid: lop.lopid,
        pelanggan: lop.pelanggan || "-",
        status: lop.statusF || "-",
      });
      continue;
    }
    const sb = lop.statusF || "";
    const sl = prev.statusF || "";
    if (sb === sl) {
      stagnan.push({
        lopid: lop.lopid,
        pelanggan: lop.pelanggan || "-",
        status: sb,
      });
    } else {
      bergerak.push({
        lopid: lop.lopid,
        pelanggan: lop.pelanggan || "-",
        lama: sl,
        baru: sb,
      });
    }
  }

  const prevSnapLabel = snapshotLabelOf(
    prevImport.snapshotDate || prevImport.createdAt?.toISOString().slice(0, 10),
  );

  let msg2 = `📈 *ANALISIS PERKEMBANGAN LOP*\n\n`;
  msg2 += `Benchmark: Snapshot #${latestImport.id} (terbaru) vs #${prevImport.id} (${prevSnapLabel})\n\n`;

  if (bergerak.length > 0) {
    msg2 += `✅ *LOP Sudah Bergerak (${bergerak.length})*\n`;
    msg2 += `Perubahan status dari snapshot #${prevImport.id} ke #${latestImport.id}:\n\n`;
    for (const l of bergerak) {
      msg2 += `• *${l.lopid}* — ${l.pelanggan}\n`;
      msg2 += `  *${l.lama}* → *${l.baru}*\n\n`;
    }
    msg2 += `\n`;
  }

  if (baru.length > 0) {
    msg2 += `🆕 *LOP Baru Muncul (${baru.length})*\n`;
    msg2 += `LOP yang tidak ada di snapshot #${prevImport.id} (muncul di #${latestImport.id}):\n\n`;
    for (const l of baru) {
      msg2 += `• *${l.lopid}* — ${l.pelanggan}\n`;
      msg2 += `  Status saat ini: *${l.status}*\n\n`;
    }
    msg2 += `\n`;
  }

  const stagnanF5 = stagnan.filter((l) => l.status === "F5");
  const stagnanNon = stagnan.filter((l) => l.status !== "F5");
  const totalTercakup = bergerak.length + baru.length + stagnanNon.length + stagnanF5.length;
  msg2 += `_Total: ${totalTercakup} LOP tercakup dalam analisis_\n\n`;

  if (stagnanNon.length > 0) {
    msg2 += `⚠️ *LOP Belum Bergerak (${stagnanNon.length})*\n`;
    msg2 += `Status masih sama dibanding snapshot #${prevImport.id}:\n\n`;
    const show = stagnanNon.slice(0, 10);
    for (const l of show) {
      msg2 += `• *${l.lopid}* — ${l.pelanggan}\n`;
      msg2 += `  Status tetap *${l.status}* sejak *${prevSnapLabel}*\n\n`;
    }
    if (stagnanNon.length > 10)
      msg2 += `...dan *${stagnanNon.length - 10}* LOP lainnya belum bergerak\n\n`;
  }

  if (stagnanF5.length > 0) {
    msg2 += `🏆 *LOP F5 / Win (${stagnanF5.length})*\n`;
    msg2 += `LOP yang sudah menang dan status tetap *F5* sejak *${prevSnapLabel}* (#${prevImport.id}):\n\n`;
    for (const l of stagnanF5) {
      msg2 += `• *${l.lopid}* — ${l.pelanggan}\n`;
    }
    msg2 += `\n`;
  }

  if (bergerak.length === 0 && baru.length === 0 && stagnanNon.length === 0) {
    msg2 += `✅ *LOP Sudah Bergerak (0)*\n`;
    msg2 += `Tidak ada LOP yang berubah status dari snapshot #${prevImport.id} ke #${latestImport.id}.\n\n`;
  }

  msg2 += `\n💡 *Catatan:*\n`;
  msg2 += `Yuk, segera lakukan follow up dan update progress LOP yang masih belum bergerak agar setiap peluang dapat terus berkembang menuju tahap berikutnya.\n\n`;
  msg2 += `_Pastikan setiap aktivitas dan perkembangan terbaru sudah tercatat agar monitoring Sales Funneling tetap akurat._`;

  return {
    msg1,
    msg2,
    stagnantCount: stagnanNon.length,
    snapshotLabel: currentSnapLabel,
  };
}

/**
 * Pecah pesan panjang menjadi beberapa pesan (batas Telegram 4096 karakter).
 * Pemecahan dilakukan di batas baris supaya isi tidak terpotong di tengah.
 */
export function splitTelegramMessage(text: string, limit = 3800): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
