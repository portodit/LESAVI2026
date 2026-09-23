import { Router, type IRouter } from "express";
import { db, salesFunnelTable, salesFunnelTargetTable, amFunnelTargetTable, dataImportsTable, accountManagersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../../shared/auth";
import { matchesDivisi, expandDivisi } from "../../shared/divisi";

const router: IRouter = Router();

// ── Snapshots ──────────────────────────────────────────────────────────────────
router.get("/snapshots", requireAuth, async (req, res): Promise<void> => {
  const imports = await db
    .select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel"))
    .orderBy(desc(dataImportsTable.createdAt));

  res.json(imports.map(imp => ({
    id: imp.id,
    period: imp.period,
    rowsImported: imp.rowsImported,
    createdAt: imp.createdAt?.toISOString(),
    snapshotDate: imp.snapshotDate ?? null,
  })));
});

// ── Targets CRUD ───────────────────────────────────────────────────────────────
router.get("/targets", requireAuth, async (req, res): Promise<void> => {
  const targets = await db.select().from(salesFunnelTargetTable).orderBy(desc(salesFunnelTargetTable.tahun));
  res.json(targets);
});

router.post("/targets", requireAuth, async (req, res): Promise<void> => {
  const { divisi, tahun, targetHo, targetFullHo } = req.body;
  if (!tahun) { res.status(400).json({ error: "tahun is required" }); return; }

  const existing = await db.select().from(salesFunnelTargetTable)
    .where(and(
      eq(salesFunnelTargetTable.tahun, Number(tahun)),
      ...(divisi ? [eq(salesFunnelTargetTable.divisi, String(divisi))] : [])
    ));

  if (existing.length > 0) {
    await db.update(salesFunnelTargetTable)
      .set({ targetHo: Number(targetHo) || 0, targetFullHo: Number(targetFullHo) || 0 })
      .where(eq(salesFunnelTargetTable.id, existing[0].id));
    const updated = await db.select().from(salesFunnelTargetTable).where(eq(salesFunnelTargetTable.id, existing[0].id));
    res.json(updated[0]);
  } else {
    const [inserted] = await db.insert(salesFunnelTargetTable).values({
      divisi: divisi ? String(divisi) : null,
      tahun: Number(tahun),
      bulan: null,
      targetHo: Number(targetHo) || 0,
      targetFullHo: Number(targetFullHo) || 0,
    }).returning();
    res.json(inserted);
  }
});

router.delete("/targets/:id", requireAuth, async (req, res): Promise<void> => {
  await db.delete(salesFunnelTargetTable).where(eq(salesFunnelTargetTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── AM Funnel Targets (per-AM annual) ─────────────────────────────────────────
router.get("/am-targets", requireAuth, async (req, res): Promise<void> => {
  const { tahun } = req.query;
  let rows = await db.select().from(amFunnelTargetTable).orderBy(desc(amFunnelTargetTable.tahun));
  if (tahun) rows = rows.filter(r => r.tahun === Number(tahun));
  res.json(rows);
});

router.post("/am-targets", requireAuth, async (req, res): Promise<void> => {
  const { nikAm, tahun, targetValue } = req.body;
  if (!nikAm || !tahun) { res.status(400).json({ error: "nikAm dan tahun wajib diisi" }); return; }
  const existing = await db.select().from(amFunnelTargetTable)
    .where(and(eq(amFunnelTargetTable.nikAm, String(nikAm)), eq(amFunnelTargetTable.tahun, Number(tahun))));
  if (existing.length > 0) {
    const [updated] = await db.update(amFunnelTargetTable)
      .set({ targetValue: Number(targetValue) || 0, updatedAt: new Date() })
      .where(eq(amFunnelTargetTable.id, existing[0].id)).returning();
    res.json(updated);
  } else {
    const [inserted] = await db.insert(amFunnelTargetTable)
      .values({ nikAm: String(nikAm), tahun: Number(tahun), targetValue: Number(targetValue) || 0 }).returning();
    res.json(inserted);
  }
});

router.delete("/am-targets/:id", requireAuth, async (req, res): Promise<void> => {
  await db.delete(amFunnelTargetTable).where(eq(amFunnelTargetTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

// ── Main Funnel Data ───────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { import_id, divisi, status, nama_am, kategori_kontrak, tahun, tahun_list, is_report, project_type } = req.query;

  // Load account_managers for name resolution and AM group filtering
  const masterAms = await db.select().from(accountManagersTable);
  const masterAmByNik = new Map(masterAms.map(m => [m.nik, m.nama]));
  const activeNikSet = new Set(masterAms.filter(m => m.aktif && ["ACCOUNT_MANAGER", "AM"].includes(m.role) && m.nik).map(m => m.nik));

  let allLops = await db.select().from(salesFunnelTable);

  // Resolve null/numeric AM names from master_am (numeric = just a NIK stored as name)
  allLops = allLops.map(l => {
    const isUnresolved = !l.namaAm || l.namaAm === "" || /^\d+$/.test(l.namaAm.trim());
    if (isUnresolved && l.nikAm && masterAmByNik.has(l.nikAm)) {
      return { ...l, namaAm: masterAmByNik.get(l.nikAm) || l.namaAm };
    }
    return l;
  });

  if (import_id) {
    allLops = allLops.filter(l => l.importId === Number(import_id));
  }

  // Deduplicate by lopid — same LOP may appear in multiple imports (e.g. Drive upload + GSheets sync).
  // Keep the row with the highest importId (= most recent import). Only when no specific import_id requested.
  if (!import_id) {
    const lopMap = new Map<string, typeof allLops[0]>();
    for (const l of allLops) {
      const existing = lopMap.get(l.lopid);
      if (!existing || (l.importId || 0) > (existing.importId || 0)) lopMap.set(l.lopid, l);
    }
    allLops = [...lopMap.values()];
  }

  // Multi-year OR logic: tahun_list overrides tahun for LOP filtering
  {
    const listStr = tahun_list as string | undefined;
    const yearNums: number[] = listStr
      ? listStr.split(",").map(Number).filter(n => n > 2000)
      : tahun ? [Number(tahun)] : [];
    if (yearNums.length > 0) {
      allLops = allLops.filter(l => {
        const rdYear = l.reportDate ? parseInt(String(l.reportDate).slice(0, 4), 10) || null : null;
        const ta = l.tahunAnggaran ?? null;
        return yearNums.some(yr => rdYear === yr || ta === yr);
      });
    }
  }
  // Witel Suramadu hanya handle customer DPS dan DSS — singkirkan DGS
  allLops = allLops.filter(l => (l.divisi || "").toUpperCase() !== "DGS");
  if (divisi && String(divisi) !== "all") allLops = allLops.filter(l => matchesDivisi(l.divisi, String(divisi)));
  if (status) allLops = allLops.filter(l => l.statusF === String(status));
  if (nama_am) allLops = allLops.filter(l => l.namaAm?.toLowerCase().includes(String(nama_am).toLowerCase()));
  if (kategori_kontrak) allLops = allLops.filter(l => l.kategoriKontrak === String(kategori_kontrak));
  // ── AUTO FILTERS (sesuai PIVOT F MyTENS, hidden dari UI) ──────────────────
  // 1. is_report = 'Y'    2. project_type ∈ {AO, MO}    3. status_proyek ≠ Lose/Cancel
  allLops = allLops.filter(l => (l.isReport || "").toUpperCase() === "Y");
  allLops = allLops.filter(l => ["AO", "MO"].includes((l.projectType || "").toUpperCase()));
  allLops = allLops.filter(l => !["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase()));
  // Backward-compat no-op: query params ignored (auto-applied above)
  void is_report; void project_type;

  // Only include LOPs from registered AMs (role=AM/ACCOUNT_MANAGER, aktif=true)
  allLops = allLops.filter(l => l.nikAm && activeNikSet.has(l.nikAm));

  const totalLop = allLops.length;
  const totalNilai = allLops.reduce((s, l) => s + (l.nilaiProyek || 0), 0);
  const totalEstRev = allLops.reduce((s, l) => s + (l.estRev || 0), 0);
  // Count only LOPs with identified AMs (has a valid name)
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

  // AM groups: only include master AMs (aktif=true) — filters out DSO/support staff
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

  // Find matching target: yearly target per divisi
  let targetHoVal = 0, targetFullHoVal = 0;
  const targetByDivisi: Record<string, { targetHo: number; targetFullHo: number }> = {};
  const allTargets = await db.select().from(salesFunnelTargetTable)
    .orderBy(desc(salesFunnelTargetTable.tahun));

  if (allTargets.length > 0) {
    const selectedYear = tahun ? Number(tahun) : null;
    const importPeriod = import_id
      ? (await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, Number(import_id))))[0]?.period
      : null;
    const importYear = importPeriod ? Number(importPeriod.slice(0, 4)) : null;
    const lookupYear = selectedYear || importYear;
    const divisiFilter = divisi ? String(divisi) : null;

    let matched = allTargets;
    if (lookupYear) matched = matched.filter(t => t.tahun === lookupYear);

    // Build per-divisi target map (used for LESA split gauge)
    for (const t of matched) {
      if (t.divisi) {
        targetByDivisi[t.divisi] = { targetHo: t.targetHo || 0, targetFullHo: t.targetFullHo || 0 };
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
      // Sum all divisi for that period
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

  // AM-level annual targets
  const selectedYear = tahun ? Number(tahun) : null;
  const importPeriodForAm = import_id
    ? (await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, Number(import_id))))[0]?.period
    : null;
  const lookupYearForAm = selectedYear || (importPeriodForAm ? Number(importPeriodForAm.slice(0, 4)) : new Date().getFullYear());
  const amTargetRows = await db.select().from(amFunnelTargetTable).where(eq(amFunnelTargetTable.tahun, lookupYearForAm));
  const amTargets: Record<string, { id: number; targetValue: number; tahun: number }> = {};
  for (const r of amTargetRows) amTargets[r.nikAm] = { id: r.id, targetValue: r.targetValue, tahun: r.tahun };

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
    amTargetYear: lookupYearForAm,
    masterAms: masterAms.filter(m => m.aktif && m.role === "ACCOUNT_MANAGER" && m.nik).map(m => ({ nik: m.nik, nama: m.nama, divisi: m.divisi })),
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
      tahunAnggaran: l.tahunAnggaran ?? null,
    })),
  });
});

// ── Data Quality Proof (must be before /:nik wildcard) ──────────────────────────
router.get("/data-quality", requireAuth, async (req, res): Promise<void> => {
  const statsRows = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                    AS total_lop,
      COUNT(CASE WHEN divisi='DPS' THEN 1 END)::int                   AS dps_lop,
      COUNT(CASE WHEN divisi='DSS' THEN 1 END)::int                   AS dss_lop,
      COUNT(DISTINCT nik_am)::int                                      AS unique_am_nik,
      COUNT(DISTINCT nama_am)::int                                     AS unique_am_name,
      COUNT(CASE WHEN nama_am IS NULL OR nama_am='' THEN 1 END)::int  AS null_am,
      COUNT(CASE WHEN nama_am='HAVEA PERTIWI' THEN 1 END)::int        AS havea_lop,
      COUNT(CASE WHEN nama_am ~ '^[0-9]+$' THEN 1 END)::int          AS numeric_am_name
    FROM sales_funnel
  `);
  const stats: any = (statsRows as any)[0] ?? (statsRows as any).rows?.[0] ?? {};

  const masterRows = await db.execute(sql`
    SELECT COUNT(*)::int AS active_am FROM account_managers WHERE aktif = true
  `);
  const masterStats: any = (masterRows as any)[0] ?? (masterRows as any).rows?.[0] ?? {};

  res.json({
    totalLop: stats.total_lop,
    dpLop: stats.dps_lop,
    dssLop: stats.dss_lop,
    uniqueAmNik: stats.unique_am_nik,
    uniqueAmName: stats.unique_am_name,
    nullAmRows: stats.null_am,
    numericAmName: stats.numeric_am_name,
    haveaLop: stats.havea_lop,
    activeAm: masterStats.active_am,
    cleaningSteps: [
      { step: "Step 1 — Filter Witel", rule: "witel = SURAMADU (dari ~76.580 baris TREG3)", status: "applied" },
      { step: "Step 2 — Filter Divisi", rule: "divisi = DPS atau DSS (buang RSMES, RBS, dll)", status: "applied" },
      { step: "Step 3 — Reni → Havea", rule: "NIK 850099 → 870022 (unconditional, nama + NIK)", affected: stats.havea_lop, status: "applied" },
      { step: "Step 4 — Validasi NIK", rule: "NIK harus numerik, 4-7 digit (hapus error nik_pembuat_lop)", status: "applied" },
      { step: "Step 5 — Filter is_report = Y", rule: "Hanya LOP yang sudah valid/approved yang masuk laporan (hidden filter Power BI)", status: "applied_on_new_import" },
      { step: "Step 6 — Dedup per lopid", rule: "Tiap lopid hanya 1 baris — ambil report_date terbaru (DISTINCTCOUNT logic)", status: "applied_on_new_import" },
      { step: "Step 7 — Filter AM aktif", rule: "Hanya 12 AM aktif Witel Suramadu, LOP AM lain dibuang", affected: 211, status: "applied" },
      { step: "Step 8 — Filter report_date tahun", rule: "YEAR(report_date) = tahun dipilih (query time, sesuai slicer Date Power BI)", status: "applied_at_query" },
    ],
  });
});

// ── Master AM (redirect to account_managers) ─────────────────────────────────
// NOTE: Must be defined BEFORE /:nik wildcard, otherwise "master-am" matches as a NIK
router.get("/master-am", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(accountManagersTable).execute();
  // Sort: aktif first (desc), then by nama
  rows.sort((a: any, b: any) => {
    if (a.aktif !== b.aktif) return a.aktif ? -1 : 1;
    return (a.nama || "").localeCompare(b.nama || "");
  });
  res.json(rows);
});

router.get("/:nik", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.nik) ? req.params.nik[0] : req.params.nik;
  const lops = await db.select().from(salesFunnelTable).where(eq(salesFunnelTable.nikAm, raw));
  const totalLop = lops.length;
  const totalNilai = lops.reduce((s, l) => s + (l.nilaiProyek || 0), 0);
  const namaAm = lops[0]?.namaAm || "";
  const divisi = lops[0]?.divisi || "";
  res.json({
    nik: raw, namaAm, divisi, totalLop, totalNilai, shortage: 0,
    lops: lops.map(l => ({
      lopid: l.lopid, judulProyek: l.judulProyek, pelanggan: l.pelanggan,
      nilaiProyek: l.nilaiProyek, divisi: l.divisi, statusF: l.statusF,
      statusProyek: l.statusProyek, kategoriKontrak: l.kategoriKontrak,
      estimateBulan: l.estimateBulan, namaAm: l.namaAm, reportDate: l.reportDate || "",
    })),
  });
});

router.post("/master-am", requireAuth, async (req, res): Promise<void> => {
  const { nik, nama, divisi, jabatan, aktif } = req.body;
  if (!nik || !nama) { res.status(400).json({ error: "nik dan nama wajib diisi" }); return; }
  const slug = String(nama).toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
  const [row] = await db.insert(accountManagersTable).values({
    nik: String(nik),
    nama: String(nama).toUpperCase(),
    slug,
    divisi: divisi ? String(divisi) : "DPS",
    jabatan: jabatan ? String(jabatan) : null,
    aktif: aktif !== false,
    witel: "SURAMADU",
  }).onConflictDoNothing().returning();
  res.json(row || { error: "NIK sudah ada" });
});

router.patch("/master-am/:nik", requireAuth, async (req, res): Promise<void> => {
  const { nama, divisi, jabatan, aktif } = req.body;
  const updates: any = {};
  if (nama !== undefined) { updates.nama = String(nama).toUpperCase(); updates.slug = String(nama).toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-"); }
  if (divisi !== undefined) updates.divisi = divisi;
  if (jabatan !== undefined) updates.jabatan = jabatan;
  if (aktif !== undefined) updates.aktif = Boolean(aktif);
  const [row] = await db.update(accountManagersTable).set(updates)
    .where(eq(accountManagersTable.nik, req.params.nik)).returning();
  if (!row) { res.status(404).json({ error: "NIK tidak ditemukan" }); return; }
  res.json(row);
});

router.delete("/master-am/:nik", requireAuth, async (req, res): Promise<void> => {
  await db.delete(accountManagersTable).where(eq(accountManagersTable.nik, req.params.nik));
  res.json({ ok: true });
});

export default router;
