import { Router, type IRouter } from "express";
import { db, pool, performanceDataTable, accountManagersTable, dataImportsTable, salesFunnelTable, amFunnelTargetTable } from "@workspace/db";
import { sql, and, eq, gte, lte, inArray, desc } from "drizzle-orm";
import { requirePresentationAuth } from "../../shared/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const router: IRouter = Router();

// GET /api/presentation/am-profile/:nik
// Returns profile data for a specific AM, including:
// - AM info (nama, divisi, badge)
// - Snapshots available
// - Customer-level performance data (komponen_detail parsed)
// - Summary cards
router.get("/am-profile/:nik", requirePresentationAuth, async (req, res): Promise<void> => {
  const rawNik = Array.isArray(req.params.nik) ? req.params.nik[0] : req.params.nik;

  // Look up AM with raw SQL to get photo_url
  const { rows: [amRow] } = await pool.query(
    `SELECT nik, nama, divisi, witel, photo_url FROM account_managers WHERE nik = $1`,
    [rawNik]
  ) as any;
  if (!amRow) { res.status(404).json({ error: "Account Manager tidak ditemukan" }); return; }

  // Look up role via Drizzle
  const [am] = await db.select().from(accountManagersTable)
    .where(eq(accountManagersTable.nik, rawNik));
  if (am.role !== "ACCOUNT_MANAGER" && am.role !== "AM") {
    res.status(403).json({ error: "Akses ditolak" }); return;
  }

  const { snapshotId, divisiCc, tahun, tipeRank, bulan: bulanParam, tipeRevenue } = req.query;

  const tipe = String(tipeRevenue || "Reguler");

  // Available snapshots (performance only)
  const snapshots = await db.select({
    id: dataImportsTable.id,
    period: dataImportsTable.period,
    snapshotDate: dataImportsTable.snapshotDate,
    rowsImported: dataImportsTable.rowsImported,
    createdAt: dataImportsTable.createdAt,
  }).from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.createdAt));

  // Determine which snapshot to use
  let targetSnapshotId: number | null = snapshotId ? parseInt(String(snapshotId)) : null;
  if (!targetSnapshotId && snapshots.length > 0) {
    targetSnapshotId = snapshots[0].id;
  }

  // Build performance query conditions
  const perfConditions: any[] = [eq(performanceDataTable.nik, rawNik)];
  if (targetSnapshotId) {
    perfConditions.push(eq(performanceDataTable.importId, targetSnapshotId));
  }
  if (tahun) {
    const tahunVal = Array.isArray(tahun) ? tahun[0] : tahun;
    const tahunNum = parseInt(String(tahunVal));
    if (!isNaN(tahunNum)) {
      perfConditions.push(eq(performanceDataTable.tahun, tahunNum));
    }
  }

  let perfData = await db.select().from(performanceDataTable)
    .where(and(...perfConditions));

  // Filter by divisi_cc if specified
  console.log("[DEBUG divisi] divisiCc query:", divisiCc);
  if (divisiCc && String(divisiCc) !== "all") {
    perfData = perfData.filter(p => p.divisiCc === String(divisiCc));
    console.log("[DEBUG divisi] after filter perfData count:", perfData.length);
  } else {
    console.log("[DEBUG divisi] no filter, perfData count:", perfData.length);
  }

  // availableBulan from full perfData — BEFORE bulan filter, so dropdown options never shrink
  const availableBulan = [...new Set(perfData.map(r => r.bulan).filter(b => b != null))].sort((a, b) => a - b);

  // Parse bulan as multi-select array — default to ALL available bulan when none specified
  const selectedBulan: number[] = (() => {
    const raw = bulanParam;
    if (!raw) return availableBulan.length > 0 ? availableBulan : [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(b => parseInt(String(b))).filter(b => !isNaN(b) && b >= 1 && b <= 12);
  })();

  // Parse komponen_detail from each row to get per-customer breakdown
  interface CustomerRow {
    nip: string;
    pelanggan: string;
    proporsi: number;
    divisi: string;
    divisiCc: string;
    segmen: string;
    targetTotal: number;
    realTotal: number;
    achRate: number;
    bulan: number;
    tahun: number;
  }

  const customerRows: CustomerRow[] = [];
  for (const row of perfData) {
    if (!row.komponenDetail) continue;
    // Filter by selected bulan if specified
    if (selectedBulan.length > 0 && !selectedBulan.includes(row.bulan)) continue;
    // Filter by divisi: skip rows where parent divisiCc doesn't match filter
    const divisiFilter = divisiCc && String(divisiCc) !== "all" ? String(divisiCc) : null;
    if (divisiFilter && row.divisiCc !== divisiFilter) {
      console.log("[DEBUG] skipping row divisiCc:", row.divisiCc, "filter:", divisiFilter);
      continue;
    }
    try {
      const details = JSON.parse(row.komponenDetail);
      // Support flat format (single object) and grouped format (array)
      const customerList = Array.isArray(details) ? details : (details ? [details] : []);
      // Detect flat format: single object with customer metadata but NO revenue fields
      const isFlatFormat = !Array.isArray(details) && details && (details.pelanggan != null || details.nip != null);
      for (const cust of customerList) {
        // Skip entries where the customer IS the AM themselves
        const custNik = String(cust.nip ?? cust.nipnas ?? "");
        if (custNik === rawNik) continue;

        const divisiFilter = divisiCc && String(divisiCc) !== "all" ? String(divisiCc) : null;
        if (divisiFilter && cust.divisiCc !== divisiFilter && cust.divisi !== divisiFilter) continue;

        // Source for revenue fields: flat format reads from parent row, otherwise from cust
        const src = isFlatFormat ? row : cust;
        // Get typed target/real based on tipeRevenue
        const getTypedVal = (field: string, fallback: number) => {
          const v = (src as any)[field];
          if (v == null || v === "") return fallback;
          const n = Number(v);
          return isNaN(n) ? fallback : n;
        };

        let targetVal: number;
        let realVal: number;

        if (tipe === "Reguler") {
          targetVal = getTypedVal("targetReguler", 0);
          realVal = getTypedVal("realReguler", 0);
          if (targetVal === 0 && realVal === 0) { targetVal = getTypedVal("targetRevenue", 0); realVal = getTypedVal("realRevenue", 0); }
        } else if (tipe === "Sustain") {
          targetVal = getTypedVal("targetSustain", 0);
          realVal = getTypedVal("realSustain", 0);
        } else if (tipe === "Scaling") {
          targetVal = getTypedVal("targetScaling", 0);
          realVal = getTypedVal("realScaling", 0);
        } else if (tipe === "NGTMA") {
          targetVal = getTypedVal("targetNgtma", 0);
          realVal = getTypedVal("realNgtma", 0);
        } else {
          targetVal = getTypedVal("targetRevenue", 0);
          realVal = getTypedVal("realRevenue", 0);
        }

        const propVal = parseFloat(String(cust.proporsi ?? 1));
        const bulan = parseInt(String(cust.bulan ?? row.bulan ?? 0));
        const tahun = parseInt(String(cust.tahun ?? row.tahun ?? 0));

        customerRows.push({
          nip: String(cust.nip ?? cust.nipnas ?? ""),
          pelanggan: String(cust.pelanggan ?? cust.customer ?? ""),
          proporsi: isNaN(propVal) ? 1 : propVal,
          divisi: String(cust.divisi ?? row.divisi ?? ""),
          divisiCc: String(cust.divisiCc ?? row.divisiCc ?? ""),
          segmen: String(cust.lsegmen ?? cust.ssegmen ?? cust.segmen ?? ""),
          targetTotal: targetVal,
          realTotal: realVal,
          achRate: targetVal > 0 ? (realVal / targetVal) * 100 : 0,
          bulan,
          tahun,
        });
      }
    } catch {
      // skip malformed JSON
    }
  }

  // Fallback: if no customerRows from komponenDetail, build from perfData top-level
  // Note: do NOT create customer rows from AM's own data — that would show the AM as their own customer
  // If komponenDetail is empty, customers list stays empty (table shows "Belum ada data")
  // The fallback below is intentionally removed to avoid showing the AM as a customer

  // Aggregate by customer (aggregate by nip/pelanggan)
  const custMap = new Map<string, CustomerRow>();
  for (const c of customerRows) {
    const key = c.nip || c.pelanggan;
    if (!key) continue;
    const existing = custMap.get(key);
    if (!existing) {
      custMap.set(key, { ...c });
    } else {
      existing.targetTotal += c.targetTotal;
      existing.realTotal += c.realTotal;
      existing.achRate = existing.targetTotal > 0 ? (existing.realTotal / existing.targetTotal) * 100 : 0;
    }
  }

  // Fallback: intentionally removed — if komponenDetail has no real customer data,
  // customers stays empty. Showing AM's own data as a customer is wrong.

  const customers = [...custMap.values()].map(c => ({
    nip: c.nip,
    pelanggan: c.pelanggan,
    proporsi: c.proporsi,
    divisi: c.divisiCc || c.divisi,
    segmen: c.segmen,
    targetTotal: c.targetTotal,
    realTotal: c.realTotal,
    achRate: c.achRate,
  }));

  // availableBulan: all months from full perfData (before bulan filter) — stable options
  // selectedBulan: only months where realTotal > 0
  const bulanWithReal = new Map<number, number>();
  for (const r of customerRows) {
    const prev = bulanWithReal.get(r.bulan) ?? 0;
    bulanWithReal.set(r.bulan, prev + r.realTotal);
  }
  const responseAvailableBulan = availableBulan.filter(b => b >= 1 && b <= 12);
  const responseSelectedBulan = availableBulan.filter(b => b >= 1 && b <= 12 && (bulanWithReal.get(b) ?? 0) > 0);

  // Summary cards
  const totalTarget = customers.reduce((s, c) => s + c.targetTotal, 0);
  const totalReal = customers.reduce((s, c) => s + c.realTotal, 0);
  const achRateOverall = totalTarget > 0 ? (totalReal / totalTarget) * 100 : 0;

  // Divisi badge
  const uniqDivisi = [...new Set(amRow.divisi ? [amRow.divisi] : [])];
  const hasDps = uniqDivisi.some(d => ["DPS", "DSS", "DES"].includes(d));
  const hasDgs = uniqDivisi.includes("DGS");
  let badge: string;
  if (hasDps && hasDgs) { badge = "MULTI DIVISION"; }
  else if (hasDgs) { badge = "GOVERNMENT"; }
  else { badge = "ENTERPRISE"; }

  // Snapshot period text
  const currentSnapshot = snapshots.find(s => s.id === targetSnapshotId);
  const periodText = currentSnapshot
    ? (() => {
        const d = currentSnapshot.snapshotDate ? new Date(currentSnapshot.snapshotDate) : (currentSnapshot.createdAt ? new Date(currentSnapshot.createdAt) : null);
        if (!d || isNaN(d.getTime())) return currentSnapshot.period || "-";
        return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
      })()
    : "-";

  res.json({
    am: {
      nik: amRow.nik,
      nama: amRow.nama,
      divisi: amRow.divisi,
      witel: amRow.witel,
      badge,
      photoUrl: amRow.photo_url || null,
    },
    snapshots: snapshots.map(s => ({
      id: s.id,
      period: s.period,
      snapshotDate: s.snapshotDate,
      rowsImported: s.rowsImported,
      label: (() => {
        const d = s.snapshotDate ? new Date(s.snapshotDate) : (s.createdAt ? new Date(s.createdAt) : null);
        if (!d || isNaN(d.getTime())) return s.period || `Snapshot #${s.id}`;
        return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
      })(),
    })),
    selectedSnapshotId: targetSnapshotId,
    filters: {
      availableBulan: responseAvailableBulan,
      selectedBulan: responseSelectedBulan,
      tipeRevenue: tipe,
    },
    customers,
    customerRows,
    summary: {
      totalTarget,
      totalReal,
      achRate: achRateOverall,
      periodText,
      customerCount: customers.length,
    },
  });
});

// GET /api/presentation/am-rank
// Returns rank of current AM among all AMs for given filters
router.get("/am-rank", requirePresentationAuth, async (req, res): Promise<void> => {
  const { snapshotId, tahun, bulan, divisiCc, tipeRevenue, nik: targetNik } = req.query;

  // Determine snapshot
  const snapshots = await db.select().from(dataImportsTable)
    .where(eq(dataImportsTable.type, "performance"))
    .orderBy(desc(dataImportsTable.createdAt));
  let targetSnapshotId: number | null = snapshotId ? parseInt(String(snapshotId)) : null;
  if (!targetSnapshotId && snapshots.length > 0) targetSnapshotId = snapshots[0].id;

  // Get all active AMs
  const allAms = await db.select().from(accountManagersTable)
    .where(and(eq(accountManagersTable.role, "ACCOUNT_MANAGER"), eq(accountManagersTable.aktif, true)));

  const tipeRank = String(tipeRevenue || "Reguler");

  // Determine effective tahun/bulan
  let tahunNum = tahun ? parseInt(String(tahun)) : null;
  let bulanNum = bulan ? parseInt(String(bulan)) : null;
  const isYtdRequest = bulanNum === null; // No bulan passed = YTD request

  // For YTD: find latest bulan with real data, query Jan -> that bulan
  // For CM:  use the specified bulan (or latest if not specified)
  let latestRealBulan = bulanNum;
  let latestRealTahun = tahunNum;

  if (isYtdRequest) {
    // Find the latest month with real data (realReguler + realRevenue > 0)
    const latestReal = await db
      .select({ maxBulan: sql`MAX(${performanceDataTable.bulan})`, maxTahun: sql`MAX(${performanceDataTable.tahun})` })
      .from(performanceDataTable)
      .where(sql`(${performanceDataTable.realReguler} > 0 OR ${performanceDataTable.realRevenue} > 0)`)
      .limit(1);
    if (latestReal[0]?.maxBulan) {
      latestRealBulan = Number(latestReal[0].maxBulan);
      latestRealTahun = Number(latestReal[0].maxTahun);
    }
    if (!latestRealBulan) latestRealBulan = new Date().getMonth() + 1;
    if (!latestRealTahun) latestRealTahun = new Date().getFullYear();
  } else {
    if (!bulanNum) bulanNum = new Date().getMonth() + 1;
    if (!tahunNum) tahunNum = new Date().getFullYear();
    latestRealBulan = bulanNum;
    latestRealTahun = tahunNum;
  }
  const divisiFilter = divisiCc && String(divisiCc) !== "all" ? String(divisiCc) : null;

  const hasTypedCol = (target: any, real: any) => {
    const t = target == null || target === "" ? null : Number(target);
    const r = real == null || real === "" ? null : Number(real);
    return (t != null && t > 0) || (r != null && r > 0);
  };

  const getTyped = (row: any, tipe: string) => {
    const norm = (v: any) => (v == null || v === "" ? 0 : Number(v));
    if (tipe === "Reguler" && hasTypedCol(row.targetReguler, row.realReguler)) return { target: norm(row.targetReguler), real: norm(row.realReguler) };
    if (tipe === "Sustain" && hasTypedCol(row.targetSustain, row.realSustain)) return { target: norm(row.targetSustain), real: norm(row.realSustain) };
    if (tipe === "Scaling" && hasTypedCol(row.targetScaling, row.realScaling)) return { target: norm(row.targetScaling), real: norm(row.realScaling) };
    if (tipe === "NGTMA" && hasTypedCol(row.targetNgtma, row.realNgtma)) return { target: norm(row.targetNgtma), real: norm(row.realNgtma) };
    return { target: norm(row.targetRevenue), real: norm(row.realRevenue) };
  };

  const rankings: { nik: string; nama: string; divisi: string; target: number; real: number; achRate: number }[] = [];

  // YTD: query all months Jan -> latestRealBulan in one DB call per AM (avoids N+1 per month)
  if (isYtdRequest) {
    for (const am of allAms) {
      let cond: any[] = [eq(performanceDataTable.nik, am.nik)];
      if (targetSnapshotId) cond.push(eq(performanceDataTable.importId, targetSnapshotId));
      cond.push(eq(performanceDataTable.tahun, latestRealTahun!));
      cond.push(gte(performanceDataTable.bulan, 1));
      cond.push(lte(performanceDataTable.bulan, latestRealBulan!));

      const rows = await db.select().from(performanceDataTable).where(and(...cond));
      let totalTarget = 0, totalReal = 0;
      for (const row of rows) {
        if (divisiFilter && row.divisiCc !== divisiFilter && row.divisi !== divisiFilter) continue;
        const { target, real } = getTyped(row, tipeRank);
        totalTarget += target; totalReal += real;
      }
      if (totalTarget === 0 && totalReal === 0) continue;
      rankings.push({ nik: am.nik, nama: am.nama, divisi: am.divisi || "", target: totalTarget, real: totalReal, achRate: totalTarget > 0 ? (totalReal / totalTarget) * 100 : 0 });
    }
  } else {
    // CM: single month query
    for (const am of allAms) {
      const cond: any[] = [eq(performanceDataTable.nik, am.nik)];
      if (targetSnapshotId) cond.push(eq(performanceDataTable.importId, targetSnapshotId));
      if (latestRealTahun) cond.push(eq(performanceDataTable.tahun, latestRealTahun));
      cond.push(eq(performanceDataTable.bulan, latestRealBulan!));

      const rows = await db.select().from(performanceDataTable).where(and(...cond));
      if (rows.length === 0) continue;
      let totalTarget = 0, totalReal = 0;
      for (const row of rows) {
        if (divisiFilter && row.divisiCc !== divisiFilter && row.divisi !== divisiFilter) continue;
        const { target, real } = getTyped(row, tipeRank);
        const match = tipeRank === "Reguler" || target > 0 || real > 0;
        if (!match) continue;
        totalTarget += target; totalReal += real;
      }
      if (totalTarget === 0 && totalReal === 0) continue;
      rankings.push({ nik: am.nik, nama: am.nama, divisi: am.divisi || "", target: totalTarget, real: totalReal, achRate: totalTarget > 0 ? (totalReal / totalTarget) * 100 : 0 });
    }
  }

  rankings.sort((a, b) => b.achRate - a.achRate);

  // Also set bulanNum/tahunNum for response (what the UI uses for labels)
  bulanNum = latestRealBulan;
  tahunNum = latestRealTahun;

  const myRank = rankings.findIndex(r => r.nik === String(targetNik)) + 1;
  const myEntry = rankings[myRank - 1];

  res.json({
    rankings: rankings.slice(0, 20),
    totalCount: rankings.length,
    myRank: myRank || null,
    myAchRate: myEntry?.achRate || null,
    bulan: bulanNum,
    tahun: tahunNum,
    tipe: tipeRank,
  });
});

// Multer storage config for AM photos
const uploadsDir = path.resolve(process.cwd(), "..", "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    if (!allowed.includes(ext)) {
      cb(new Error("Hanya format JPG, PNG, GIF, WEBP yang diizinkan"));
      return;
    }
    const hash = crypto.randomBytes(16).toString("hex");
    cb(null, `${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// POST /api/presentation/am-photo
// Upload photo for current AM (session-based)
router.post("/am-photo", requirePresentationAuth, upload.single("photo"), async (req, res): Promise<void> => {
  const token = req.headers["x-presentation-token"] as string;
  if (!token) { res.status(401).json({ error: "Token tidak ditemukan" }); return; }

  const session = await db.query.presentationSessionsTable?.findFirst({
    where: (t: any, { eq }: any) => eq(t.token, token),
  }).catch(() => null);

  if (!session) { res.status(401).json({ error: "Sesi tidak valid" }); return; }

  const targetNik = session.userNik;
  if (!targetNik) { res.status(400).json({ error: "NIK tidak ditemukan di sesi" }); return; }

  if (!req.file) { res.status(400).json({ error: "Tidak ada file diunggah" }); return; }

  const photoUrl = `/uploads/${req.file.filename}`;

  // Use raw SQL to bypass Drizzle type system
  await pool.query(
    `UPDATE account_managers SET photo_url = $1 WHERE nik = $2`,
    [photoUrl, targetNik]
  );

  res.json({ success: true, photoUrl });
});

// GET /api/presentation/am-funnel/:nik
// Returns funnel data for a specific AM: LOP per fase, DPS/DSS capaikan, conversion rate
router.get("/am-funnel/:nik", requirePresentationAuth, async (req, res): Promise<void> => {
  const rawNik = Array.isArray(req.params.nik) ? req.params.nik[0] : req.params.nik;
  const { import_id, tahun: tahunParam, divisi: divisiParam } = req.query;

  // Verify AM exists
  const [am] = await db.select().from(accountManagersTable)
    .where(eq(accountManagersTable.nik, rawNik));
  if (!am) { res.status(404).json({ error: "Account Manager tidak ditemukan" }); return; }

  // Get funnel imports (snapshots)
  const funnelImports = await db.select().from(dataImportsTable)
    .where(eq(dataImportsTable.type, "funnel"))
    .orderBy(desc(dataImportsTable.createdAt));

  // Determine which import to use
  let targetImportId: number | null = import_id ? parseInt(String(import_id)) : null;
  if (!targetImportId && funnelImports.length > 0) {
    targetImportId = funnelImports[0].id;
  }

  // Get all funnel LOPs for this AM from the latest import
  let lops = await db.select().from(salesFunnelTable)
    .where(and(
      eq(salesFunnelTable.nikAm, rawNik),
      ...(targetImportId ? [eq(salesFunnelTable.importId, targetImportId)] : [])
    ));

  // Same auto-filters as main funnel endpoint
  lops = lops.filter(l => (l.isReport || "").toUpperCase() === "Y");
  lops = lops.filter(l => ["AO", "MO"].includes((l.projectType || "").toUpperCase()));
  lops = lops.filter(l => !["LOSE", "CANCEL"].includes((l.statusProyek || "").toUpperCase()));
  lops = lops.filter(l => (l.divisi || "").toUpperCase() !== "DGS");

  // Year filter
  if (tahunParam) {
    const yearNum = Number(tahunParam);
    lops = lops.filter(l => {
      const rdYear = l.reportDate ? parseInt(String(l.reportDate).slice(0, 4), 10) || null : null;
      return rdYear === yearNum;
    });
  }

  // Deduplicate by lopid
  const lopMap = new Map<string, typeof lops[0]>();
  for (const l of lops) {
    const existing = lopMap.get(l.lopid);
    if (!existing || (l.importId || 0) > (existing.importId || 0)) lopMap.set(l.lopid, l);
  }
  lops = [...lopMap.values()];

  // Group by statusF (F0-F5)
  const statusMap: Record<string, { status: string; count: number; totalNilai: number }> = {};
  const allPhases = ["F0", "F1", "F2", "F3", "F4", "F5"];
  for (const p of allPhases) statusMap[p] = { status: p, count: 0, totalNilai: 0 };

  let totalNilai = 0;
  let totalLop = 0;

  for (const l of lops) {
    const s = l.statusF || "Unknown";
    if (!statusMap[s]) statusMap[s] = { status: s, count: 0, totalNilai: 0 };
    statusMap[s].count++;
    statusMap[s].totalNilai += l.nilaiProyek || 0;
    totalNilai += l.nilaiProyek || 0;
    totalLop++;
  }

  const byStatus = allPhases.map(p => statusMap[p]).filter(s => s.count > 0);

  // DPS vs DSS split (based on divisi field)
  let dpsNilai = 0, dpsLop = 0;
  let dssNilai = 0, dssLop = 0;
  for (const l of lops) {
    const div = (l.divisi || "").toUpperCase();
    if (div === "DPS") { dpsNilai += l.nilaiProyek || 0; dpsLop++; }
    else if (div === "DSS") { dssNilai += l.nilaiProyek || 0; dssLop++; }
  }

  // Conversion rate: (F4 + F5) / (F0 + F1 + F2 + F3 + F4 + F5)
  const won = (statusMap["F4"]?.count || 0) + (statusMap["F5"]?.count || 0);
  const conversionRate = totalLop > 0 ? (won / totalLop) * 100 : 0;

  // DPS conversion
  const dpsWon = lops.filter(l => (l.divisi || "").toUpperCase() === "DPS" && ["F4", "F5"].includes(l.statusF || "")).length;
  const dpsConversionRate = dpsLop > 0 ? (dpsWon / dpsLop) * 100 : 0;

  // DSS conversion
  const dssWon = lops.filter(l => (l.divisi || "").toUpperCase() === "DSS" && ["F4", "F5"].includes(l.statusF || "")).length;
  const dssConversionRate = dssLop > 0 ? (dssWon / dssLop) * 100 : 0;

  // AM funnel targets
  const lookupYear = tahunParam ? Number(tahunParam) : new Date().getFullYear();
  const amTargets = await db.select().from(amFunnelTargetTable)
    .where(and(
      eq(amFunnelTargetTable.nikAm, rawNik),
      eq(amFunnelTargetTable.tahun, lookupYear)
    ));

  // DPS/DSS specific targets
  let targetDps = amTargets[0]?.targetValueDps ?? null;
  let targetDss = amTargets[0]?.targetValueDss ?? null;
  let targetTotal = amTargets[0]?.targetValue ?? null;

  // Capaian rates
  const capaikanDps = targetDps && targetDps > 0 ? (dpsNilai / targetDps) * 100 : null;
  const capaikanDss = targetDss && targetDss > 0 ? (dssNilai / targetDss) * 100 : null;
  const capaikanTotal = targetTotal && targetTotal > 0 ? (totalNilai / targetTotal) * 100 : null;

  // Latest snapshot info
  const currentImport = funnelImports.find(imp => imp.id === targetImportId);
  const periodText = currentImport
    ? (() => {
        const d = currentImport.snapshotDate ? new Date(currentImport.snapshotDate) : (currentImport.createdAt ? new Date(currentImport.createdAt) : null);
        if (!d || isNaN(d.getTime())) return currentImport.period || "-";
        return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
      })()
    : "-";

  // Snapshot options for UI
  const snapshots = funnelImports.map(s => ({
    id: s.id,
    period: s.period,
    snapshotDate: s.snapshotDate,
    label: (() => {
      const d = s.snapshotDate ? new Date(s.snapshotDate) : (s.createdAt ? new Date(s.createdAt) : null);
      if (!d || isNaN(d.getTime())) return s.period || `Snapshot #${s.id}`;
      return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
    })(),
  }));

  // Table rows: individual LOPs grouped by statusF
  const lopRows = lops.map(l => ({
    lopid: l.lopid,
    judulProyek: l.judulProyek,
    pelanggan: l.pelanggan,
    nilaiProyek: l.nilaiProyek,
    divisi: l.divisi,
    statusF: l.statusF,
    proses: l.proses,
    reportDate: l.reportDate,
  }));

  res.json({
    snapshots,
    selectedSnapshotId: targetImportId,
    periodText,
    byStatus,
    totalLop,
    totalNilai,
    targetTotal,
    capaikanTotal,
    dps: {
      nilai: dpsNilai,
      lop: dpsLop,
      target: targetDps,
      capaikan: capaikanDps,
      conversionRate: dpsConversionRate,
    },
    dss: {
      nilai: dssNilai,
      lop: dssLop,
      target: targetDss,
      capaikan: capaikanDss,
      conversionRate: dssConversionRate,
    },
    conversionRate,
    lopRows,
  });
});

// DELETE /api/presentation/am-photo
router.delete("/am-photo", requirePresentationAuth, async (req, res): Promise<void> => {
  const token = req.headers["x-presentation-token"] as string;
  if (!token) { res.status(401).json({ error: "Token tidak ditemukan" }); return; }

  const session = await db.query.presentationSessionsTable?.findFirst({
    where: (t: any, { eq }: any) => eq(t.token, token),
  }).catch(() => null);

  if (!session) { res.status(401).json({ error: "Sesi tidak valid" }); return; }

  const targetNik = session.userNik;
  if (!targetNik) { res.status(400).json({ error: "NIK tidak ditemukan di sesi" }); return; }

  // Get current photo
  const { rows: [am] } = await pool.query(
    `SELECT photo_url FROM account_managers WHERE nik = $1`,
    [targetNik]
  ) as any;

  if ((am as any)?.photo_url) {
    const filePath = path.join(uploadsDir, path.basename((am as any).photo_url));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  await pool.query(
    `UPDATE account_managers SET photo_url = NULL WHERE nik = $1`,
    [targetNik]
  );

  res.json({ success: true });
});

export default router;
