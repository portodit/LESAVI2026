// Consolidated schema to avoid circular import issues
import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  varchar,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// Tables
// ============================================================

export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  level: integer("level").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissionsTable = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionsTable.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  })
);

export const accountManagersTable = pgTable("account_managers", {
  id: serial("id").primaryKey(),
  nik: text("nik").unique(),
  nama: text("nama").notNull(),
  slug: text("slug").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  resetPasswordToken: text("reset_password_token"),
  resetPasswordExpires: timestamp("reset_password_expires", { withTimezone: true }),
  photoUrl: text("photo_url"),
  roleId: integer("role_id").references(() => rolesTable.id),
  role: text("role").notNull().default("AM"),
  tipe: text("tipe").default("LESA"),
  divisi: text("divisi").notNull().default("DPS"),
  segmen: text("segmen"),
  witel: text("witel").notNull().default("SURAMADU"),
  jabatan: text("jabatan"),
  aktif: boolean("aktif").notNull().default(true),
  crossWitel: boolean("cross_witel").notNull().default(false),
  status: text("status").notNull().default("ACTIVE"),
  telegramChatId: text("telegram_chat_id"),
  telegramUserId: text("telegram_user_id"),
  telegramUsername: text("telegram_username"),
  telegramDisplayName: text("telegram_display_name"),
  telegramLinkedAt: timestamp("telegram_linked_at", { withTimezone: true }),
  telegramLinkedByAccessCodeId: integer("telegram_linked_by_access_code_id"),
  telegramCode: text("telegram_code"),
  telegramCodeExpiry: timestamp("telegram_code_expiry", { withTimezone: true }),
  kpiActivity: integer("kpi_activity"),
  discoveredFrom: text("discovered_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const telegramAccessCodesTable = pgTable("telegram_access_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => accountManagersTable.id, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 255 }).notNull(),
  createdBy: integer("created_by").references(() => accountManagersTable.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpChallengesTable = pgTable("otp_challenges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => accountManagersTable.id, { onDelete: "cascade" }),
  challengeId: varchar("challenge_id", { length: 50 }).notNull().unique(),
  otpHash: varchar("otp_hash", { length: 255 }).notNull(),
  channel: varchar("channel", { length: 20 }).notNull().default("TELEGRAM"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => accountManagersTable.id, { onDelete: "cascade" }),
  refreshTokenHash: varchar("refresh_token_hash", { length: 255 }).notNull(),
  deviceId: varchar("device_id", { length: 100 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
});

export const authLogsTable = pgTable("auth_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => accountManagersTable.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  loginMethod: varchar("login_method", { length: 30 }),
  challengeId: varchar("challenge_id", { length: 50 }),
  sessionId: integer("session_id").references(() => authSessionsTable.id, { onDelete: "set null" }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  deviceId: varchar("device_id", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("SUCCESS"),
  failureReason: varchar("failure_reason", { length: 100 }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Relations
// ============================================================

export const rolesRelations = relations(rolesTable, ({ many }) => ({
  rolePermissions: many(rolePermissionsTable),
  accountManagers: many(accountManagersTable),
}));

export const permissionsRelations = relations(permissionsTable, ({ many }) => ({
  rolePermissions: many(rolePermissionsTable),
}));

export const rolePermissionsRelations = relations(rolePermissionsTable, ({ one }) => ({
  role: one(rolesTable, {
    fields: [rolePermissionsTable.roleId],
    references: [rolesTable.id],
  }),
  permission: one(permissionsTable, {
    fields: [rolePermissionsTable.permissionId],
    references: [permissionsTable.id],
  }),
}));

export const accountManagersRelations = relations(accountManagersTable, ({ one, many }) => ({
  role: one(rolesTable, {
    fields: [accountManagersTable.roleId],
    references: [rolesTable.id],
  }),
  telegramAccessCodes: many(telegramAccessCodesTable),
  otpChallenges: many(otpChallengesTable),
  sessions: many(authSessionsTable),
  authLogs: many(authLogsTable),
}));

export const telegramAccessCodesRelations = relations(telegramAccessCodesTable, ({ one }) => ({
  user: one(accountManagersTable, {
    fields: [telegramAccessCodesTable.userId],
    references: [accountManagersTable.id],
  }),
  creator: one(accountManagersTable, {
    fields: [telegramAccessCodesTable.createdBy],
    references: [accountManagersTable.id],
  }),
}));

export const otpChallengesRelations = relations(otpChallengesTable, ({ one }) => ({
  user: one(accountManagersTable, {
    fields: [otpChallengesTable.userId],
    references: [accountManagersTable.id],
  }),
}));

export const authSessionsRelations = relations(authSessionsTable, ({ one }) => ({
  user: one(accountManagersTable, {
    fields: [authSessionsTable.userId],
    references: [accountManagersTable.id],
  }),
}));

export const authLogsRelations = relations(authLogsTable, ({ one }) => ({
  user: one(accountManagersTable, {
    fields: [authLogsTable.userId],
    references: [accountManagersTable.id],
  }),
  session: one(authSessionsTable, {
    fields: [authLogsTable.sessionId],
    references: [authSessionsTable.id],
  }),
}));

export const presentationSessionsTable = pgTable("presentation_sessions", {
  token: varchar("token", { length: 64 }).notNull().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => accountManagersTable.id, { onDelete: "cascade" }),
  userNik: varchar("user_nik", { length: 50 }),
  userNama: varchar("user_nama", { length: 255 }).notNull(),
  userRole: varchar("user_role", { length: 50 }).notNull(),
  // Tanpa timezone, mengikuti DDL runtime aplikasi (TIMESTAMP(6)).
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const presentationSessionsRelations = relations(presentationSessionsTable, ({ one }) => ({
  user: one(accountManagersTable, {
    fields: [presentationSessionsTable.userId],
    references: [accountManagersTable.id],
  }),
}));
