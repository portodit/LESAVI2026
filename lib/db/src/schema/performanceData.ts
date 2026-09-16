import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const performanceDataTable = pgTable("performance_data", {
  id: serial("id").primaryKey(),
  nik: text("nik").notNull(),
  namaAm: text("nama_am").notNull(),
  divisi: text("divisi").notNull(),
  witelAm: text("witel_am"),
  levelAm: text("level_am"),
  tahun: integer("tahun").notNull(),
  bulan: integer("bulan").notNull(),
  targetRevenue: real("target_revenue").notNull().default(0),
  realRevenue: real("real_revenue").notNull().default(0),
  targetReguler: real("target_reguler").default(0),
  realReguler: real("real_reguler").default(0),
  targetSustain: real("target_sustain").default(0),
  realSustain: real("real_sustain").default(0),
  targetScaling: real("target_scaling").default(0),
  realScaling: real("real_scaling").default(0),
  targetNgtma: real("target_ngtma").default(0),
  realNgtma: real("real_ngtma").default(0),
  achRate: real("ach_rate").notNull().default(0),
  achRateYtd: real("ach_rate_ytd").notNull().default(0),
  rankAch: integer("rank_ach").notNull().default(0),
  statusWarna: text("status_warna").notNull().default("merah"),
  komponenDetail: text("komponen_detail"),
  snapshotDate: text("snapshot_date"),
  importId: integer("import_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  divisiCc: text("divisi_cc"),
  proporsi: real("proporsi").default(1),
});

export const insertPerformanceDataSchema = createInsertSchema(performanceDataTable).omit({ id: true, createdAt: true });
export type InsertPerformanceData = z.infer<typeof insertPerformanceDataSchema>;
export type PerformanceData = typeof performanceDataTable.$inferSelect;
