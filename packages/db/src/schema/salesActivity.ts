import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const salesActivityTable = pgTable("sales_activity", {
  id: serial("id").primaryKey(),
  nik: text("nik").notNull(),
  fullname: text("fullname"),
  divisi: text("divisi"),
  segmen: text("segmen"),
  regional: text("regional"),
  witel: text("witel"),
  nipnas: text("nipnas"),
  caName: text("ca_name"),
  activityType: text("activity_type"),
  label: text("label"),
  lopid: text("lopid"),
  createdatActivity: text("createdat_activity"),
  activityStartDate: text("activity_start_date"),
  activityEndDate: text("activity_end_date"),
  picName: text("pic_name"),
  picJobtitle: text("pic_jobtitle"),
  picRole: text("pic_role"),
  picPhone: text("pic_phone"),
  activityNotes: text("activity_notes"),
  snapshotDate: text("snapshot_date"),
  importId: integer("import_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSalesActivitySchema = createInsertSchema(salesActivityTable).omit({ id: true, createdAt: true });
export type InsertSalesActivity = z.infer<typeof insertSalesActivitySchema>;
export type SalesActivity = typeof salesActivityTable.$inferSelect;
