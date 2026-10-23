/**
 * Dispatcher notifikasi Telegram untuk event import.
 *
 * Semua sumber import — dashboard, Google Drive, Google Sheets, sampai upload
 * lewat bot Telegram — memanggil fungsi yang sama supaya template pesan yang
 * dikirim ke AM dan Manager selalu identik, tidak ada versi terpisah per
 * sumber.
 */

import { logger } from "../../shared/logger";
import {
  notifyPerformanceSnapshot,
  notifyManagerSnapshot,
  notifyActivitySnapshot,
  notifyManagerActivitySnapshot,
} from "./service";
import { notifyFunnelSnapshot, notifyFunnelManagerSnapshot } from "./funnelAnnouncements";

export type SnapshotKind = "funnel" | "activity" | "performance";

export interface NotifyOutcome {
  sent: number;
  failed: number;
  skipped: number;
  details: { nik: string; status: string; error?: string }[];
}

export interface NotifyOptions {
  /** Nama & role pengimpor — ditampilkan di template. */
  uploader?: { nama: string; role: string; nik?: string };
  /** Batasi hanya AM tertentu (dipakai untuk broadcast manual). */
  targetNiks?: string[];
}

const EMPTY: NotifyOutcome = { sent: 0, failed: 0, skipped: 0, details: [] };

function safeDetails(details: unknown): { nik: string; status: string; error?: string }[] {
  if (!Array.isArray(details)) return [];
  return details.map((d: any) => ({
    nik: String(d?.nik ?? d?.nama ?? ""),
    status: String(d?.status ?? ""),
    ...(d?.error ? { error: String(d.error) } : {}),
  }));
}

function toOutcome(result: {
  sent: number; failed: number; skipped: number; details: unknown;
}): NotifyOutcome {
  return {
    sent: result.sent ?? 0,
    failed: result.failed ?? 0,
    skipped: result.skipped ?? 0,
    details: safeDetails(result.details),
  };
}

/** Notifikasi level AM untuk satu snapshot. */
export async function notifyAmSnapshot(
  kind: SnapshotKind,
  importId: number,
  opts: NotifyOptions = {},
): Promise<NotifyOutcome> {
  try {
    if (kind === "funnel") {
      return toOutcome(await notifyFunnelSnapshot(importId, opts.uploader, opts.targetNiks));
    }
    if (kind === "activity") {
      return toOutcome(await notifyActivitySnapshot(importId, opts.uploader, opts.targetNiks));
    }
    return toOutcome(await notifyPerformanceSnapshot(importId, opts.uploader, opts.targetNiks));
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, kind, importId }, "Notifikasi AM gagal");
    return { ...EMPTY };
  }
}

/** Notifikasi level Manager untuk satu snapshot. */
export async function notifyManagerSnapshotByKind(
  kind: SnapshotKind,
  importId: number,
  opts: NotifyOptions = {},
): Promise<NotifyOutcome> {
  try {
    if (kind === "funnel") {
      return toOutcome(await notifyFunnelManagerSnapshot(importId, opts.uploader));
    }
    if (kind === "activity") {
      return toOutcome(await notifyManagerActivitySnapshot(importId, opts.uploader));
    }
    return toOutcome(await notifyManagerSnapshot(importId, opts.uploader));
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, kind, importId }, "Notifikasi Manager gagal");
    return { ...EMPTY };
  }
}

/**
 * Kirim notifikasi lengkap (AM + Manager) untuk satu import.
 * Dipakai semua sumber import supaya pesannya sama persis.
 */
export async function notifyImportSnapshot(
  kind: SnapshotKind,
  importId: number,
  opts: NotifyOptions = {},
): Promise<{ am: NotifyOutcome; manager: NotifyOutcome }> {
  const [am, manager] = await Promise.all([
    notifyAmSnapshot(kind, importId, opts),
    notifyManagerSnapshotByKind(kind, importId, opts),
  ]);
  if (am.sent > 0 || am.failed > 0) {
    logger.info({ kind, importId, sent: am.sent, failed: am.failed }, "Notifikasi AM terkirim");
  }
  if (manager.sent > 0 || manager.failed > 0) {
    logger.info({ kind, importId, sent: manager.sent, failed: manager.failed }, "Notifikasi Manager terkirim");
  }
  return { am, manager };
}
