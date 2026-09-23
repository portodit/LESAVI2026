import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountManagersTable = pgTable("account_managers", {
  id: serial("id").primaryKey(),
  nik: text("nik").unique(),
  nama: text("nama").notNull(),
  slug: text("slug").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("AM"),
  tipe: text("tipe").default("LESA"),
  divisi: text("divisi").notNull().default("DPS"),
  segmen: text("segmen"),
  witel: text("witel").notNull().default("SURAMADU"),
  jabatan: text("jabatan"),
  aktif: boolean("aktif").notNull().default(true),
  roleId: integer("role_id"),
  crossWitel: boolean("cross_witel").notNull().default(false),
  telegramChatId: text("telegram_chat_id"),
  telegramCode: text("telegram_code"),
  telegramCodeExpiry: timestamp("telegram_code_expiry", { withTimezone: true }),
  kpiActivity: integer("kpi_activity"),
  discoveredFrom: text("discovered_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  photoUrl: text("photo_url"),
});

export const insertAccountManagerSchema = createInsertSchema(accountManagersTable).omit({ id: true, createdAt: true });
export type InsertAccountManager = z.infer<typeof insertAccountManagerSchema>;
export type AccountManager = typeof accountManagersTable.$inferSelect;
