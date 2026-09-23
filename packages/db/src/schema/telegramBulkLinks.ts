import { pgTable, text, timestamp, serial, integer, varchar } from "drizzle-orm/pg-core";
import { accountManagersTable } from "./accountManagers";

export const telegramBulkLinksTable = pgTable("telegram_bulk_links", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  codeHash: varchar("code_hash", { length: 255 }).notNull(),
  createdById: integer("created_by_id").references(() => accountManagersTable.id),
  createdByNik: text("created_by_nik").notNull(),
  createdByNama: text("created_by_nama").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByAmId: integer("used_by_am_id").references(() => accountManagersTable.id),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TelegramBulkLink = typeof telegramBulkLinksTable.$inferSelect;
