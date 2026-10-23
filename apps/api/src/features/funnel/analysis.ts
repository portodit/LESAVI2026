/**
 * Analisis funnel bersama untuk API publik, dashboard, dan bot Telegram.
 *
 * Satu sumber perhitungan untuk:
 *  - scope data LOP (filter yang sama dengan dashboard: kategori kontrak +
 *    tahun anggaran + auto-filter tersembunyi)
 *  - label pergerakan LOP antar snapshot (baru / naik / turun / stagnan)
 *  - ringkasan per AM (total LOP, nilai, target, capaian, CR, sebaran fase)
 */

import {
  db,
  salesFunnelTable,
  amFunnelTargetTable,
  dataImportsTable,
  accountManagersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

export const FUNNEL_PHASE_LABELS: Record<string, string> = {
  F0: "Lead",
  F1: "Prospect",
  F2: "Quote",
  F3: "Negosiasi",
  F4: "Closing",
  F5: "Win/Closed",
};

const PHASE_ORDER = ["F0", "F1", "F2", "F3", "F4", "F5"];
export const phaseIdx = (f: string | null | undefined): number => {
  const i = PHASE_ORDER.indexOf(f || "");
  return i < 0 ? -1 : i;
};

/** Filter default dashboard (PIVOT F): GTMA + Own Channel, tahun anggaran 2026. */
export const DEFAULT_KATEGORI_KONTRAK = ["GTMA", "Own Channel"];
export const DEFAULT_TAHUN_ANGGARAN = 2026;

export type MovementLabel = "baru" | "naik" | "turun" | "stagnan";

export interface FunnelMovement {
  label: MovementLabel;
  since: string | null;
  from: string | null;
  to: string | null;
  history: { date: string; phase: string }[];
}

export interface FunnelLop {
  lopid: string;
  nikAm: string;
  namaAm: string;
  judulProyek: string | null;
  pelanggan: string | null;
  nilaiProyek: number;
  statusF: string | null;
  kategoriKontrak: string | null;
  divisi: string | null;
  tahunAnggaran: number | null;
  importId: number | null;
}

export interface FunnelScopeOptions {
  kategoriKontrak?: string[] | null;
  tahunAnggaran?: number | null;
  /** Batasi riwayat pada snapshot tertentu (ISO). */
  upToSnapshotDate?: string | null;
}

export interface FunnelScope {
  lops: FunnelLop[];
  movements: Record<string, FunnelMovement>;
  snapshotDates: string[];
  latestSnapshotDate: string | null;
  previousSnapshotDate: string | null;
  amTargets: Record<string, number>;
  kategoriKontrak: string[];
  tahunAnggaran: number | null;
}

const isoDate = (d: Date | string | null | undefined): string =>
  d instanceof Date ? d.toISOString() : String(d ?? "");

const taKey = (l: { tahunAnggaran?: number | null; reportDate?: string | null }): string =>
  String(l.tahunAnggaran ?? (l.reportDate ? String(l.reportDate).slice(0, 4) : ""));

/**
 * Hitung pergerakan LOP antar snapshot funnel (terlama → terbaru).
 *
 * Satu LOP diidentifikasi oleh (nikAm, lopid, tahunAnggaran). Bila satu LOP
 * punya beberapa baris dalam satu snapshot, baris dengan id tertinggi yang
 * dipakai. Label:
 *  - baru     : LOP hanya muncul di satu snapshot
 *  - stagnan  : fase tidak pernah berubah sejak pertama tercatat
 *  - naik     : fase sekarang lebih maju dari fase terakhir yang berbeda
 *  - turun    : fase sekarang lebih mundur dari fase terakhir yang berbeda
 */
export async function computeLopMovements(
  lops: { lopid: string; nikAm: string | null; tahunAnggaran: number | null }[],
  opts: { upToSnapshotDate?: string | null } = {},
): Promise<{ movements: Record<string, FunnelMovement>; snapshotDates: string[] }> {
  const movements: Record<string, FunnelMovement> = {};
  const empty = { movements, snapshotDates: [] as string[] };
  if (lops.length === 0) return empty;

  const snapRows = (
    await db
      .select({ id: dataImportsTable.id, snapshotDate: dataImportsTable.snapshotDate })
      .from(dataImportsTable)
      .where(eq(dataImportsTable.type, "funnel"))
  )
    .filter((s) => s.snapshotDate)
    .map((s) => ({ id: s.id, date: isoDate(s.snapshotDate) }))
    .filter((s) => !opts.upToSnapshotDate || s.date <= opts.upToSnapshotDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const snapshotDates = snapRows.map((s) => s.date);
  const lopIds = [...new Set(lops.map((l) => l.lopid).filter(Boolean))] as string[];
  if (snapRows.length === 0 || lopIds.length === 0) return { movements, snapshotDates };

  const histRows = await db
    .select()
    .from(salesFunnelTable)
    .where(
      and(
        inArray(salesFunnelTable.lopid, lopIds),
        inArray(salesFunnelTable.importId, snapRows.map((s) => s.id)),
      ),
    );

  const snapById = new Map(snapRows.map((s) => [s.id, s.date]));
  const byLop = new Map<string, Map<number, { date: string; phase: string | null; rowId: number }>>();
  for (const r of histRows) {
    if (r.importId == null) continue;
    const key = `${r.nikAm}|${r.lopid}|${taKey(r)}`;
    let perSnap = byLop.get(key);
    if (!perSnap) {
      perSnap = new Map();
      byLop.set(key, perSnap);
    }
    const prev = perSnap.get(r.importId);
    if (!prev || prev.rowId < r.id) {
      perSnap.set(r.importId, {
        date: snapById.get(r.importId) ?? "",
        phase: r.statusF ?? null,
        rowId: r.id,
      });
    }
  }

  for (const l of lops) {
    const perSnap = byLop.get(`${l.nikAm}|${l.lopid}|${taKey(l)}`);
    const entries = perSnap
      ? [...perSnap.values()].sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const phased = entries.filter((e) => e.phase);
    if (phased.length === 0) {
      // LOP tanpa data fase — dianggap baru pada snapshot terakhir yang memuatnya
      const last = entries[entries.length - 1];
      movements[l.lopid] = {
        label: "baru",
        since: last?.date ?? null,
        from: null,
        to: null,
        history: [],
      };
      continue;
    }

    const current = phased[phased.length - 1];
    const history = phased.map((e) => ({ date: e.date, phase: e.phase as string }));
    if (phased.length === 1) {
      movements[l.lopid] = {
        label: "baru",
        since: current.date,
        from: null,
        to: current.phase,
        history,
      };
      continue;
    }

    let lastDiff = -1;
    for (let i = phased.length - 2; i >= 0; i--) {
      if (phased[i].phase !== current.phase) {
        lastDiff = i;
        break;
      }
    }
    if (lastDiff < 0) {
      movements[l.lopid] = {
        label: "stagnan",
        since: phased[0].date,
        from: null,
        to: current.phase,
        history,
      };
      continue;
    }

    const since = phased[lastDiff + 1];
    const up = phaseIdx(current.phase) > phaseIdx(phased[lastDiff].phase);
    movements[l.lopid] = {
      label: up ? "naik" : "turun",
      since: since.date,
      from: phased[lastDiff].phase,
      to: current.phase,
      history,
    };
  }

  return { movements, snapshotDates };
}

/**
 * Muat data funnel dengan scope yang sama dengan dashboard:
 * kategori kontrak (default GTMA + Own Channel) + tahun anggaran (default 2026)
 * + auto-filter tersembunyi (is_report Y, project_type AO/MO, status bukan
 * LOSE/CANCEL, divisi bukan DGS, LOP milik AM aktif).
 */
export async function loadFunnelScope(opts: FunnelScopeOptions = {}): Promise<FunnelScope> {
  const kategoriKontrak = opts.kategoriKontrak ?? DEFAULT_KATEGORI_KONTRAK;
  const tahunAnggaran = opts.tahunAnggaran === undefined ? DEFAULT_TAHUN_ANGGARAN : opts.tahunAnggaran;

  const masterAms = await db.select().from(accountManagersTable);
  const masterNameByNik = new Map(masterAms.map((m) => [m.nik, m.nama]));
  const activeNikSet = new Set(
    masterAms
      .filter((m) => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role || "") && m.nik)
      .map((m) => m.nik as string),
  );

  const rows = await db.select().from(salesFunnelTable);

  // Dedup per LOP ID — LOP sama bisa muncul di beberapa import; ambil importId tertinggi
  const byLopId = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!r.lopid) continue;
    const existing = byLopId.get(r.lopid);
    if (!existing || (r.importId || 0) > (existing.importId || 0)) byLopId.set(r.lopid, r);
  }

  let lops = [...byLopId.values()];

  // Resolusi nama AM dari master
  lops = lops.map((l) => {
    const unresolved = !l.namaAm || l.namaAm === "" || /^\d+$/.test(l.namaAm.trim());
    if (unresolved && l.nikAm && masterNameByNik.has(l.nikAm)) {
      return { ...l, namaAm: masterNameByNik.get(l.nikAm) || l.namaAm };
    }
    return l;
  });

  // Tahun anggaran (fallback ke reportDate.year)
  if (tahunAnggaran != null) {
    lops = lops.filter((l) => {
      const rdYear = l.reportDate ? parseInt(String(l.reportDate).slice(0, 4), 10) : null;
      const ta = l.tahunAnggaran ?? null;
      return ta === tahunAnggaran || (ta == null && rdYear === tahunAnggaran);
    });
  }

  // Auto-filter (sama dengan /api/public/funnel)
  lops = lops.filter((l) => (l.divisi || "").toUpperCase() !== "DGS");
  lops = lops.filter((l) => {
    const v = l.isReport;
    if (!v) return true;
    return v.trim().toUpperCase() === "Y";
  });
  lops = lops.filter((l) => {
    const v = l.projectType;
    if (!v) return true;
    return ["AO", "MO"].includes(v.trim().toUpperCase());
  });
  lops = lops.filter((l) => !["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase()));

  if (kategoriKontrak.length > 0) {
    const wanted = new Set(kategoriKontrak);
    lops = lops.filter((l) => wanted.has(l.kategoriKontrak || ""));
  }

  lops = lops.filter((l) => l.nikAm && activeNikSet.has(l.nikAm));

  const { movements, snapshotDates } = await computeLopMovements(
    lops.map((l) => ({ lopid: l.lopid, nikAm: l.nikAm, tahunAnggaran: l.tahunAnggaran })),
    { upToSnapshotDate: opts.upToSnapshotDate ?? null },
  );

  const amTargets: Record<string, number> = {};
  if (tahunAnggaran != null) {
    const amTargetRows = await db
      .select()
      .from(amFunnelTargetTable)
      .where(eq(amFunnelTargetTable.tahun, tahunAnggaran));
    for (const r of amTargetRows) amTargets[r.nikAm] = r.targetValue || 0;
  }

  return {
    lops: lops.map((l) => ({
      lopid: l.lopid,
      nikAm: l.nikAm as string,
      namaAm: l.namaAm || "",
      judulProyek: l.judulProyek,
      pelanggan: l.pelanggan,
      nilaiProyek: l.nilaiProyek || 0,
      statusF: l.statusF,
      kategoriKontrak: l.kategoriKontrak,
      divisi: l.divisi,
      tahunAnggaran: l.tahunAnggaran,
      importId: l.importId,
    })),
    movements,
    snapshotDates,
    latestSnapshotDate: snapshotDates.length ? snapshotDates[snapshotDates.length - 1] : null,
    previousSnapshotDate: snapshotDates.length > 1 ? snapshotDates[snapshotDates.length - 2] : null,
    amTargets,
    kategoriKontrak,
    tahunAnggaran,
  };
}

// ── Ringkasan per AM ───────────────────────────────────────────────────────

export interface FunnelMovementCounts {
  baru: number;
  naik: number;
  turun: number;
  stagnan: number;
}

export interface FunnelLopHighlight {
  lopid: string;
  nama: string;
  judulProyek: string | null;
  pelanggan: string | null;
  /** Nama AM pemilik LOP. */
  namaAm: string;
  phase: string | null;
  phaseLabel: string;
  from: string | null;
  to: string | null;
  delta: number;
  since: string | null;
  snapshotCount: number;
  nilai: number;
}

export interface AmFunnelSummary {
  nik: string;
  namaAm: string;
  totalLop: number;
  totalNilai: number;
  target: number;
  capaianPct: number;
  overTarget: number;
  crPct: number | null;
  counts: Record<string, number>;
  nilaiByPhase: Record<string, number>;
  movements: FunnelMovementCounts;
  highlights: {
    baru: FunnelLopHighlight | null;
    naik: FunnelLopHighlight | null;
    turun: FunnelLopHighlight | null;
    stagnan: FunnelLopHighlight | null;
  };
  stagnant: FunnelLopHighlight[];
  /** Semua LOP per kategori pergerakan — untuk pengumuman yang memuat daftar lengkap. */
  movementLists: {
    baru: FunnelLopHighlight[];
    naik: FunnelLopHighlight[];
    turun: FunnelLopHighlight[];
    stagnan: FunnelLopHighlight[];
  };
}

function toHighlight(
  lop: FunnelLop,
  mv: FunnelMovement | undefined,
): FunnelLopHighlight {
  const phase = mv?.to ?? lop.statusF ?? null;
  const from = mv?.from ?? null;
  const delta =
    from && phase ? phaseIdx(phase) - phaseIdx(from) : 0;
  return {
    lopid: lop.lopid,
    nama: lop.judulProyek || lop.pelanggan || "",
    judulProyek: lop.judulProyek,
    pelanggan: lop.pelanggan,
    namaAm: lop.namaAm || "",
    phase,
    phaseLabel: FUNNEL_PHASE_LABELS[phase || ""] || "",
    from,
    to: phase,
    delta,
    since: mv?.since ?? null,
    snapshotCount: mv?.history.length ?? 0,
    nilai: lop.nilaiProyek || 0,
  };
}

/** Baris pergerakan satu AM untuk ringkasan level divisi. */
export interface DivisionAmMovementRow {
  nik: string;
  namaAm: string;
  totalLop: number;
  movements: FunnelMovementCounts;
}

/** Ringkasan level divisi: seluruh LOP dari semua AM aktif dalam scope. */
export interface DivisionFunnelSummary {
  totalLop: number;
  totalNilai: number;
  target: number;
  capaianPct: number;
  overTarget: number;
  /** CR berbasis jumlah LOP: nF5 ÷ (nF3+nF4+nF5) — dipakai pesan manager. */
  crPct: number | null;
  /** Jumlah LOP di F5 — pembilang konversi berbasis jumlah LOP. */
  crF5Count: number;
  /** Jumlah LOP di F3+F4+F5 — penyebut konversi berbasis jumlah LOP. */
  crLopCount: number;
  /** LOP yang menyentuh F5 pada snapshot ini (baru muncul atau naik fase). */
  wonCount: number;
  counts: Record<string, number>;
  movements: FunnelMovementCounts;
  /** Persentase LOP stagnan terhadap total LOP divisi. */
  stagnantPct: number;
  /** Baris per AM, sudah diurutkan dari stagnan terbanyak. */
  amRows: DivisionAmMovementRow[];
  /** LOP stagnan di seluruh divisi, terurut dari yang paling lama stagnan. */
  stagnant: FunnelLopHighlight[];
}

/**
 * Ringkasan funnel level divisi.
 *
 * Menggabungkan seluruh AM aktif dalam scope (bukan per AM), dipakai untuk
 * pesan pengumuman ke manager.
 */
export function summarizeDivision(scope: FunnelScope): DivisionFunnelSummary {
  const counts: Record<string, number> = { F0: 0, F1: 0, F2: 0, F3: 0, F4: 0, F5: 0 };
  const movements: FunnelMovementCounts = { baru: 0, naik: 0, turun: 0, stagnan: 0 };
  const amRows: DivisionAmMovementRow[] = [];
  const stagnant: FunnelLopHighlight[] = [];
  let wonCount = 0;

  const nikSet = new Set<string>();
  for (const l of scope.lops) {
    const nik = l.nikAm;
    if (!nikSet.has(nik)) {
      nikSet.add(nik);
      const summary = summarizeAm(scope, nik, l.namaAm || "");
      amRows.push({
        nik,
        namaAm: l.namaAm || "",
        totalLop: summary.totalLop,
        movements: summary.movements,
      });
      for (const st of summary.stagnant) stagnant.push(st);
    }

    const phase = scope.movements[l.lopid]?.to ?? l.statusF ?? "F0";
    if (counts[phase] !== undefined) {
      counts[phase]++;
    }
    const label: MovementLabel = scope.movements[l.lopid]?.label ?? "baru";
    movements[label]++;
    if ((label === "baru" || label === "naik") && phase === "F5") wonCount++;
  }

  const totalNilai = scope.lops.reduce((s, l) => s + (l.nilaiProyek || 0), 0);
  const target = amRows.reduce((s, r) => s + (scope.amTargets[r.nik] ?? 0), 0);
  const capaianPct = target > 0 ? (totalNilai / target) * 100 : 0;
  const crLopCount = (counts.F3 ?? 0) + (counts.F4 ?? 0) + (counts.F5 ?? 0);
  const crPct = crLopCount > 0 ? ((counts.F5 ?? 0) / crLopCount) * 100 : null;

  amRows.sort(
    (a, b) =>
      b.movements.stagnan - a.movements.stagnan ||
      b.movements.naik - a.movements.naik ||
      b.totalLop - a.totalLop ||
      a.namaAm.localeCompare(b.namaAm),
  );

  stagnant.sort((a, b) => {
    if (b.snapshotCount !== a.snapshotCount) return b.snapshotCount - a.snapshotCount;
    return (b.nilai || 0) - (a.nilai || 0);
  });

  return {
    totalLop: scope.lops.length,
    totalNilai,
    target,
    capaianPct,
    overTarget: Math.max(0, totalNilai - target),
    crPct,
    crF5Count: counts.F5 ?? 0,
    crLopCount,
    wonCount,
    counts,
    movements,
    stagnantPct: scope.lops.length > 0 ? (movements.stagnan / scope.lops.length) * 100 : 0,
    amRows,
    stagnant,
  };
}

/** Ringkasan funnel satu AM (LOP + nilai + target + capaian + CR + pergerakan). */
export function summarizeAm(
  scope: FunnelScope,
  nik: string,
  namaAm: string,
): AmFunnelSummary {
  const lops = scope.lops.filter((l) => l.nikAm === nik);
  const counts: Record<string, number> = { F0: 0, F1: 0, F2: 0, F3: 0, F4: 0, F5: 0 };
  const nilaiByPhase: Record<string, number> = { F0: 0, F1: 0, F2: 0, F3: 0, F4: 0, F5: 0 };
  const movementCounts: FunnelMovementCounts = { baru: 0, naik: 0, turun: 0, stagnan: 0 };

  const byLabel: Record<MovementLabel, FunnelLopHighlight[]> = {
    baru: [],
    naik: [],
    turun: [],
    stagnan: [],
  };

  for (const l of lops) {
    const phase = scope.movements[l.lopid]?.to ?? l.statusF ?? "F0";
    if (counts[phase] !== undefined) {
      counts[phase]++;
      nilaiByPhase[phase] += l.nilaiProyek || 0;
    }
    const mv = scope.movements[l.lopid];
    const label: MovementLabel = mv?.label ?? "baru";
    movementCounts[label]++;
    byLabel[label].push(toHighlight(l, mv));
  }

  const totalNilai = lops.reduce((s, l) => s + (l.nilaiProyek || 0), 0);
  const target = scope.amTargets[nik] ?? 0;
  const capaianPct = target > 0 ? (totalNilai / target) * 100 : 0;
  const denom = nilaiByPhase.F3 + nilaiByPhase.F4 + nilaiByPhase.F5;
  const crPct = denom > 0 ? (nilaiByPhase.F5 / denom) * 100 : null;

  // Sorotan: satu LOP per kategori — baru = nilai terbesar, naik/turun = delta
  // terbesar, stagnan = yang paling lama stagnan.
  const pickBy = (items: FunnelLopHighlight[], cmp: (a: FunnelLopHighlight, b: FunnelLopHighlight) => number) =>
    items.length ? items.reduce((best, cur) => (cmp(cur, best) > 0 ? cur : best)) : null;

  const highlights = {
    baru: pickBy(byLabel.baru, (a, b) => a.nilai - b.nilai),
    naik: pickBy(byLabel.naik, (a, b) => a.delta - b.delta),
    turun: pickBy(byLabel.turun, (a, b) => b.delta - a.delta),
    stagnan: pickBy(byLabel.stagnan, (a, b) => a.snapshotCount - b.snapshotCount),
  };

  const stagnant = [...byLabel.stagnan].sort((a, b) => {
    if (b.snapshotCount !== a.snapshotCount) return b.snapshotCount - a.snapshotCount;
    return (b.nilai || 0) - (a.nilai || 0);
  });

  const movementLists = {
    baru: [...byLabel.baru].sort((a, b) => (b.nilai || 0) - (a.nilai || 0)),
    naik: [...byLabel.naik].sort((a, b) => b.delta - a.delta),
    turun: [...byLabel.turun].sort((a, b) => a.delta - b.delta),
    stagnan: stagnant,
  };

  return {
    nik,
    namaAm,
    totalLop: lops.length,
    totalNilai,
    target,
    capaianPct,
    overTarget: Math.max(0, totalNilai - target),
    crPct,
    counts,
    nilaiByPhase,
    movements: movementCounts,
    highlights,
    stagnant,
    movementLists,
  };
}
