import { Router, type IRouter } from "express";
import { db, salesFunnelTable, salesFunnelTargetTable, amFunnelTargetTable, dataImportsTable, accountManagersTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { matchesDivisi, expandDivisi } from "../../shared/divisi";

const router: IRouter = Router();

const PUBLIC_HEADERS = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "ALLOWALL",
  "Access-Control-Allow-Origin": "*",
};

router.get("/funnel/snapshots", async (req, res): Promise<void> => {
  Object.entries(PUBLIC_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  const imports = await db
    .select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel"));

  const sorted = [...imports].sort((a, b) => {
    const da = a.snapshotDate || a.createdAt?.toISOString() || "";
    const db2 = b.snapshotDate || b.createdAt?.toISOString() || "";
    return db2.localeCompare(da);
  });

  res.json(sorted.map(imp => ({
    id: imp.id,
    period: imp.period,
    rowsImported: imp.rowsImported,
    createdAt: imp.createdAt?.toISOString(),
    snapshotDate: imp.snapshotDate ?? null,
  })));
});

router.get("/funnel", async (req, res): Promise<void> => {
  Object.entries(PUBLIC_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  const { import_id, divisi, status, nama_am, kategori_kontrak, tahun, tahun_list, rd_year, durasi_filter, is_report, project_type } = req.query;

  const masterAms = await db.select().from(accountManagersTable);
  const masterAmByNik = new Map(masterAms.map(m => [m.nik, m.nama]));
  const activeNikSet = new Set(masterAms.filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role) && m.nik).map(m => m.nik));

  let allLops = await db.select().from(salesFunnelTable);

  allLops = allLops.map(l => {
    const isUnresolved = !l.namaAm || l.namaAm === "" || /^\d+$/.test(l.namaAm.trim());
    if (isUnresolved && l.nikAm && masterAmByNik.has(l.nikAm)) {
      return { ...l, namaAm: masterAmByNik.get(l.nikAm) || l.namaAm };
    }
    return l;
  });

  if (import_id) allLops = allLops.filter(l => l.importId === Number(import_id));

  // Deduplicate by lopid — same LOP may appear in multiple imports; keep highest importId.
  if (!import_id) {
    const lopMap = new Map<string, typeof allLops[0]>();
    for (const l of allLops) {
      const existing = lopMap.get(l.lopid);
      if (!existing || (l.importId || 0) > (existing.importId || 0)) lopMap.set(l.lopid, l);
    }
    allLops = [...lopMap.values()];
  }

  // Compute available Tahun Anggaran from all active-AM lops (before tahun filter)
  const availableTahunAnggaran = [...new Set(
    allLops
      .filter(l => l.nikAm && activeNikSet.has(l.nikAm))
      .map(l => l.tahunAnggaran ?? (l.reportDate ? parseInt(String(l.reportDate).slice(0, 4), 10) || null : null))
      .filter((y): y is number => y != null && y > 2000)
  )].sort((a, b) => b - a);

  if (rd_year) {
    // Report Date mode — filter strictly by reportDate.year, tahunAnggaran is irrelevant
    const rdYearNum = Number(rd_year);
    if (rdYearNum > 2000) {
      allLops = allLops.filter(l => {
        const yr = l.reportDate ? parseInt(String(l.reportDate).slice(0, 4), 10) || null : null;
        return yr === rdYearNum;
      });
    }
  } else {
    // Tahun Anggaran mode — tahunAnggaran is the primary key; fall back to reportDate.year only when tahunAnggaran is null.
    const listStr = tahun_list as string | undefined;
    const yearNums: number[] = listStr
      ? listStr.split(",").map(Number).filter(n => n > 2000)
      : tahun ? [Number(tahun)] : [];
    if (yearNums.length > 0) {
      allLops = allLops.filter(l => {
        const rdYear = l.reportDate ? parseInt(String(l.reportDate).slice(0, 4), 10) || null : null;
        const ta = l.tahunAnggaran ?? null;
        return yearNums.some(yr => ta === yr || (ta == null && rdYear === yr));
      });
    }
  }
  // Witel Suramadu hanya handle customer DPS dan DSS — singkirkan DGS
  allLops = allLops.filter(l => (l.divisi || "").toUpperCase() !== "DGS");

  // ── AUTO FILTERS (sesuai PIVOT F MyTENS, hidden dari UI) ──────────────────
  // 1. is_report = 'Y' (hanya LOP yang sudah valid/approved); jika NULL/null-string, inklude (data lama tidak ada is_report)
  allLops = allLops.filter(l => {
    const v = l.isReport;
    if (!v) return true; // null/undefined/empty → inklude
    return v.trim().toUpperCase() === "Y";
  });
  // 2. project_type ∈ {AO, MO}; jika NULL, inklude (data lama tidak ada project_type)
  allLops = allLops.filter(l => {
    const v = l.projectType;
    if (!v) return true; // null/undefined/empty → inklude
    return ["AO", "MO"].includes(v.trim().toUpperCase());
  });
  // 3. status_proyek bukan Lose/Cancel
  allLops = allLops.filter(l => !["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase()));

  if (divisi && String(divisi) !== "all") allLops = allLops.filter(l => matchesDivisi(l.divisi, String(divisi)));
  if (status) allLops = allLops.filter(l => l.statusF === String(status));
  if (nama_am) allLops = allLops.filter(l => l.namaAm?.toLowerCase().includes(String(nama_am).toLowerCase()));
  // kategori_kontrak: support multi-value comma list (e.g. "GTMA,New GTMA,Own Channel")
  if (kategori_kontrak) {
    const wanted = String(kategori_kontrak).split(",").map(s => s.trim()).filter(Boolean);
    if (wanted.length > 0) allLops = allLops.filter(l => wanted.includes(l.kategoriKontrak || ""));
  }
  // is_report and project_type query params kept for backward compat but no-op (already auto-applied above)
  void is_report; void project_type;
  if (durasi_filter === "single_year") allLops = allLops.filter(l => l.monthSubs != null && l.monthSubs <= 12);
  else if (durasi_filter === "multi_year") allLops = allLops.filter(l => l.monthSubs != null && l.monthSubs > 12);

  // Only include LOPs from registered AMs (role=AM, aktif=true) — same rule as activity/performance visualizations
  allLops = allLops.filter(l => l.nikAm && activeNikSet.has(l.nikAm));

  const totalLop = allLops.length;
  const totalNilai = allLops.reduce((s, l) => s + (l.nilaiProyek || 0), 0);
  const totalEstRev = allLops.reduce((s, l) => s + (l.estRev || 0), 0);
  const namedLops = allLops.filter(l => l.namaAm && l.namaAm !== "");
  const amSet = new Set(namedLops.map(l => l.nikAm).filter(Boolean));
  const pelangganSet = new Set(allLops.map(l => l.pelanggan).filter(Boolean));
  const unidentifiedCount = allLops.length - namedLops.length;

  const statusGroups = Object.entries(
    allLops.reduce((acc: any, l) => {
      const s = l.statusF || "Unknown";
      if (!acc[s]) acc[s] = { status: s, count: 0, totalNilai: 0 };
      acc[s].count++;
      acc[s].totalNilai += l.nilaiProyek || 0;
      return acc;
    }, {})
  ).map(([, v]) => v);

  const masterLops = namedLops.filter(l => l.nikAm && activeNikSet.has(l.nikAm));
  const amGroups = Object.entries(
    masterLops.reduce((acc: any, l) => {
      const key = l.nikAm || l.namaAm || "Unknown";
      if (!acc[key]) acc[key] = {
        namaAm: l.namaAm || "", nik: l.nikAm || "", divisi: l.divisi || "",
        totalLop: 0, totalNilai: 0, shortage: 0, statusMap: {}
      };
      acc[key].totalLop++;
      acc[key].totalNilai += l.nilaiProyek || 0;
      const s = l.statusF || "Unknown";
      if (!acc[key].statusMap[s]) acc[key].statusMap[s] = { status: s, count: 0, totalNilai: 0 };
      acc[key].statusMap[s].count++;
      acc[key].statusMap[s].totalNilai += l.nilaiProyek || 0;
      return acc;
    }, {})
  ).map(([, v]: any) => ({
    namaAm: v.namaAm, nik: v.nik, divisi: v.divisi,
    totalLop: v.totalLop, totalNilai: v.totalNilai, shortage: 0,
    byStatus: Object.values(v.statusMap),
  }));

  let targetHoVal = 0, targetFullHoVal = 0;
  const targetByDivisi: Record<string, { targetHo: number; targetFullHo: number }> = {};
  const allTargets = await db.select().from(salesFunnelTargetTable)
    .orderBy(desc(salesFunnelTargetTable.tahun), desc(salesFunnelTargetTable.bulan));

  if (allTargets.length > 0) {
    const selectedYear = tahun ? Number(tahun) : null;
    const importPeriod = import_id
      ? (await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, Number(import_id))))[0]?.period
      : null;
    const importYear = importPeriod ? Number(importPeriod.slice(0, 4)) : null;
    const importMonth = importPeriod ? Number(importPeriod.slice(5, 7)) : null;
    const lookupYear = selectedYear || importYear;
    const lookupMonth = importMonth;
    const divisiFilter = divisi ? String(divisi) : null;

    let matched = allTargets;
    if (lookupYear) matched = matched.filter(t => t.tahun === lookupYear);
    // bulan=null means target berlaku seluruh tahun — tetap match jika bulan tidak dispesifik
    if (lookupMonth) matched = matched.filter(t => t.bulan === null || t.bulan === lookupMonth);

    // Build per-divisi target breakdown
    for (const t of matched) {
      if (t.divisi) {
        if (!targetByDivisi[t.divisi]) targetByDivisi[t.divisi] = { targetHo: 0, targetFullHo: 0 };
        targetByDivisi[t.divisi].targetHo += t.targetHo || 0;
        targetByDivisi[t.divisi].targetFullHo += t.targetFullHo || 0;
      }
    }

    if (divisiFilter && divisiFilter !== "all") {
      const expanded = expandDivisi(divisiFilter);
      const divMatch = matched.filter(t => t.divisi && expanded.includes(t.divisi));
      if (divMatch.length > 0) {
        targetHoVal = divMatch.reduce((s, t) => s + (t.targetHo || 0), 0);
        targetFullHoVal = divMatch.reduce((s, t) => s + (t.targetFullHo || 0), 0);
      }
    } else {
      const withDivisi = matched.filter(t => t.divisi);
      if (withDivisi.length > 0) {
        targetHoVal = withDivisi.reduce((s, t) => s + (t.targetHo || 0), 0);
        targetFullHoVal = withDivisi.reduce((s, t) => s + (t.targetFullHo || 0), 0);
      } else if (matched.length > 0) {
        targetHoVal = matched[0].targetHo || 0;
        targetFullHoVal = matched[0].targetFullHo || 0;
      }
    }
  }

  const shortage = targetFullHoVal > 0 ? targetFullHoVal - totalNilai : 0;

  // ── Pergerakan LOP antar snapshot ───────────────────────────────────────────
  // Bandingkan fase LOP yang sama di setiap snapshot funnel (terlama → terbaru)
  // untuk memberi label BARU / NAIK / TURUN / STAGNAN + tanggal mulai perubahan.
  const PHASE_ORDER = ["F0", "F1", "F2", "F3", "F4", "F5"];
  const phaseIdx = (f: string | null) => { const i = PHASE_ORDER.indexOf(f || ""); return i < 0 ? -1 : i; };
  const movements: Record<string, {
    label: string; since: string | null; from: string | null; to: string | null;
    history: { date: string; phase: string }[];
  }> = {};

  const isoDate = (d: Date | string | null | undefined) => (d instanceof Date ? d.toISOString() : String(d ?? ""));
  const snapRows = (await db
    .select({ id: dataImportsTable.id, snapshotDate: dataImportsTable.snapshotDate })
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel")))
    .filter(s => s.snapshotDate)
    .map(s => ({ id: s.id, date: isoDate(s.snapshotDate) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const lopIds = [...new Set(allLops.map(l => l.lopid).filter(Boolean))] as string[];
  if (snapRows.length > 0 && lopIds.length > 0) {
    const histRows = await db
      .select()
      .from(salesFunnelTable)
      .where(and(
        inArray(salesFunnelTable.lopid, lopIds),
        inArray(salesFunnelTable.importId, snapRows.map(s => s.id))
      ));

    const snapById = new Map(snapRows.map(s => [s.id, s.date]));
    const taKey = (l: any) => String(l.tahunAnggaran ?? (l.reportDate ? String(l.reportDate).slice(0, 4) : ""));
    // satu LOP bisa punya banyak baris dalam satu snapshot — ambil yang paling baru per (LOP, snapshot)
    const byLop = new Map<string, Map<number, { date: string; phase: string | null; rowId: number }>>();
    for (const r of histRows) {
      const key = `${r.nikAm}|${r.lopid}|${taKey(r)}`;
      let perSnap = byLop.get(key);
      if (!perSnap) { perSnap = new Map(); byLop.set(key, perSnap); }
      const prev = perSnap.get(r.importId);
      if (!prev || prev.rowId < r.id) {
        perSnap.set(r.importId, { date: snapById.get(r.importId) ?? "", phase: r.statusF ?? null, rowId: r.id });
      }
    }

    for (const l of allLops) {
      const perSnap = byLop.get(`${l.nikAm}|${l.lopid}|${taKey(l)}`);
      const entries = perSnap
        ? [...perSnap.values()].filter(e => e.phase).sort((a, b) => a.date.localeCompare(b.date))
        : [];
      if (entries.length === 0) continue;

      const current = entries[entries.length - 1];
      const history = entries.map(e => ({ date: e.date, phase: e.phase as string }));
      if (entries.length === 1) {
        movements[l.lopid] = { label: "baru", since: current.date, from: null, to: current.phase, history };
        continue;
      }
      let lastDiff = -1;
      for (let i = entries.length - 2; i >= 0; i--) if (entries[i].phase !== current.phase) { lastDiff = i; break; }
      if (lastDiff < 0) {
        movements[l.lopid] = { label: "stagnan", since: entries[0].date, from: null, to: current.phase, history };
        continue;
      }
      const since = entries[lastDiff + 1];
      const up = phaseIdx(current.phase) > phaseIdx(entries[lastDiff].phase);
      movements[l.lopid] = {
        label: up ? "naik" : "turun",
        since: since.date,
        from: entries[lastDiff].phase,
        to: current.phase,
        history,
      };
    }
  }

  // AM-level annual targets
  const amTargetYear = tahun ? Number(tahun) : (() => {
    const importPeriod = import_id ? null : null; // resolved below
    return new Date().getFullYear();
  })();
  const amTargetRows = await db.select().from(amFunnelTargetTable).where(eq(amFunnelTargetTable.tahun, amTargetYear));
  const amTargets: Record<string, { id: number; targetValue: number; targetValueDss: number | null; targetValueDps: number | null; tahun: number }> = {};
  for (const r of amTargetRows) amTargets[r.nikAm] = { id: r.id, targetValue: r.targetValue, targetValueDss: r.targetValueDss ?? null, targetValueDps: r.targetValueDps ?? null, tahun: r.tahun };

  res.json({
    totalLop, totalNilai, totalEstRev,
    targetHo: targetHoVal,
    targetFullHo: targetFullHoVal,
    targetByDivisi,
    realFullHo: totalNilai,
    shortage,
    amCount: amSet.size,
    pelangganCount: pelangganSet.size,
    unidentifiedLops: unidentifiedCount,
    byStatus: statusGroups,
    byAm: amGroups,
    amTargets,
    amTargetYear,
    availableTahunAnggaran,
    movements,
    lops: allLops.map(l => ({
      id: l.id,
      lopid: l.lopid,
      judulProyek: l.judulProyek,
      pelanggan: l.pelanggan,
      nilaiProyek: l.nilaiProyek,
      estRev: l.estRev ?? null,
      divisi: l.divisi,
      segmen: l.segmen,
      statusF: l.statusF,
      proses: l.proses,
      statusProyek: l.statusProyek,
      kategoriKontrak: l.kategoriKontrak,
      projectType: l.projectType ?? null,
      isReport: l.isReport ?? null,
      estimateBulan: l.estimateBulan,
      monthSubs: l.monthSubs ?? null,
      namaAm: l.namaAm,
      nikAm: l.nikAm,
      reportDate: l.reportDate,
      tahunAnggaran: l.tahunAnggaran,
    })),
  });
});

export default router;
