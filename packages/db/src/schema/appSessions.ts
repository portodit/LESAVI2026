// Tabel session milik connect-pg-simple (express-session).
// Sebelumnya tabel ini hanya dibuat lewat DDL runtime di apps/api/src/index.ts,
// sehingga tidak dikenal Drizzle — akibatnya `drizzle-kit push` menganggapnya
// tabel asing dan cenderung menghapusnya. Sekarang didaftarkan di sini.
import { pgTable, varchar, json, timestamp } from "drizzle-orm/pg-core";

export const userSessionsTable = pgTable("user_sessions", {
  sid: varchar("sid").notNull().primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire").notNull(),
});
