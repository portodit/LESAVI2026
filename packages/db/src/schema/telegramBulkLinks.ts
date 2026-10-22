import { pgTable, text, timestamp, serial, integer, varchar } from "drizzle-orm/pg-core";
import { accountManagersTable } from "./accountManagers";

export const telegramBulkLinksTable = pgTable("telegram_bulk_links", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  codeHash: varchar("code_hash", { length: 255 }).notNull(),
  createdById: integer("created_by_id").references(() => accountManagersTable.id),
  createdByNik: text("created_by_nik").notNull(),
  createdByNama: text("created_by_nama").notNull(),
  // Tanpa timezone, mengikuti DDL runtime aplikasi (apps/api/src/index.ts:
  // "expires_at TIMESTAMP(6)"). Nilai disimpan sebagai wall-clock lokal.
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedByAmId: integer("used_by_am_id").references(() => accountManagersTable.id),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TelegramBulkLink = typeof telegramBulkLinksTable.$inferSelect;
