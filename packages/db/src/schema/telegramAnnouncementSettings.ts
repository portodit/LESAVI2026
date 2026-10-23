import { pgTable, serial, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Pengaturan pengumuman Telegram (snapshot funnel + reminder LOP stagnan).
 * Tabel ini dibuat otomatis saat boot API supaya tidak butuh migrasi manual.
 */
export const telegramAnnouncementSettingsTable = pgTable("telegram_announcement_settings", {
  id: serial("id").primaryKey(),
  funnelAnnounceEnabled: boolean("funnel_announce_enabled").notNull().default(false),
  stagnantReminderEnabled: boolean("stagnant_reminder_enabled").notNull().default(false),
  stagnantReminderIntervalDays: integer("stagnant_reminder_interval_days").notNull().default(3),
  stagnantReminderHourWib: integer("stagnant_reminder_hour_wib").notNull().default(9),
  stagnantReminderLastSentAt: timestamp("stagnant_reminder_last_sent_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTelegramAnnouncementSettingsSchema = createInsertSchema(
  telegramAnnouncementSettingsTable,
).omit({ id: true, updatedAt: true });
export type InsertTelegramAnnouncementSettings = z.infer<typeof insertTelegramAnnouncementSettingsSchema>;
export type TelegramAnnouncementSettings = typeof telegramAnnouncementSettingsTable.$inferSelect;
