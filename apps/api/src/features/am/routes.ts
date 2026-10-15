import { Router, type IRouter } from "express";
import { db, accountManagersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../../shared/auth";
import { slugify } from "../import/excel";

const router: IRouter = Router();

// Routes are at / (not /am) — mounted at /api/am in app.ts
router.get("/", requireAuth, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const ams = await db.select().from(accountManagersTable).orderBy(accountManagersTable.nama);
  res.json(ams.map(am => ({
    ...am,
    passwordHash: undefined,
    registeredAkun: !!am.passwordHash,
    telegramConnected: !!am.telegramChatId,
    createdAt: am.createdAt.toISOString(),
  })));
});

router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { nik, nama, role, tipe, divisi, segmen, witel, email, telegramChatId, kpiActivity } = req.body;
  if (!nama) {
    res.status(400).json({ error: "Nama wajib diisi" });
    return;
  }

  const resolvedRole = (["OFFICER", "MANAGER", "ACCOUNT_MANAGER", "ADMIN", "INPUTER"].includes(role) ? role : "ACCOUNT_MANAGER") as "OFFICER" | "MANAGER" | "ACCOUNT_MANAGER" | "ADMIN" | "INPUTER";
  const resolvedTipe = (["LESA"].includes(tipe) ? tipe : "LESA") as "LESA";

  if (resolvedRole === "AM" && !divisi) {
    res.status(400).json({ error: "Divisi wajib diisi untuk role AM" });
    return;
  }
  if (!nik && !["OFFICER", "INPUTER"].includes(resolvedRole)) {
    res.status(400).json({ error: "NIK wajib diisi" });
    return;
  }

  const slug = slugify(nama) + "-" + Date.now().toString(36);

  const [am] = await db.insert(accountManagersTable).values({
    nik: nik || null,
    nama,
    slug,
    email: email || null,
    role: resolvedRole,
    tipe: resolvedTipe,
    divisi: divisi || "DPS",
    segmen: segmen || null,
    witel: witel || "SURAMADU",
    telegramChatId: telegramChatId || null,
    kpiActivity: resolvedRole === "AM" ? (kpiActivity ?? null) : 0,
    aktif: true,
    discoveredFrom: "manual",
  } as any).returning();

  res.status(201).json({ ...am, passwordHash: undefined, registeredAkun: !!am.passwordHash, telegramConnected: !!am.telegramChatId, createdAt: am.createdAt.toISOString() });
});

// Toggle aktif status (MUST be before /:id)
router.patch("/:id/aktif", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

  const user = (req as any).user;
  if (!user || !["ADMIN", "OFFICER", "MANAGER", "INPUTER"].includes(user.role)) {
    res.status(403).json({ error: "Hanya Admin, Officer, Manager, atau Inputer yang dapat mengubah status" });
    return;
  }

  const { aktif } = req.body;
  if (typeof aktif !== "boolean") { res.status(400).json({ error: "Field aktif wajib berupa boolean" }); return; }

  const [am] = await db.update(accountManagersTable)
    .set({ aktif })
    .where(eq(accountManagersTable.id, id))
    .returning();
  if (!am) { res.status(404).json({ error: "Anggota tidak ditemukan" }); return; }
  res.json({ ...am, passwordHash: undefined, registeredAkun: !!am.passwordHash, telegramConnected: !!am.telegramChatId, createdAt: am.createdAt.toISOString() });
});

// Individual AM CRUD
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [am] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.id, id));
  if (!am) { res.status(404).json({ error: "Anggota tidak ditemukan" }); return; }
  res.json({ ...am, passwordHash: undefined, registeredAkun: !!am.passwordHash, telegramConnected: !!am.telegramChatId, createdAt: am.createdAt.toISOString() });
});

router.patch("/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const { nama, role, tipe, divisi, segmen, witel, telegramChatId, telegramUsername, telegramDisplayName, kpiActivity, email } = req.body;

  const updates: Partial<typeof accountManagersTable.$inferInsert> = {};
  if (nama !== undefined) { updates.nama = nama; updates.slug = slugify(nama) + "-" + Date.now().toString(36); }
  if (role !== undefined) updates.role = ["OFFICER", "MANAGER", "ACCOUNT_MANAGER", "ADMIN", "INPUTER"].includes(role) ? role : "ACCOUNT_MANAGER";
  if (tipe !== undefined) updates.tipe = ["LESA"].includes(tipe) ? tipe : "LESA";
  if (divisi !== undefined) updates.divisi = divisi;
  if (segmen !== undefined) updates.segmen = segmen;
  if (witel !== undefined) updates.witel = witel;
  if (telegramChatId !== undefined) updates.telegramChatId = telegramChatId || null;
  if (telegramUsername !== undefined) updates.telegramUsername = telegramUsername || null;
  if (telegramDisplayName !== undefined) updates.telegramDisplayName = telegramDisplayName || null;
  if (kpiActivity !== undefined) updates.kpiActivity = kpiActivity;
  if (email !== undefined) updates.email = email || null;

  const [am] = await db.update(accountManagersTable).set(updates).where(eq(accountManagersTable.id, id)).returning();
  if (!am) { res.status(404).json({ error: "Anggota tidak ditemukan" }); return; }
  res.json({ ...am, passwordHash: undefined, registeredAkun: !!am.passwordHash, telegramConnected: !!am.telegramChatId, createdAt: am.createdAt.toISOString() });
});

router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(accountManagersTable).where(eq(accountManagersTable.id, id));
  res.sendStatus(204);
});

// Bulk delete — POST /api/am/bulk-delete with body { ids: number[] }
router.post("/bulk-delete", requireAuth, async (req, res): Promise<void> => {
  const user = (req as any).user;
  if (!user || !["ADMIN", "OFFICER", "MANAGER", "INPUTER"].includes(user.role)) {
    res.status(403).json({ error: "Akses ditolak" });
    return;
  }
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array wajib diisi" });
    return;
  }
  const numericIds = ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
  if (numericIds.length === 0) {
    res.status(400).json({ error: "Tidak ada ID yang valid" });
    return;
  }
  await db.delete(accountManagersTable).where(
    inArray(accountManagersTable.id, numericIds)
  );
  res.json({ deleted: numericIds.length });
});

export default router;
