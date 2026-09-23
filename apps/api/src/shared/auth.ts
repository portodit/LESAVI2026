import bcrypt from "bcryptjs";
import { db, accountManagersTable, presentationSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function ensureDefaultAdmin(): Promise<void> {
  const ADMIN_EMAIL = "bliaditdev@gmail.com";
  const ADMIN_NIK   = "160203";

  const existing = await db
    .select()
    .from(accountManagersTable)
    .where(eq(accountManagersTable.email, ADMIN_EMAIL));

  if (existing.length === 0) {
    const byNik = await db
      .select()
      .from(accountManagersTable)
      .where(eq(accountManagersTable.nik, ADMIN_NIK));

    if (byNik.length > 0) {
      const hash = byNik[0].passwordHash ?? await hashPassword("admin123");
      await db
        .update(accountManagersTable)
        .set({ email: ADMIN_EMAIL, role: "ADMIN", roleId: 1, passwordHash: hash, status: "ACTIVE" })
        .where(eq(accountManagersTable.nik, ADMIN_NIK));
    } else {
      const hash = await hashPassword("admin123");
      await db.insert(accountManagersTable).values({
        nik: ADMIN_NIK,
        nama: "Admin Officer",
        slug: "admin-bliaditdev",
        email: ADMIN_EMAIL,
        passwordHash: hash,
        role: "ADMIN",
        roleId: 1,
        tipe: "LESA",
        divisi: "DPS",
        witel: "SURAMADU",
        status: "ACTIVE",
      });
    }
  } else {
    const rec = existing[0];
    const needsUpdate = rec.role !== "ADMIN" || !rec.passwordHash || rec.nik !== ADMIN_NIK;
    if (needsUpdate) {
      const hash = rec.passwordHash ?? await hashPassword("admin123");
      await db
        .update(accountManagersTable)
        .set({ role: "ADMIN", roleId: 1, nik: ADMIN_NIK, passwordHash: hash, status: "ACTIVE" })
        .where(eq(accountManagersTable.email, ADMIN_EMAIL));
    }
  }
}

/**
 * Middleware: pastikan user sudah login.
 * Menyuntikkan req.user dari sesi agar route handler bisa baca role.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = (req as any).session;
  const cookies = req.headers["cookie"] ?? "(none)";
  const sessionId = (req as any).sessionID ?? "(unknown)";
  console.log("[requireAuth] url:", req.url, "session cookie name:", session?.cookie?.name, "sessionID:", sessionId, "cookies:", cookies);
  if (!session?.userId) {
    console.log("[requireAuth] UNAUTHORIZED - session.userId:", session?.userId, "sessionKeys:", Object.keys(session ?? {}));
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as any).user = {
    id: session.userId,
    email: session.userEmail,
    role: session.userRole,
    nama: session.userNama,
    tipe: session.userTipe,
  };
  next();
}

// Extend express-session to include OTP challenge state
declare module "express-session" {
  interface SessionData {
    pendingUserId?: number;
    pendingChallengeId?: string;
    pendingEmail?: string;
    pendingNama?: string;
    pendingRole?: string;
    pendingTipe?: string;
    pendingExpiresAt?: string;
    deviceId?: string;
  }
}

/**
 * Log an authentication event to auth_logs table.
 * Non-fatal — errors are swallowed so logging never blocks the auth flow.
 */
export async function logAuthEvent(params: {
  userId?: number | null;
  eventType: string;
  loginMethod?: string;
  challengeId?: string;
  sessionId?: number;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  failureReason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { authLogsTable } = await import("@workspace/db");
    await db.insert(authLogsTable).values({
      userId: params.userId ?? null,
      eventType: params.eventType,
      loginMethod: params.loginMethod ?? null,
      challengeId: params.challengeId ?? null,
      sessionId: params.sessionId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      deviceId: params.deviceId ?? null,
      status: params.status,
      failureReason: params.failureReason ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // non-fatal
  }
}

export function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    ""
  );
}

/**
 * Middleware: ADMIN, MANAGER, dan OFFICER boleh mengakses fitur manajemen.
 * Harus dipasang SETELAH requireAuth.
 */
export function requireManagerOrOfficer(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!["ADMIN", "OFFICER", "MANAGER"].includes(user.role)) {
    res.status(403).json({ error: "Akses ditolak. Hanya Admin, Officer, atau Manager yang dapat mengakses fitur ini." });
    return;
  }
  next();
}

/**
 * Middleware: validates presentation token from x-presentation-token header or body.
 * Injects req.user with presentation session data.
 */
export async function requirePresentationAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = (req.headers["x-presentation-token"] as string)
    || (req.body as any)?.presentationToken;

  if (!token) {
    res.status(401).json({ error: "Session tidak ditemukan. Silakan login ulang." });
    return;
  }

  const [session] = await db
    .select()
    .from(presentationSessionsTable)
    .where(eq(presentationSessionsTable.token, token));

  if (!session) {
    res.status(401).json({ error: "Session tidak valid. Silakan login ulang." });
    return;
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await db.delete(presentationSessionsTable).where(eq(presentationSessionsTable.token, token));
    res.status(401).json({ error: "Session sudah kedaluwarsa. Silakan login ulang." });
    return;
  }

  (req as any).user = {
    id: session.userId,
    nik: session.userNik,
    nama: session.userNama,
    role: session.userRole,
  };
  next();
}
