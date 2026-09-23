import express from "express";
import type { Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { authSubRouter, publicSubRouter, healthSubRouter } from "./routes";
import presentationAuthRouter from "./features/auth/routes";
import amRouter from "./features/am/routes";
import importRouter from "./features/import/routes";
import internalRouter from "./features/import/internal";
import performanceRouter from "./features/performance/routes";
import funnelRouter from "./features/funnel/routes";
import activityRouter from "./features/activity/routes";
import telegramRouter from "./features/telegram/routes";
import settingsRouter from "./features/settings/routes";
import gSheetsRouter from "./features/gsheets/routes";
import gDriveRouter from "./features/gdrive/routes";
import corporateRouter from "./features/corporate/routes";
import presentationRouter from "./features/presentation/routes";
import { requireAuth, requireManagerOrOfficer } from "./shared/auth";
import { logger } from "./shared/logger";
import { setPublicBaseUrl } from "./shared/publicUrl";
import { pool } from "@workspace/db";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// ── Dynamic Public URL Detection ──────────────────────────────────────────────
// Detect the public base URL from x-forwarded-host header (set by reverse proxy).
// We intentionally IGNORE the raw "host" header because internal requests from
// the Telegram bot (calling http://localhost:8080/api/internal/...) would
// otherwise overwrite the correct public URL with "localhost".
app.use((req, _res, next) => {
  const forwardedHost = (req.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim();
  if (forwardedHost) {
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || "https";
    setPublicBaseUrl(`${proto}://${forwardedHost}`);
  }
  next();
});

// ─── Serve Uploaded AM Photos ───────────────────────────────────────────────────
const uploadsPath = path.resolve(process.cwd(), "..", "..", "uploads");
if (fs.existsSync(uploadsPath)) {
  app.use("/uploads", express.static(uploadsPath));
}

// ─── Serve Dashboard Static Build (SPA fallback) ────────────────────────────────
// Must come BEFORE /api routes so API calls go through first
const dashboardDistPath = path.resolve(__dirname, "..", "..", "dashboard", "dist", "public");
if (fs.existsSync(dashboardDistPath)) {
  app.use(express.static(dashboardDistPath));
  // SPA fallback: serve index.html for all non-API routes
  // Cache-bust: inject ?v= hash from built assets so browser always gets fresh files
  app.use((_req, res, next) => {
    if (!_req.url.startsWith("/api")) {
      const indexPath = path.join(dashboardDistPath, "index.html");
      if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, "utf8");
        // Extract hash from asset filenames (e.g. index-ABCD1234.js → ?v=ABCD1234)
        const hashMatch = html.match(/assets\/index-([a-zA-Z0-9]+)\.js/);
        if (hashMatch) {
          html = html.replace(/\.js"/g, `.js?v=${hashMatch[1]}"`);
        }
        res.type("html").send(html);
      } else {
        next();
      }
    } else {
      next();
    }
  });
}

// ─── Dashboard Session Middleware (connect.sid) ────────────────────────────────
// CRITICAL: Do NOT apply globally. Each middleware modifies req.session in-place.
// Applying dashboard mw globally before pres mw causes express-session to reuse
// the dashboard session (same req.session object) instead of creating a pres session.
const PgSession = connectPg(session);
const dashboardSessionMw = session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || "rlegs-suramadu-secret-2024",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
  name: "connect.sid",
});

// ─── Health check ───────────────────────────────────────────────────────────────
app.use("/api", healthSubRouter);

// ─── Public API routes — no session needed ─────────────────────────────────────
app.use("/api/public", publicSubRouter);

// ─── Dashboard Auth routes — uses connect.sid ─────────────────────────────────
app.use("/api/auth", dashboardSessionMw, authSubRouter);

// ─── Presentation Auth Router — SESSIONLESS ──────────────────────────────────
// This router does NOT use express-session. All auth state is in the DB.
// No cookie/session middleware needed here — zero interference with dashboard.
app.use("/api/auth/presentation", presentationAuthRouter);

// ─── Internal routes — no session auth, uses x-telegram-secret header ─────────
app.use("/api/internal", internalRouter);

// ─── Custom API Error Handler — ensures JSON responses for all errors ─────────────
app.use((err: any, _req: any, res: any, _next: any) => {
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: err?.message || "Internal server error",
    ...(process.env["NODE_ENV"] !== "production" ? { stack: err?.stack } : {}),
  });
});

// ─── Protected Dashboard routes — uses connect.sid ────────────────────────────
app.use("/api/am", dashboardSessionMw, requireAuth, requireManagerOrOfficer, amRouter);
app.use("/api/import", dashboardSessionMw, requireAuth, requireManagerOrOfficer, importRouter);
app.use("/api/performance", dashboardSessionMw, requireAuth, requireManagerOrOfficer, performanceRouter);
app.use("/api/funnel", dashboardSessionMw, requireAuth, requireManagerOrOfficer, funnelRouter);
app.use("/api/activity", dashboardSessionMw, requireAuth, requireManagerOrOfficer, activityRouter);
app.use("/api/telegram", dashboardSessionMw, requireAuth, requireManagerOrOfficer, telegramRouter);
app.use("/api/settings", dashboardSessionMw, requireAuth, requireManagerOrOfficer, settingsRouter);
app.use("/api/gsheets", dashboardSessionMw, requireAuth, requireManagerOrOfficer, gSheetsRouter);
app.use("/api/gdrive", dashboardSessionMw, requireAuth, requireManagerOrOfficer, gDriveRouter);
app.use("/api/corporate", dashboardSessionMw, requireAuth, requireManagerOrOfficer, corporateRouter);
app.use("/api/presentation", presentationRouter);

export default app;
