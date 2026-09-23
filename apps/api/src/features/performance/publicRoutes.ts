import { Router, type IRouter } from "express";
import { db, performanceDataTable, dataImportsTable, accountManagersTable } from "@workspace/db";
import { eq, and, desc, or, inArray } from "drizzle-orm";
import { expandDivisiPerforma } from "../../shared/divisi";

const router: IRouter = Router();

router.get("/performance", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { importId, divisi } = req.query;

  let snapshotId: number | null = null;

  if (importId) {
    snapshotId = parseInt(String(importId));
  } else {
    const latest = await db
      .select()
      .from(dataImportsTable)
      .where(eq(dataImportsTable.type, "performance"))
      .orderBy(desc(dataImportsTable.id))
      .limit(1);
    snapshotId = latest[0]?.id ?? null;
  }

  if (!snapshotId) {
    res.json([]);
    return;
  }

  // Hanya AM yang aktif dan ber-role AM yang boleh tampil di visualisasi
  const activeAms = await db
    .select({ nik: accountManagersTable.nik })
    .from(accountManagersTable)
    .where(and(eq(accountManagersTable.aktif, true), inArray(accountManagersTable.role, ["ACCOUNT_MANAGER", "AM"])));
  const activeNikSet = new Set(activeAms.map(a => a.nik).filter(Boolean) as string[]);

  const conditions = [eq(performanceDataTable.importId, snapshotId)];
  if (divisi && String(divisi) !== "all") {
    const d = String(divisi);
    const expanded = expandDivisiPerforma(d);
    if (d === "DPS" || d === "DSS") {
      // DPS/DSS AMs have divisi='DES' in DB, use divisi_cc to identify
      conditions.push(eq(performanceDataTable.divisiCc, d));
    } else {
      // LESA: match both DPS and DSS via divisi_cc
      if (expanded.length === 1) {
        conditions.push(eq(performanceDataTable.divisi, expanded[0]));
      } else {
        // LESA = DPS + DSS + DES. Use divisi_cc for DPS/DSS, divisi for DES
        conditions.push(
          or(
            inArray(performanceDataTable.divisiCc, ["DPS", "DSS"]),
            eq(performanceDataTable.divisi, "DES")
          )
        );
      }
    }
  }

  const data = await db
    .select()
    .from(performanceDataTable)
    .where(and(...conditions));

  // Filter hanya AM aktif
  const filtered = data.filter(d => d.nik && activeNikSet.has(d.nik));

  res.json(filtered.map(d => ({
    ...d,
    divisi_cc: d.divisiCc,
    createdAt: d.createdAt.toISOString(),
    // Parse numeric fields that come from DB as strings
    tahun: Number(d.tahun),
    bulan: Number(d.bulan),
    targetRevenue: Number(d.targetRevenue),
    realRevenue: Number(d.realRevenue),
    targetReguler: Number(d.targetReguler),
    realReguler: Number(d.realReguler),
    targetSustain: Number(d.targetSustain),
    realSustain: Number(d.realSustain),
    targetScaling: Number(d.targetScaling),
    realScaling: Number(d.realScaling),
    targetNgtma: Number(d.targetNgtma),
    realNgtma: Number(d.realNgtma),
    revenueBase: Number(d.revenueBase),
    revenueBillcom: Number(d.revenueBillcom),
    aRev: Number(d.aRev),
    aNgtma: Number(d.aNgtma),
    aScaling: Number(d.aScaling),
    aSustain: Number(d.aSustain),
    achRate: Number(d.achRate),
    achRateYtd: Number(d.achRateYtd),
    rankAch: Number(d.rankAch),
  })));
});

router.get("/import-history", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const history = await db
    .select()
    .from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.id));

  res.json(history.map(h => ({ ...h, createdAt: h.createdAt.toISOString() })));
});

router.get("/am", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Only ACCOUNT_MANAGER and AM roles — matching what the performance endpoint uses
  const ams = await db
    .select({ nik: accountManagersTable.nik, nama: accountManagersTable.nama, divisi: accountManagersTable.divisi, role: accountManagersTable.role })
    .from(accountManagersTable)
    .where(and(eq(accountManagersTable.aktif, true), inArray(accountManagersTable.role, ["ACCOUNT_MANAGER", "AM"])))
    .orderBy(accountManagersTable.nama);
  res.json(ams);
});

export default router;
