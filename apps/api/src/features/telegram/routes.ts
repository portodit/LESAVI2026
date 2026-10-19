import { Router, type IRouter } from "express";
import { db, telegramLogsTable, accountManagersTable, appSettingsTable, telegramBotUsersTable, dataImportsTable, telegramAccessCodesTable } from "@workspace/db";
import { eq, desc, inArray, and, isNull, isNotNull, gt } from "drizzle-orm";
import { requireAuth } from "../../shared/auth";
import { checkPermission } from "../../shared/permissions";
import { sendReminderToAllAMs, sendToTelegram, notifyPerformanceSnapshot, notifyActivitySnapshot, notifyManagerActivitySnapshot } from "../telegram/service";
import { getBotUsers, pollOnce } from "./poller";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

/**
 * Generate a random LV-XXXXXX code (mixed alphanumeric, 6 chars after dash).
 */
function generateLVACode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "LV-";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

/**
 * Parse duration string to milliseconds.
 * Formats: "30m", "1h", "2h", "24h" or number of minutes.
 * Default: 30 minutes.
 */
function parseDuration(duration: string | number | undefined): number {
  if (!duration) return 30 * 60 * 1000;
  if (typeof duration === "number") {
    const mins = Math.max(1, Math.min(duration, 24 * 60));
    return mins * 60 * 1000;
  }
  const str = String(duration).trim().toLowerCase();
  if (str.endsWith("m")) {
    const mins = Math.max(1, Math.min(parseInt(str) || 30, 24 * 60));
    return mins * 60 * 1000;
  }
  if (str.endsWith("h")) {
    const hours = Math.max(1, Math.min(parseInt(str) || 1, 24));
    return hours * 60 * 60 * 1000;
  }
  const mins = Math.max(1, Math.min(parseInt(str) || 30, 24 * 60));
  return mins * 60 * 1000;
}

function makeExpiry(duration: string | number | undefined): Date {
  return new Date(Date.now() + parseDuration(duration));
}

function makeBotDeeplink(botUsername: string | null, code: string): string | null {
  return botUsername ? `https://t.me/${botUsername}?start=${code}` : null;
}

router.post("/send", requireAuth, async (req, res): Promise<void> => {
  const { targetNiks, period, includePerformance, includeFunnel, includeActivity, customMessage,
          perfSnapshotId, funnelCurrSnapshotId, funnelPrevSnapshotId, activitySnapshotId } = req.body;

  let effectivePeriod = period as string | undefined;

  // Derive period from funnel or activity snapshot if not explicitly provided
  if (!effectivePeriod && (includeFunnel || includeActivity)) {
    const snapId = funnelCurrSnapshotId || activitySnapshotId;
    if (snapId) {
      const [snap] = await db.select({ period: dataImportsTable.period }).from(dataImportsTable).where(eq(dataImportsTable.id, Number(snapId)));
      effectivePeriod = snap?.period ?? "";
    }
  }

  if (!effectivePeriod) { res.status(400).json({ error: "Period diperlukan — pilih snapshot atau atur periode laporan" }); return; }

  const result = await sendReminderToAllAMs(
    effectivePeriod,
    { includePerformance: !!includePerformance, includeFunnel: !!includeFunnel, includeActivity: !!includeActivity },
    targetNiks || undefined
  );
  res.json(result);
});

router.get("/logs", requireAuth, async (req, res): Promise<void> => {
  const logs = await db.select().from(telegramLogsTable).orderBy(desc(telegramLogsTable.createdAt)).limit(100);
  res.json(logs.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })));
});

router.post("/register-code", requireAuth, async (req, res): Promise<void> => {
  const { amId, duration } = req.body;
  if (!amId) { res.status(400).json({ error: "amId diperlukan" }); return; }

  const [existing] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.id, amId));
  if (!existing) { res.status(404).json({ error: "AM tidak ditemukan" }); return; }

  const code = generateLVACode();
  const expiresAt = makeExpiry(duration);

  await db.update(accountManagersTable).set({
    telegramCode: code,
    telegramCodeExpiry: expiresAt,
  }).where(eq(accountManagersTable.id, amId));

  res.json({ code, expiresAt: expiresAt.toISOString() });
});

// GET /api/telegram/updates — Return combined list of:
// 1. AMs already linked in DB (telegramChatId != null) — always visible after restart
// 2. Any new unlinked users who sent messages since the server last started (in-memory)
router.get("/updates", requireAuth, async (req, res): Promise<void> => {
  try {
    const botUsers = getBotUsers(); // in-memory: users seen since last restart
    const dbBotUsers = await db.select().from(telegramBotUsersTable); // persisted across restarts
    const ams = await db.select().from(accountManagersTable);

    // Build map of chatId → AM info for AMs already linked
    const linkedAms = ams.filter(a => a.telegramChatId);
    const amByChatId = new Map(
      linkedAms.map(a => [a.telegramChatId!, { nik: a.nik, nama: a.nama, id: a.id }])
    );

    // Start with DB-persisted users (survive server restarts)
    const subscriberMap = new Map<string, any>();
    for (const u of dbBotUsers) {
      subscriberMap.set(u.chatId, {
        chatId: u.chatId,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        lastMessage: u.lastMessage,
        lastSeen: u.lastSeen?.toISOString() ?? null,
        linked: amByChatId.has(u.chatId),
        linkedNik: amByChatId.get(u.chatId)?.nik ?? null,
        linkedNama: amByChatId.get(u.chatId)?.nama ?? null,
        linkedAmId: amByChatId.get(u.chatId)?.id ?? null,
      });
    }
    // Merge in-memory (more recent data wins)
    for (const u of botUsers) {
      subscriberMap.set(u.chatId, {
        chatId: u.chatId,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        lastMessage: u.lastMessage,
        lastSeen: u.lastSeen,
        linked: amByChatId.has(u.chatId),
        linkedNik: amByChatId.get(u.chatId)?.nik ?? null,
        linkedNama: amByChatId.get(u.chatId)?.nama ?? null,
        linkedAmId: amByChatId.get(u.chatId)?.id ?? null,
      });
    }

    // Also include AMs already linked in DB, even if they haven't sent a message since restart
    for (const am of linkedAms) {
      if (!subscriberMap.has(am.telegramChatId!)) {
        subscriberMap.set(am.telegramChatId!, {
          chatId: am.telegramChatId!,
          firstName: am.nama, // use AM name as fallback
          lastName: "",
          username: "",
          lastMessage: "(sudah terhubung sebelumnya)",
          lastSeen: null,
          linked: true,
          linkedNik: am.nik,
          linkedNama: am.nama,
          linkedAmId: am.id,
        });
      }
    }

    const subscribers = [...subscriberMap.values()];
    res.json({ subscribers, totalUpdates: subscribers.length });
  } catch {
    res.status(500).json({ error: "Gagal membaca data pengguna bot" });
  }
});

// POST /api/telegram/sync-now — Trigger an immediate poll of Telegram getUpdates
router.post("/sync-now", requireAuth, async (_req, res): Promise<void> => {
  try {
    await pollOnce();
    res.json({ ok: true, message: "Sinkronisasi berhasil" });
  } catch {
    res.status(500).json({ error: "Gagal sinkronisasi dengan Telegram" });
  }
});

// POST /api/telegram/link-am — Manually link a chatId to an AM
router.post("/link-am", requireAuth, async (req, res): Promise<void> => {
  const { amId, chatId } = req.body;
  if (!amId || !chatId) { res.status(400).json({ error: "amId dan chatId wajib diisi" }); return; }

  const [am] = await db.update(accountManagersTable)
    .set({ telegramChatId: String(chatId), telegramCode: null, telegramCodeExpiry: null })
    .where(eq(accountManagersTable.id, Number(amId)))
    .returning();

  if (!am) { res.status(404).json({ error: "AM tidak ditemukan" }); return; }

  const [settings] = await db.select().from(appSettingsTable);
  if (settings?.telegramBotToken) {
    try {
      await sendToTelegram(settings.telegramBotToken, String(chatId),
        `✅ *Berhasil terhubung!*\n\nHalo, *${am.nama}*! 👋\nAkun kamu sudah dihubungkan ke Bot RLEGS Suramadu oleh admin.`
      );
    } catch { /* ignore */ }
  }

  res.json({ ...am, telegramConnected: true, createdAt: am.createdAt.toISOString() });
});

// POST /api/telegram/bulk-generate-codes — Generate codes for all unconnected AMs
router.post("/bulk-generate-codes", requireAuth, async (req, res): Promise<void> => {
  const { duration } = req.body;
  const ams = await db.select().from(accountManagersTable).orderBy(accountManagersTable.nama);
  const unconnected = ams.filter(a => !a.telegramChatId);

  const expiresAt = makeExpiry(duration);
  const results = [];
  for (const am of unconnected) {
    const code = generateLVACode();
    await db.update(accountManagersTable)
      .set({ telegramCode: code, telegramCodeExpiry: expiresAt })
      .where(eq(accountManagersTable.id, am.id));
    results.push({ nama: am.nama, nik: am.nik, divisi: am.divisi, code, expiresAt: expiresAt.toISOString() });
  }

  res.json({ results, total: results.length });
});

// DELETE /api/telegram/unlink-am/:id — Remove telegram link from AM
router.delete("/unlink-am/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  const [am] = await db.update(accountManagersTable)
    .set({ telegramChatId: null })
    .where(eq(accountManagersTable.id, id))
    .returning();
  if (!am) { res.status(404).json({ error: "AM tidak ditemukan" }); return; }
  res.json({ ok: true });
});

// DELETE /api/telegram/unlink-all — Bulk unlink selected or all AMs
router.delete("/unlink-all", requireAuth, async (req, res): Promise<void> => {
  const { amIds } = req.body;
  if (Array.isArray(amIds) && amIds.length > 0) {
    await db.update(accountManagersTable)
      .set({ telegramChatId: null })
      .where(inArray(accountManagersTable.id, amIds.map(Number)));
  } else {
    await db.update(accountManagersTable).set({ telegramChatId: null });
  }
  res.json({ ok: true });
});

// POST /api/telegram/gen-link/:amId — Generate LV-XXXXXX deeplink for an AM
router.post("/gen-link/:amId", requireAuth, async (req, res): Promise<void> => {
  const amId = parseInt(req.params.amId as string, 10);
  const { duration } = req.body;
  if (!amId) { res.status(400).json({ error: "amId tidak valid" }); return; }

  const [existing] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.id, amId));
  if (!existing) { res.status(404).json({ error: "AM tidak ditemukan" }); return; }

  const currentUser = (req as any).user;
  const code = generateLVACode();
  const expiresAt = makeExpiry(duration);

  // Update legacy column (for display purposes)
  await db.update(accountManagersTable)
    .set({ telegramCode: code, telegramCodeExpiry: expiresAt })
    .where(eq(accountManagersTable.id, amId));

  // Also store in telegramAccessCodesTable so the Telegram poller can verify it
  const codeHash = await bcrypt.hash(code, 10);
  await db.insert(telegramAccessCodesTable).values({
    userId: existing.id,
    codeHash,
    createdBy: currentUser?.id ?? null,
    expiresAt,
    status: "ACTIVE",
  });

  const [settings] = await db.select().from(appSettingsTable);
  let botUsername: string | null = null;
  if (settings?.telegramBotToken) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/getMe`);
      const d = await r.json() as { ok: boolean; result?: { username: string } };
      botUsername = d.result?.username ?? null;
    } catch { /* ignore */ }
  }

  const link = makeBotDeeplink(botUsername, code);
  res.json({ code, link, expiresAt: expiresAt.toISOString(), botUsername });
});

// POST /api/telegram/gen-links-bulk — Generate LV-XXXXXX deeplinks for all non-DGS AMs at once
router.post("/gen-links-bulk", requireAuth, async (req, res): Promise<void> => {
  const { duration } = req.body;
  const currentUser = (req as any).user;
  const [settings] = await db.select().from(appSettingsTable);
  let botUsername: string | null = null;
  if (settings?.telegramBotToken) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/getMe`);
      const d = await r.json() as { ok: boolean; result?: { username: string } };
      botUsername = d.result?.username ?? null;
    } catch { /* ignore */ }
  }

  const allAms = await db.select().from(accountManagersTable);
  const nonDgsAms = allAms.filter(a => a.divisi !== "DGS");

  const expiresAt = makeExpiry(duration);
  const results = await Promise.all(nonDgsAms.map(async am => {
    const code = generateLVACode();
    const codeHash = await bcrypt.hash(code, 10);

    // Update legacy column
    await db.update(accountManagersTable)
      .set({ telegramCode: code, telegramCodeExpiry: expiresAt })
      .where(eq(accountManagersTable.id, am.id));

    // Store in telegramAccessCodesTable for poller verification
    await db.insert(telegramAccessCodesTable).values({
      userId: am.id,
      codeHash,
      createdBy: currentUser?.id ?? null,
      expiresAt,
      status: "ACTIVE",
    });

    const link = makeBotDeeplink(botUsername, code);
    return { amId: am.id, nama: am.nama, nik: am.nik, divisi: am.divisi, link, code, connected: !!am.telegramChatId };
  }));

  res.json({ botUsername, expiresAt: expiresAt.toISOString(), results });
});

// POST /api/telegram/access-codes — Generate LV-XXXXXX access code for a user (permission-gated)
router.post("/access-codes", requireAuth, async (req, res): Promise<void> => {
  const { userId, duration } = req.body;
  const currentUser = (req as any).user;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Permission-based check: telegram.access_code.generate
  const canGenerate = await checkPermission(currentUser.id, "telegram.access_code.generate");
  if (!canGenerate) {
    res.status(403).json({ error: "Kamu tidak memiliki izin untuk membuat Kode Verifikasi Telegram." });
    return;
  }

  if (!userId) { res.status(400).json({ error: "userId diperlukan" }); return; }

  const [targetUser] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.id, Number(userId)));
  if (!targetUser) { res.status(404).json({ error: "Pengguna tidak ditemukan" }); return; }

  // Generate LV-XXXXXX code
  const code = generateLVACode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = makeExpiry(duration);

  const [accessCode] = await db.insert(telegramAccessCodesTable).values({
    userId: targetUser.id,
    codeHash,
    createdBy: currentUser.id,
    expiresAt,
    status: "ACTIVE",
  }).returning();

  // Get bot username for deeplink
  const [settings] = await db.select().from(appSettingsTable);
  let botUsername: string | null = null;
  if (settings?.telegramBotToken) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/getMe`);
      const d = await r.json() as { ok: boolean; result?: { username: string } };
      botUsername = d.result?.username ?? null;
    } catch { /* ignore */ }
  }
  const link = makeBotDeeplink(botUsername, code);

  res.json({
    id: accessCode.id,
    code,
    link,
    botUsername,
    userId: targetUser.id,
    userNama: targetUser.nama,
    userNik: targetUser.nik,
    userRole: targetUser.role,
    expiresAt: expiresAt.toISOString(),
  });
});

// GET /api/telegram/access-codes — List active (unused) access codes for a user
router.get("/access-codes", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req.query;
  const currentUser = (req as any).user;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const canGenerate = await checkPermission(currentUser.id, "telegram.access_code.generate");
  if (!canGenerate) {
    res.status(403).json({ error: "Kamu tidak memiliki izin untuk melihat Kode Verifikasi." });
    return;
  }

  const now = new Date();
  let query = db.select({
    id: telegramAccessCodesTable.id,
    userId: telegramAccessCodesTable.userId,
    expiresAt: telegramAccessCodesTable.expiresAt,
    usedAt: telegramAccessCodesTable.usedAt,
    status: telegramAccessCodesTable.status,
    createdAt: telegramAccessCodesTable.createdAt,
  }).from(telegramAccessCodesTable)
    .where(and(
      gt(telegramAccessCodesTable.expiresAt, now),
      eq(telegramAccessCodesTable.status, "ACTIVE")
    ))
    .orderBy(desc(telegramAccessCodesTable.createdAt))
    .limit(50);

  const codes = await query;

  // Enrich with user info
  const userIds = [...new Set(codes.map(c => c.userId))];
  const users = userIds.length > 0
    ? await db.select({ id: accountManagersTable.id, nama: accountManagersTable.nama, nik: accountManagersTable.nik, role: accountManagersTable.role })
        .from(accountManagersTable)
        .where(inArray(accountManagersTable.id, userIds))
    : [];
  const userById = new Map(users.map(u => [u.id, u]));

  res.json(codes.map(c => ({
    ...c,
    user: userById.get(c.userId) ?? null,
    expiresAt: c.expiresAt.toISOString(),
    usedAt: c.usedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  })));
});

// GET /api/telegram/users — All users (all roles) with Telegram connection status
router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const allUsers = await db.select().from(accountManagersTable).orderBy(accountManagersTable.nama);
  res.json(allUsers.map(u => ({
    id: u.id,
    nik: u.nik,
    nama: u.nama,
    email: u.email,
    role: u.role,
    divisi: u.divisi,
    aktif: u.aktif,
    telegramChatId: u.telegramChatId,
    telegramConnected: !!u.telegramChatId,
    telegramLinkedAt: u.telegramLinkedAt?.toISOString() ?? null,
  })));
});

// GET /api/telegram/stats — Lightweight counts for stat cards
router.get("/stats", requireAuth, async (_req, res): Promise<void> => {
  const allUsers = await db.select({ telegramChatId: accountManagersTable.telegramChatId, aktif: accountManagersTable.aktif, divisi: accountManagersTable.divisi })
    .from(accountManagersTable);

  const nonDgs = allUsers.filter(u => u.divisi !== "DGS");
  const connected = nonDgs.filter(u => !!u.telegramChatId);
  const aktifNonDgs = nonDgs.filter(u => u.aktif);

  res.json({
    totalNonDgs: nonDgs.length,
    totalConnected: connected.length,
    totalAktifNonDgs: aktifNonDgs.length,
    totalAktifConnected: aktifNonDgs.filter(u => !!u.telegramChatId).length,
  });
});

// GET /api/telegram/bot-status — Check if bot token is valid
router.get("/bot-status", requireAuth, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(appSettingsTable);
  if (!settings?.telegramBotToken) {
    res.json({ connected: false, botName: null, botUsername: null });
    return;
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/getMe`);
    const data = await resp.json() as { ok: boolean; result?: { first_name: string; username: string }; description?: string };
    if (data.ok && data.result) {
      res.json({ connected: true, botName: data.result.first_name, botUsername: data.result.username });
    } else {
      res.json({ connected: false, botName: null, botUsername: null, error: data.description });
    }
  } catch {
    res.json({ connected: false, botName: null, botUsername: null });
  }
});

// ── Hapus semua akses bot (putuskan semua koneksi Telegram) ─────────────────
router.post("/clear-all-links", requireAuth, async (req, res): Promise<void> => {
  // Count non-null (linked) accounts first
  const linked = await db.select({ id: accountManagersTable.id })
    .from(accountManagersTable)
    .where(isNotNull(accountManagersTable.telegramChatId));
  const clearedCount = linked.length;

  // Clear all telegramChatId, telegramUserId, telegramUsername
  await db.update(accountManagersTable)
    .set({ telegramChatId: null, telegramUserId: null, telegramUsername: null })
    .where(isNotNull(accountManagersTable.telegramChatId));

  // Also clear all access codes
  await db.update(telegramAccessCodesTable)
    .set({ status: "CANCELLED" })
    .where(inArray(telegramAccessCodesTable.status, ["ACTIVE"]));

  res.json({ success: true, clearedCount });
});

// ── Test: trigger performance/activity snapshot notification for any import ID ───────
router.post("/test-notify/:importId", async (req, res): Promise<void> => {
  try {
    const importId = parseInt(req.params.importId, 10);
    if (isNaN(importId)) {
      res.status(400).json({ error: "importId harus angka" });
      return;
    }

    const [imp] = await db.select().from(dataImportsTable).where(eq(dataImportsTable.id, importId));
    if (!imp) {
      res.status(404).json({ error: "Import tidak ditemukan" });
      return;
    }

    const target = String(req.query.target || "all");

    if (imp.type === "performance") {
      if (target === "am") return res.status(400).json({ error: "Performance test only has am target" });
      const result = await notifyPerformanceSnapshot(importId);
      return res.json({ success: true, importId, period: imp.period, type: imp.type, target, ...result });
    }

    if (imp.type === "activity") {
      const uploader = imp.uploadedByNik
        ? await (async () => {
            const [u] = await db.select().from(accountManagersTable).where(eq(accountManagersTable.nik, imp.uploadedByNik!));
            return u ? { nama: u.nama, role: u.role ?? "OFFICER", nik: u.nik ?? undefined } : undefined;
          })()
        : undefined;
      if (target === "am" || target === "all") {
        const r1 = await notifyActivitySnapshot(importId, uploader).catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
        if (target === "am") return res.json({ success: true, importId, period: imp.period, type: imp.type, target, ...r1 });
        const r2 = await notifyManagerActivitySnapshot(importId, uploader).catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
        return res.json({ success: true, importId, period: imp.period, type: imp.type, target, am: r1, manager: r2 });
      }
      if (target === "manager") {
        const r2 = await notifyManagerActivitySnapshot(importId, uploader).catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
        return res.json({ success: true, importId, period: imp.period, type: imp.type, target, manager: r2 });
      }
      return res.status(400).json({ error: `Unknown target: ${target}` });
    }

    res.status(400).json({ error: `Import type ${imp.type} belum disupport test-notify` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/test-notify]", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
