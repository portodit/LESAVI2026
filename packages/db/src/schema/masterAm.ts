import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const masterCustomerTable = pgTable("master_customer", {
  id: serial("id").primaryKey(),
  nama: text("nama").notNull().unique(),
  segmen: text("segmen"),
  witel: text("witel").default("SURAMADU"),
  divisiCc: text("divisi_cc"),
  divisiAm: text("divisi_am"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMasterCustomerSchema = createInsertSchema(masterCustomerTable).omit({ id: true, createdAt: true });
export type InsertMasterCustomer = z.infer<typeof insertMasterCustomerSchema>;
export type MasterCustomer = typeof masterCustomerTable.$inferSelect;
