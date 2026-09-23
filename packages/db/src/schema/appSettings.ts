import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  telegramBotToken: text("telegram_bot_token"),
  telegramBotUsername: text("telegram_bot_username"),
  sharepointPerformanceUrl: text("sharepoint_performance_url"),
  sharepointFunnelUrl: text("sharepoint_funnel_url"),
  sharepointActivityUrl: text("sharepoint_activity_url"),
  autoSendOnImport: boolean("auto_send_on_import").notNull().default(true),
  kpiActivityDefault: integer("kpi_activity_default").notNull().default(30),
  // Google Sheets auto-sync
  gSheetsSpreadsheetId: text("g_sheets_spreadsheet_id"),
  gSheetsFunnelSpreadsheetId: text("g_sheets_funnel_spreadsheet_id"),
  gSheetsApiKey: text("g_sheets_api_key"),
  gSheetsFunnelPattern: text("g_sheets_funnel_pattern").default("TREG3_SALES_FUNNEL_"),
  gSheetsSyncEnabled: boolean("g_sheets_sync_enabled").notNull().default(false),
  gSheetsSyncHourWib: integer("g_sheets_sync_hour_wib").notNull().default(6),
  gSheetsSyncIntervalDays: integer("g_sheets_sync_interval_days").notNull().default(1),
  gSheetsLastSyncAt: timestamp("g_sheets_last_sync_at", { withTimezone: true }),
  gSheetsLastSyncResult: text("g_sheets_last_sync_result"),
  // Google Drive folder sync (public folders, 1 folder per data type)
  gDriveFolderPerformance: text("g_drive_folder_performance"),
  gDriveFolderFunnel: text("g_drive_folder_funnel"),
  gDriveFolderActivity: text("g_drive_folder_activity"),
  gDriveFolderTarget: text("g_drive_folder_target"),
  // Google Drive auto-scheduler
  gDriveSyncEnabled: boolean("g_drive_sync_enabled").notNull().default(false),
  gDriveSyncHourWib: integer("g_drive_sync_hour_wib").notNull().default(7),
  gDriveSyncIntervalDays: integer("g_drive_sync_interval_days").notNull().default(1),
  gDriveLastCheckAt: timestamp("g_drive_last_check_at", { withTimezone: true }),
  nonAktifAmsCleaned: boolean("non_aktif_ams_cleaned").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
