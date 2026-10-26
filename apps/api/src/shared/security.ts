import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response } from "express";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Nilai ini pernah hardcoded di app.ts dan ikut ter-commit di .env.example,
 * jadi rahasia publik. Server refuses to start kalau masih dipakai.
 */
const KNOWN_LEAKED_SESSION_SECRET = "rlegs-suramadu-secret-2024";

export function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "SESSION_SECRET belum diset. Jalankan `openssl rand -hex 32` dan simpan hasilnya di environment server sebelum menyalakan API.",
    );
  }
  if (secret === KNOWN_LEAKED_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET masih memakai nilai yang pernah ter-commit di .env.example. Rotasi dulu (`openssl rand -hex 32`) — sesi yang ditandatangani dengan rahasia publik bisa dipalsukan.",
    );
  }
  return secret;
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Whitelist origin untuk CORS. Dashboard & API dilayani origin yang sama
 * (nginx), jadi daftar ini hanya relevan untuk akses lintas origin (mis.
 * dev lokal atau domain tambahan).
 */
export function resolveAllowedOrigins(): string[] {
  const origins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  for (const key of ["PUBLIC_DOMAIN", "PUBLIC_DOMAIN_FALLBACK", "PUBLIC_BASE_URL"]) {
    const value = process.env[key];
    if (value) {
      const origin = normalizeOrigin(value);
      if (origin) origins.push(origin);
    }
  }

  if (!isProduction) {
    origins.push(
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
    );
  }

  return [...new Set(origins)];
}

function tooManyRequests(message: string) {
  return (_req: Request, res: Response): void => {
    res.status(429).json({ error: message });
  };
}

function bodyValue(req: Request, keys: string[]): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
    if (typeof value === "number") return String(value);
  }
  return "";
}

/**
 * Pembatas rate untuk endpoint auth yang rawan spam (login & OTP).
 * Kunci per IP supaya satu kantor (yang berbagi satu IP publik) tidak saling
 * mengunci. Dipakai bersama limiter per-akun/per-user di bawahnya.
 */
export const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooManyRequests("Terlalu banyak permintaan. Coba lagi beberapa menit lagi."),
});

/**
 * Brute force password per akun: 20 percobaan per 15 menit per email/NIK.
 * Endpoint login mengembalikan 200 baik untuk sukses maupun gagal, jadi
 * `skipSuccessfulRequests` tidak dipakai — semua percobaan dihitung.
 */
export const loginAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier = bodyValue(req, ["email", "nik"]);
    if (!identifier) return `login:ip:${ipKeyGenerator(req.ip ?? "")}`;
    return `login:id:${identifier}`;
  },
  handler: tooManyRequests("Terlalu banyak percobaan login. Coba lagi dalam 15 menit."),
});

/** Spam permintaan OTP (setiap permintaan mengirim pesan ke Telegram user). */
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier = bodyValue(req, ["userId", "nik"]);
    if (!identifier) return `otp-req:ip:${ipKeyGenerator(req.ip ?? "")}`;
    return `otp-req:id:${identifier}`;
  },
  handler: tooManyRequests("Terlalu banyak permintaan kode verifikasi. Coba lagi dalam 15 menit."),
});

/** Tebakan OTP per challenge. */
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier = bodyValue(req, ["challengeId"]);
    if (!identifier) return `otp-ver:ip:${ipKeyGenerator(req.ip ?? "")}`;
    return `otp-ver:id:${identifier}`;
  },
  handler: tooManyRequests("Terlalu banyak percobaan kode verifikasi. Coba lagi dalam 15 menit."),
});
