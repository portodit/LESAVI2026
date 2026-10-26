import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, otpChallengesTable, accountManagersTable, appSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendToTelegramHtml } from "../telegram/service";
import { regenerateSession } from "../../shared/auth";

const OTP_LENGTH = 5;
const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

function generateOtp(): string {
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

function generateChallengeId(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ─── Dashboard OTP (uses express-session) ───────────────────────────────────

export async function requestOtp(userId: number, req: Request): Promise<{
  challengeId: string;
  expiresAt: Date;
}> {
  const now = new Date();

  const recentChallenges = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.userId, userId),
        eq(otpChallengesTable.status, "PENDING")
      )
    )
    .orderBy(otpChallengesTable.createdAt)
    .limit(1);

  if (recentChallenges.length > 0) {
    const lastCreated = recentChallenges[0].createdAt;
    const secondsSince = (now.getTime() - lastCreated.getTime()) / 1000;
    if (secondsSince < RESEND_COOLDOWN_SECONDS) {
      return {
        challengeId: recentChallenges[0].challengeId,
        expiresAt: recentChallenges[0].expiresAt,
      };
    }
  }

  const [user] = await db
    .select()
    .from(accountManagersTable)
    .where(eq(accountManagersTable.id, userId));
  if (!user) throw new Error("User tidak ditemukan.");

  if (!user.telegramChatId) {
    throw new Error("Telegram belum terhubung. Hubungi petugas untuk menghubungkan akun Telegram terlebih dahulu.");
  }

  const otp = generateOtp();
  const challengeId = generateChallengeId();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const otpHash = await bcrypt.hash(otp, 10);

  await db
    .update(otpChallengesTable)
    .set({ status: "REVOKED" })
    .where(
      and(
        eq(otpChallengesTable.userId, userId),
        eq(otpChallengesTable.status, "PENDING")
      )
    );

  await db.insert(otpChallengesTable).values({
    userId,
    challengeId,
    otpHash,
    channel: "TELEGRAM",
    expiresAt,
    attemptCount: 0,
    status: "PENDING",
  });

  const [settings] = await db.select().from(appSettingsTable);
  if (settings?.telegramBotToken && user.telegramChatId) {
    const firstName = user.nama?.split(" ")[0] ?? "Kak";
    const message =
      `🔐 <b>Kode Verifikasi Masuk</b>\n\n` +
      `Hai kak <b>${firstName}</b>!\n\n` +
      `Berikut kode verifikasi untuk masuk ke Dashboard LESA VI:\n\n` +
      `<code>${otp}</code>\n\n` +
      `⚠️ Kode ini berlaku selama <b>${OTP_EXPIRY_MINUTES} menit</b>. Jangan bagikan kode ini ke siapa pun.\n\n` +
      `Jika Anda tidak meminta kode ini, abaikan pesan ini.`;

    await sendToTelegramHtml(settings.telegramBotToken, user.telegramChatId, message).catch(() => {});
  }

  const session = (req as any).session;
  session.pendingUserId = userId;
  session.pendingChallengeId = challengeId;
  session.pendingEmail = user.email;
  session.pendingNama = user.nama;
  session.pendingRole = user.role;
  session.pendingTipe = user.tipe;
  session.pendingExpiresAt = expiresAt.toISOString();
  await new Promise<void>((resolve, reject) => {
    session.save((err: any) => (err ? reject(err) : resolve()));
  });

  return { challengeId, expiresAt };
}

export async function verifyOtp(
  challengeId: string,
  otp: string,
  req: Request
): Promise<{ success: boolean; error?: string; locked?: boolean }> {
  const session = (req as any).session;

  if (session.pendingChallengeId !== challengeId) {
    return { success: false, error: "Challenge tidak valid atau sudah kedaluarsa. Silakan mulai proses login dari awal." };
  }

  if (session.pendingExpiresAt && new Date(session.pendingExpiresAt) < new Date()) {
    return { success: false, error: "Session verifikasi sudah kedaluarsa. Silakan login kembali." };
  }

  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.challengeId, challengeId),
        eq(otpChallengesTable.status, "PENDING")
      )
    );

  if (!challenge) {
    const [blockedChallenge] = await db
      .select()
      .from(otpChallengesTable)
      .where(eq(otpChallengesTable.challengeId, challengeId));
    if (blockedChallenge && blockedChallenge.status === "BLOCKED") {
      return { success: false, error: "Terlalu banyak percobaan salah. Tunggu beberapa menit sebelum mencoba lagi.", locked: true };
    }
    return { success: false, error: "Challenge tidak valid atau sudah kedaluarsa. Silakan mulai proses login dari awal." };
  }

  if (challenge.expiresAt < new Date()) {
    await db
      .update(otpChallengesTable)
      .set({ status: "EXPIRED" })
      .where(eq(otpChallengesTable.id, challenge.id));
    return { success: false, error: "Kode verifikasi sudah kedaluwarsa. Silakan minta kode baru." };
  }

  if (challenge.attemptCount >= MAX_ATTEMPTS) {
    await db
      .update(otpChallengesTable)
      .set({ status: "BLOCKED" })
      .where(eq(otpChallengesTable.id, challenge.id));
    return { success: false, error: "Terlalu banyak percobaan salah. Tunggu beberapa menit sebelum mencoba lagi.", locked: true };
  }

  const valid = await bcrypt.compare(otp, challenge.otpHash);
  if (!valid) {
    await db
      .update(otpChallengesTable)
      .set({ attemptCount: challenge.attemptCount + 1 })
      .where(eq(otpChallengesTable.id, challenge.id));
    const remaining = MAX_ATTEMPTS - challenge.attemptCount - 1;
    if (remaining <= 0) {
      return { success: false, error: "Kode verifikasi salah. Terlalu banyak percobaan. Tunggu beberapa menit sebelum mencoba lagi.", locked: true };
    }
    return { success: false, error: `Kode verifikasi tidak sesuai. Sisa percobaan: ${remaining}.` };
  }

  await db
    .update(otpChallengesTable)
    .set({ status: "VERIFIED", verifiedAt: new Date() })
    .where(eq(otpChallengesTable.id, challenge.id));

  // Cegah session fixation: ID sesi lama (yang bisa saja sudah dibocorkan
  // lewat link/hijacking) dibuang, lalu sesi baru dibuat untuk user terverifikasi.
  const pendingUserId = session.pendingUserId;
  const pendingEmail = session.pendingEmail;
  const pendingNama = session.pendingNama;
  const pendingRole = session.pendingRole;
  const pendingTipe = session.pendingTipe;

  await regenerateSession(req);

  const verifiedSession = (req as any).session;
  verifiedSession.userId = pendingUserId;
  verifiedSession.userEmail = pendingEmail;
  verifiedSession.userRole = pendingRole;
  verifiedSession.userNama = pendingNama;
  verifiedSession.userTipe = pendingTipe;

  const deviceId = crypto.randomBytes(8).toString("hex");
  verifiedSession.deviceId = deviceId;

  await new Promise<void>((resolve, reject) => {
    verifiedSession.save((err: any) => (err ? reject(err) : resolve()));
  });

  return { success: true };
}

export async function resendOtp(req: Request): Promise<{
  challengeId: string;
  expiresAt: Date;
}> {
  const session = (req as any).session;
  if (!session.pendingUserId) {
    throw new Error("Tidak ada tantangan yang aktif. Silakan mulai proses login dari awal.");
  }
  return requestOtp(session.pendingUserId, req);
}

// ─── Presentation OTP (sessionless — no req.session dependency) ─────────────

export async function requestOtpPresentation(userId: number): Promise<{
  challengeId: string;
  expiresAt: Date;
}> {
  const now = new Date();

  const recentChallenges = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.userId, userId),
        eq(otpChallengesTable.status, "PENDING")
      )
    )
    .orderBy(otpChallengesTable.createdAt)
    .limit(1);

  if (recentChallenges.length > 0) {
    const lastCreated = recentChallenges[0].createdAt;
    const secondsSince = (now.getTime() - lastCreated.getTime()) / 1000;
    if (secondsSince < RESEND_COOLDOWN_SECONDS) {
      return {
        challengeId: recentChallenges[0].challengeId,
        expiresAt: recentChallenges[0].expiresAt,
      };
    }
  }

  const [user] = await db
    .select()
    .from(accountManagersTable)
    .where(eq(accountManagersTable.id, userId));
  if (!user) throw new Error("User tidak ditemukan.");

  if (!user.telegramChatId) {
    throw new Error("Telegram belum terhubung.");
  }

  const otp = generateOtp();
  const challengeId = generateChallengeId();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const otpHash = await bcrypt.hash(otp, 10);

  await db
    .update(otpChallengesTable)
    .set({ status: "REVOKED" })
    .where(
      and(
        eq(otpChallengesTable.userId, userId),
        eq(otpChallengesTable.status, "PENDING")
      )
    );

  await db.insert(otpChallengesTable).values({
    userId,
    challengeId,
    otpHash,
    channel: "TELEGRAM",
    expiresAt,
    attemptCount: 0,
    status: "PENDING",
  });

  const [settings] = await db.select().from(appSettingsTable);
  if (settings?.telegramBotToken && user.telegramChatId) {
    const firstName = user.nama?.split(" ")[0] ?? "Kak";
    const message =
      `🔐 <b>Kode Verifikasi Masuk</b>\n\n` +
      `Hai kak <b>${firstName}</b>!\n\n` +
      `Berikut kode verifikasi untuk masuk ke Dashboard LESA VI:\n\n` +
      `<code>${otp}</code>\n\n` +
      `⚠️ Kode ini berlaku selama <b>${OTP_EXPIRY_MINUTES} menit</b>. Jangan bagikan kode ini ke siapa pun.\n\n` +
      `Jika Anda tidak meminta kode ini, abaikan pesan ini.`;

    await sendToTelegramHtml(settings.telegramBotToken, user.telegramChatId, message).catch(() => {});
  }

  return { challengeId, expiresAt };
}

export async function verifyOtpPresentation(
  challengeId: string,
  otp: string,
  userId?: number
): Promise<
  | { success: false; error: string; locked?: boolean }
  | {
      success: true;
      userId: number;
      email: string | null;
      nama: string | null;
      role: string | null;
      tipe: string | null;
      nik: string | null;
    }
> {
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.challengeId, challengeId),
        eq(otpChallengesTable.status, "PENDING")
      )
    );

  if (!challenge) {
    const [blockedChallenge] = await db
      .select()
      .from(otpChallengesTable)
      .where(eq(otpChallengesTable.challengeId, challengeId));
    if (blockedChallenge && blockedChallenge.status === "BLOCKED") {
      return { success: false, error: "Terlalu banyak percobaan salah. Tunggu beberapa menit sebelum mencoba lagi.", locked: true };
    }
    return { success: false, error: "Challenge tidak valid atau sudah kedaluarsa." };
  }

  if (userId !== undefined && challenge.userId !== userId) {
    return { success: false, error: "User tidak valid. Silakan login ulang." };
  }

  if (challenge.expiresAt < new Date()) {
    await db
      .update(otpChallengesTable)
      .set({ status: "EXPIRED" })
      .where(eq(otpChallengesTable.id, challenge.id));
    return { success: false, error: "Kode verifikasi sudah kedaluwarsa." };
  }

  if (challenge.attemptCount >= MAX_ATTEMPTS) {
    await db
      .update(otpChallengesTable)
      .set({ status: "BLOCKED" })
      .where(eq(otpChallengesTable.id, challenge.id));
    return { success: false, error: "Terlalu banyak percobaan salah.", locked: true };
  }

  const valid = await bcrypt.compare(otp, challenge.otpHash);
  if (!valid) {
    await db
      .update(otpChallengesTable)
      .set({ attemptCount: challenge.attemptCount + 1 })
      .where(eq(otpChallengesTable.id, challenge.id));
    const remaining = MAX_ATTEMPTS - challenge.attemptCount - 1;
    if (remaining <= 0) {
      return { success: false, error: "Terlalu banyak percobaan salah.", locked: true };
    }
    return { success: false, error: `Kode verifikasi tidak sesuai. Sisa percobaan: ${remaining}.` };
  }

  await db
    .update(otpChallengesTable)
    .set({ status: "VERIFIED", verifiedAt: new Date() })
    .where(eq(otpChallengesTable.id, challenge.id));

  // userId is optional in the function signature — get it from the challenge record itself
  const resolvedUserId = userId ?? challenge.userId;
  const [user] = await db
    .select()
    .from(accountManagersTable)
    .where(eq(accountManagersTable.id, resolvedUserId));

  return {
    success: true,
    userId: user?.id ?? resolvedUserId,
    email: user?.email ?? null,
    nama: user?.nama ?? null,
    role: user?.role ?? null,
    tipe: user?.tipe ?? null,
    nik: user?.nik ?? null,
  };
}

// ─── Session info helpers ─────────────────────────────────────────────────────

export async function getPendingUserInfo(req: Request): Promise<{
  userId: number | null;
  email: string | null;
  nama: string | null;
  role: string | null;
  linked: boolean;
  telegramUsername: string | null;
  telegramChatId: string | null;
} | null> {
  const session = (req as any).session;

  let userId: number | null = null;
  if (session?.userId) {
    userId = session.userId;
  } else if (session?.pendingUserId) {
    userId = session.pendingUserId;
  }

  if (!userId) return null;

  const [am] = await db
    .select()
    .from(accountManagersTable)
    .where(eq(accountManagersTable.id, userId));

  if (!am) return null;

  return {
    userId: am.id,
    email: am.email ?? null,
    nama: am.nama ?? null,
    role: am.role ?? null,
    linked: !!am.telegramChatId,
    telegramUsername: am.telegramUsername ?? null,
    telegramChatId: am.telegramChatId ?? null,
  };
}
