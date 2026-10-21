import { pgTable, text, serial, timestamp, integer, real, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const salesFunnelTable = pgTable("sales_funnel", {
  id: serial("id").primaryKey(),
  lopid: text("lopid").notNull(),
  judulProyek: text("judul_proyek").notNull(),
  pelanggan: text("pelanggan").notNull(),
  nilaiProyek: real("nilai_proyek").notNull().default(0),
  estRev: real("est_rev"),
  divisi: text("divisi").notNull(),
  segmen: text("segmen"),
  witel: text("witel"),
  witelAm: text("witel_am"),
  witelCc: text("witel_cc"),
  statusF: text("status_f"),
  proses: text("proses"),
  statusProyek: text("status_proyek"),
  kategoriKontrak: text("kategori_kontrak"),
  projectType: text("project_type"),
  isReport: text("is_report"),
  estimateBulan: text("estimate_bulan"),
  monthSubs: integer("month_subs"),
  namaAm: text("nama_am"),
  nikAm: text("nik_am"),
  reportDate: text("report_date"),
  createdDate: text("created_date"),
  snapshotDate: text("snapshot_date"),
  tahunAnggaran: integer("tahun_anggaran"),
  nikHandling: text("nik_handling"),
  namaPembuatLop: text("nama_pembuat_lop"),
  importId: integer("import_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesFunnelTargetTable = pgTable("sales_funnel_target", {
  id: serial("id").primaryKey(),
  divisi: text("divisi"),
  tahun: integer("tahun").notNull(),
  bulan: integer("bulan"),
  targetFullHo: real("target_full_ho").notNull().default(0),
  targetHo: real("target_ho").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const amFunnelTargetTable = pgTable("am_funnel_target", {
  id: serial("id").primaryKey(),
  nikAm: text("nik_am").notNull(),
  tahun: integer("tahun").notNull(),
  targetValue: real("target_value").notNull().default(0),
  targetValueDss: real("target_value_dss"),
  targetValueDps: real("target_value_dps"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique("am_funnel_target_nik_tahun").on(t.nikAm, t.tahun)]);

export const insertAmFunnelTargetSchema = createInsertSchema(amFunnelTargetTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAmFunnelTarget = z.infer<typeof insertAmFunnelTargetSchema>;
export type AmFunnelTarget = typeof amFunnelTargetTable.$inferSelect;

export const insertSalesFunnelSchema = createInsertSchema(salesFunnelTable).omit({ id: true, createdAt: true });
export type InsertSalesFunnel = z.infer<typeof insertSalesFunnelSchema>;
export type SalesFunnel = typeof salesFunnelTable.$inferSelect;
