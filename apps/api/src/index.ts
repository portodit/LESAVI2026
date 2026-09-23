import app from "./app";
import { logger } from "./shared/logger";
import { ensureDefaultAdmin } from "./shared/auth";
import { ensureDefaultSeed } from "./shared/seed";
import { ensureFullSeed } from "./shared/auto-seed";
import { pool } from "@workspace/db";
import { startTelegramPoller } from "./features/telegram/poller";
import { startGSheetsScheduler } from "./features/gsheets/scheduler";
import { startGDriveScheduler } from "./features/gdrive/scheduler";

async function ensureSessionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);
  `);
}

async function ensurePhotoUrlColumn(): Promise<void> {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_managers' AND column_name = 'photo_url'
      ) THEN
        ALTER TABLE account_managers ADD COLUMN photo_url TEXT;
      END IF;
    END $$;
  `);
}

async function ensurePresentationSessionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS presentation_sessions (
      token VARCHAR NOT NULL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_nik VARCHAR(50),
      user_nama VARCHAR(255) NOT NULL,
      user_role VARCHAR(50) NOT NULL,
      created_at TIMESTAMP(6) NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP(6) NOT NULL
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS IDX_pres_expires ON presentation_sessions (expires_at);
  `);
}

async function ensureBulkLinksTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_bulk_links (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      code_hash VARCHAR(255) NOT NULL,
      created_by_id INTEGER REFERENCES account_managers(id),
      created_by_nik TEXT NOT NULL,
      created_by_nama TEXT NOT NULL,
      expires_at TIMESTAMP(6) NOT NULL,
      used_at TIMESTAMP(6),
      used_by_am_id INTEGER REFERENCES account_managers(id),
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS IDX_bulk_links_code ON telegram_bulk_links (code);
    CREATE INDEX IF NOT EXISTS IDX_bulk_links_status_expires ON telegram_bulk_links (status, expires_at);
  `);
}


async function patchNullTahunAnggaran(): Promise<void> {
  const result = await pool.query(`
    UPDATE sales_funnel
    SET tahun_anggaran = COALESCE(
      CASE WHEN snapshot_date IS NOT NULL AND snapshot_date ~ '^[0-9]{4}'
        THEN EXTRACT(YEAR FROM snapshot_date::date)::integer
      END,
      CASE WHEN report_date IS NOT NULL AND report_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN EXTRACT(YEAR FROM report_date::date)::integer
      END
    )
    WHERE tahun_anggaran IS NULL;
  `);
  const count = result.rowCount ?? 0;
  if (count > 0) {
    logger.info({ count }, "Patched NULL tahun_anggaran rows from snapshot/report_date");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

ensureSessionTable()
  .then(() => logger.info("Session table ensured"))
  .catch(err => logger.error({ err }, "Failed to ensure session table"));

ensurePresentationSessionTable()
  .then(() => logger.info("Presentation session store table ensured"))
  .catch(err => logger.error({ err }, "Failed to ensure presentation session store table"));

ensureBulkLinksTable()
  .then(() => logger.info("Bulk links table ensured"))
  .catch(err => logger.error({ err }, "Failed to ensure bulk links table"));

ensurePhotoUrlColumn()
  .then(() => logger.info("photo_url column ensured"))
  .catch(err => logger.error({ err }, "Failed to ensure photo_url column"));

ensureDefaultAdmin()
  .then(() => logger.info("Default admin user ensured"))
  .catch(err => logger.error({ err }, "Failed to ensure default admin"));

ensureDefaultSeed()
  .then(() => logger.info("Default seed data ensured"))
  .catch(err => logger.error({ err }, "Failed to ensure default seed data"));

ensureFullSeed()
  .then(() => logger.info("Full seed check complete"))
  .catch(err => logger.error({ err }, "Failed full seed check"));

patchNullTahunAnggaran()
  .then(() => logger.info("Tahun anggaran patch complete"))
  .catch(err => logger.error({ err }, "Failed to patch tahun anggaran"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startTelegramPoller(3000);
  startGSheetsScheduler();
  startGDriveScheduler();
});
