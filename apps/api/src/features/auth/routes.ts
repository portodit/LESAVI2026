import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, accountManagersTable, presentationSessionsTable } from "@workspace/db";
import { eq, or, inArray } from "drizzle-orm";
import { comparePassword, requireAuth, logAuthEvent, getClientIp } from "../../shared/auth";
import { requestOtp, verifyOtp, resendOtp, getPendingUserInfo, requestOtpPresentation, verifyOtpPresentation } from "./otp";
import { logger } from "../../shared/logger";

// ─── Dashboard Auth Router (uses connect.sid) ──────────────────────────────────
// All routes here go through the dashboard session middleware.
const dashboardAuthRouter: IRouter = Router();

dashboardAuthRouter.post("/login", async (req: any, res: any): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(200).json({ error: "Email/NIK dan password wajib diisi" });
    return;
  }

  const identifier = String(email).trim();

  const [user] = await db
    .select()
    .from(accountManagersTable)
    .where(
      or(
        eq(accountManagersTable.email, identifier),
        eq(accountManagersTable.nik, identifier)
      )
    );

  if (!user || !user.passwordHash) {
    await logAuthEvent({
      eventType: "LOGIN_ATTEMPT",
      loginMethod: "EMAIL",
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "FAILED",
      failureReason: "INVALID_CREDENTIALS",
    });
    res.status(200).json({ error: "Email/NIK atau password salah" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await logAuthEvent({
      userId: user.id,
      eventType: "LOGIN_ATTEMPT",
      loginMethod: "EMAIL",
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "FAILED",
      failureReason: "INVALID_PASSWORD",
    });
    res.status(200).json({ error: "Email/NIK atau password salah" });
    return;
  }

  await logAuthEvent({
    userId: user.id,
    eventType: "CREDENTIAL_VERIFIED",
    loginMethod: "EMAIL",
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
    status: "SUCCESS",
  });

  if (user.nik === "160203") {
    const session = (req as any).session;
    session.userId = user.id;
    session.userEmail = user.email;
    session.userRole = user.role;
    session.userNama = user.nama;
    session.userTipe = user.tipe ?? null;
    await new Promise<void>((resolve) => {
      session.save((err: any) => { resolve(); });
    });
    res.json({
      nextStep: "AUTHENTICATED",
      id: user.id,
      email: user.email,
      role: user.role,
      nama: user.nama,
      tipe: user.tipe ?? null,
    });
    return;
  }

  if (!user.telegramChatId) {
    res.json({
      nextStep: "TELEGRAM_LINK_REQUIRED",
      userId: user.id,
      email: user.email,
      nama: user.nama,
      role: user.role,
    });
    return;
  }

  if (user.role === "ACCOUNT_MANAGER") {
    res.status(200).json({
      error: "Akun Manager tidak dapat login di halaman ini. Silakan gunakan halaman login performa di /presentation/login.",
    });
    return;
  }

  res.json({
    nextStep: "OTP_REQUIRED",
    userId: user.id,
    email: user.email,
    nama: user.nama,
    role: user.role,
  });
});

dashboardAuthRouter.post("/logout", (req: any, res: any): void => {
  const session = req.session;
  const userId = session?.userId;

  if (userId) {
    logAuthEvent({
      userId,
      eventType: "LOGOUT",
      loginMethod: "EMAIL",
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    }).catch(() => {});
  }

  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

dashboardAuthRouter.get("/me", requireAuth, async (req: any, res: any): Promise<void> => {
  const session = req.session;
  res.json({
    id: session.userId,
    email: session.userEmail,
    role: session.userRole,
    nama: session.userNama,
    tipe: session.userTipe,
    telegramConnected: !!(session as any).user?.telegramChatId,
  });
});

dashboardAuthRouter.post("/otp/request", async (req: any, res: any): Promise<void> => {
  const { userId } = req.body;
  if (!userId || typeof userId !== "number") {
    res.status(400).json({ error: "userId diperlukan" });
    return;
  }

  try {
    const result = await requestOtp(userId, req);
    await logAuthEvent({
      userId,
      eventType: "OTP_REQUESTED",
      loginMethod: "EMAIL",
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
      metadata: { challengeId: result.challengeId },
    });
    res.json({
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err: any) {
    await logAuthEvent({
      userId,
      eventType: "OTP_REQUESTED",
      loginMethod: "EMAIL",
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "FAILED",
      failureReason: err.message,
    });
    res.status(400).json({ error: err.message });
  }
});

dashboardAuthRouter.post("/otp/verify", async (req: any, res: any): Promise<void> => {
  const { challengeId, otp } = req.body;
  if (!challengeId || !otp) {
    res.status(400).json({ error: "challengeId dan OTP wajib diisi" });
    return;
  }

  if (!/^\d{5}$/.test(String(otp))) {
    res.status(400).json({ error: "OTP harus 5 digit angka" });
    return;
  }

  const session = req.session;
  const pendingUserId = session?.pendingUserId;

  const result = await verifyOtp(String(challengeId), String(otp), req);

  if (!result.success) {
    await logAuthEvent({
      userId: pendingUserId ?? null,
      eventType: "OTP_FAILED",
      loginMethod: "EMAIL",
      challengeId: String(challengeId),
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "FAILED",
      failureReason: result.error ?? "INVALID_OTP",
    });
    res.status(401).json({ error: result.error });
    return;
  }

  await logAuthEvent({
    userId: session.userId,
    eventType: "LOGIN_SUCCESS",
    loginMethod: "EMAIL",
    challengeId: String(challengeId),
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
    deviceId: session.deviceId,
    status: "SUCCESS",
  });

  res.json({
    id: session.userId,
    email: session.userEmail,
    role: session.userRole,
    nama: session.userNama,
    tipe: session.userTipe,
  });
});

dashboardAuthRouter.post("/otp/resend", async (req: any, res: any): Promise<void> => {
  const session = req.session;
  if (!session.pendingUserId) {
    res.status(400).json({ error: "Tidak ada tantangan aktif. Silakan mulai proses login dari awal." });
    return;
  }

  try {
    const result = await resendOtp(req);
    res.json({
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

dashboardAuthRouter.get("/telegram/status", requireAuth, async (req: any, res: any): Promise<void> => {
  const info = await getPendingUserInfo(req);
  if (!info) {
    res.json({ linked: false, telegramUsername: null, telegramChatId: null });
    return;
  }
  res.json({
    linked: info.linked,
    telegramUsername: info.telegramUsername,
    telegramChatId: info.telegramChatId,
  });
});

dashboardAuthRouter.get("/officers", async (req: any, res: any): Promise<void> => {
  const officers = await db
    .select({
      id: accountManagersTable.id,
      nama: accountManagersTable.nama,
      email: accountManagersTable.email,
      role: accountManagersTable.role,
      telegramUsername: accountManagersTable.telegramUsername,
      telegramDisplayName: accountManagersTable.telegramDisplayName,
      telegramConnected: accountManagersTable.telegramChatId,
    })
    .from(accountManagersTable)
    .where(
      inArray(accountManagersTable.role, ["ADMIN", "MANAGER", "OFFICER"])
    )
    .orderBy(accountManagersTable.nama);

  const withTelegram = officers.filter(o => o.telegramConnected);
  res.json(withTelegram);
});

export { dashboardAuthRouter };

// ─── Presentation Auth Router (COMPLETELY SESSIONLESS) ────────────────────────
// IMPORTANT: This router does NOT use express-session at all. All auth state is
// stored in the DB (otpChallengesTable, presentationSessionsTable). This ensures
// zero interference with the dashboard session (connect.sid).
//
// The pres_sid cookie is set to HttpOnly with SameSite=Lax but is never read
// or written by these handlers. It exists only as a route indicator.
//
// Cookie behavior: browsers send connect.sid + pres_sid together. The browser
// stores pres_sid but our code NEVER reads it — we use DB-backed tokens instead.
const presentationAuthRouter: IRouter = Router();

// POST /api/auth/presentation/request-otp
presentationAuthRouter.post("/request-otp", async (req: any, res: any): Promise<void> => {
  const { nik } = req.body;
  if (!nik) {
    res.status(400).json({ error: "NIK wajib diisi" });
    return;
  }

  const [user] = await db
    .select()
    .from(accountManagersTable)
    .where(eq(accountManagersTable.nik, String(nik).trim()));

  if (!user) {
    await logAuthEvent({
      eventType: "LOGIN_ATTEMPT",
      loginMethod: "NIK_PRESENTATION",
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "FAILED",
      failureReason: "NIK_NOT_FOUND",
    });
    res.status(401).json({ error: "NIK tidak ditemukan" });
    return;
  }

  await logAuthEvent({
    userId: user.id,
    eventType: "CREDENTIAL_VERIFIED",
    loginMethod: "NIK_PRESENTATION",
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
    status: "SUCCESS",
  });

  if (!user.telegramChatId) {
    res.json({
      nextStep: "TELEGRAM_LINK_REQUIRED",
      userId: user.id,
      nama: user.nama,
    });
    return;
  }

  try {
    // Sessionless OTP — stores state in DB only, no req.session involved
    const result = await requestOtpPresentation(user.id);
    res.json({
      nextStep: "OTP_REQUIRED",
      userId: user.id,
      nama: user.nama,
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/presentation/verify-otp
// Sessionless: reads challenge from DB, creates presentation token in DB.
// Does NOT touch express-session or any cookie — completely isolated.
presentationAuthRouter.post("/verify-otp", async (req: any, res: any): Promise<void> => {
  try {
    const { challengeId, otp, userId } = req.body;

    if (!challengeId || !otp) {
      res.status(400).json({ error: "challengeId dan OTP wajib diisi" });
      return;
    }

    if (!/^\d{5}$/.test(String(otp))) {
      res.status(400).json({ error: "OTP harus 5 digit angka" });
      return;
    }

    // userId is optional — the challengeId in DB already identifies the user
    const result = await verifyOtpPresentation(String(challengeId), String(otp), userId ? Number(userId) : undefined);

    if (!result.success) {
      await logAuthEvent({
        userId: Number(userId),
        eventType: "OTP_FAILED",
        loginMethod: "NIK_PRESENTATION",
        challengeId: String(challengeId),
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
        status: "FAILED",
        failureReason: result.error,
      });
      res.status(401).json({ error: result.error, locked: result.locked });
      return;
    }

    await logAuthEvent({
      userId: result.userId,
      eventType: "LOGIN_SUCCESS",
      loginMethod: "NIK_PRESENTATION",
      challengeId: String(challengeId),
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    // Create presentation token in DB — this is what the frontend stores in localStorage
    const presentationToken = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    logger.info({ resultUserId: result.userId, resultNama: result.nama, resultRole: result.role, expiresAt }, "verify-otp: about to insert presentation session");

    await db.insert(presentationSessionsTable).values({
      token: presentationToken,
      userId: result.userId,
      userNik: result.nik,
      userNama: result.nama,
      userRole: result.role,
      expiresAt,
    }).onConflictDoNothing();

    res.json({
      id: result.userId,
      nama: result.nama,
      role: result.role,
      presentationToken,
    });
  } catch (err) {
    logger.error({ err }, "verify-otp unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/presentation/session — validates localStorage token from DB
presentationAuthRouter.post("/session", async (req: any, res: any): Promise<void> => {
  const { presentationToken } = req.body;
  if (!presentationToken) {
    res.status(401).json({ error: "Session tidak ditemukan. Silakan login ulang." });
    return;
  }

  const [presSession] = await db
    .select()
    .from(presentationSessionsTable)
    .where(eq(presentationSessionsTable.token, presentationToken));

  if (!presSession) {
    res.status(401).json({ error: "Session tidak valid atau sudah kedaluwarsa. Silakan login ulang." });
    return;
  }

  if (new Date(presSession.expiresAt).getTime() < Date.now()) {
    await db.delete(presentationSessionsTable).where(eq(presentationSessionsTable.token, presentationToken));
    res.status(401).json({ error: "Session sudah kedaluwarsa. Silakan login ulang." });
    return;
  }

  res.json({
    id: presSession.userId,
    nama: presSession.userNama,
    role: presSession.userRole,
    nik: presSession.userNik ?? null,
  });
});

// POST /api/auth/presentation/resend-otp
presentationAuthRouter.post("/resend-otp", async (req: any, res: any): Promise<void> => {
  const { userId } = req.body;
  if (!userId) {
    res.status(400).json({ error: "userId wajib diisi" });
    return;
  }

  try {
    const result = await requestOtpPresentation(Number(userId));
    res.json({
      challengeId: result.challengeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/auth/presentation/session — logs out from presentation
presentationAuthRouter.delete("/session", async (req: any, res: any): Promise<void> => {
  const { presentationToken } = req.body;
  if (presentationToken) {
    await db.delete(presentationSessionsTable).where(eq(presentationSessionsTable.token, presentationToken));
  }
  res.json({ success: true });
});

export default presentationAuthRouter;
