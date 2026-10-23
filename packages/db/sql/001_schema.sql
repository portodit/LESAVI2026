-- DDL KANONIK — JANGAN diedit manual.
-- Sumber kebenaran: packages/db/src/schema/*.ts
-- Regenerasi: node scripts/db-gen-ddl.mjs
--
-- Sifat: idempotent. Aman dijalankan berulang kali di DB kosong maupun DB lama.
--   * CREATE TABLE memakai IF NOT EXISTS
--   * Constraint foreign key dijaga lewat pg_constraint
--   * Kolom yang kurang ditangani oleh scripts/db-sync.mjs (ADD COLUMN IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "performance_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"nik" text NOT NULL,
	"nama_am" text NOT NULL,
	"divisi" text NOT NULL,
	"divisi_cc" text,
	"witel_am" text,
	"witel_cc" text,
	"level_am" text,
	"tahun" integer NOT NULL,
	"bulan" integer NOT NULL,
	"target_revenue" numeric(24, 10) DEFAULT 0 NOT NULL,
	"real_revenue" numeric(24, 10) DEFAULT 0 NOT NULL,
	"target_reguler" numeric(24, 10) DEFAULT 0,
	"real_reguler" numeric(24, 10) DEFAULT 0,
	"target_sustain" numeric(24, 10) DEFAULT 0,
	"real_sustain" numeric(24, 10) DEFAULT 0,
	"target_scaling" numeric(24, 10) DEFAULT 0,
	"real_scaling" numeric(24, 10) DEFAULT 0,
	"target_ngtma" numeric(24, 10) DEFAULT 0,
	"real_ngtma" numeric(24, 10) DEFAULT 0,
	"revenue_base" numeric(24, 10),
	"revenue_billcom" numeric(24, 10),
	"a_rev" numeric(24, 16),
	"a_ngtma" numeric(24, 16),
	"a_scaling" numeric(24, 16),
	"a_sustain" numeric(24, 16),
	"ach_rate" numeric(24, 16) DEFAULT 0 NOT NULL,
	"ach_rate_ytd" numeric(24, 16) DEFAULT 0 NOT NULL,
	"rank_ach" integer DEFAULT 0 NOT NULL,
	"status_warna" text DEFAULT 'merah' NOT NULL,
	"komponen_detail" text,
	"snapshot_date" text,
	"import_id" integer,
	"proporsi" numeric(24, 16) DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "am_funnel_target" (
	"id" serial PRIMARY KEY NOT NULL,
	"nik_am" text NOT NULL,
	"tahun" integer NOT NULL,
	"target_value" real DEFAULT 0 NOT NULL,
	"target_value_dss" real,
	"target_value_dps" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "am_funnel_target_nik_tahun" UNIQUE("nik_am","tahun")
);

CREATE TABLE IF NOT EXISTS "sales_funnel" (
	"id" serial PRIMARY KEY NOT NULL,
	"lopid" text NOT NULL,
	"judul_proyek" text NOT NULL,
	"pelanggan" text NOT NULL,
	"nilai_proyek" real DEFAULT 0 NOT NULL,
	"est_rev" real,
	"divisi" text NOT NULL,
	"segmen" text,
	"witel" text,
	"witel_am" text,
	"witel_cc" text,
	"status_f" text,
	"proses" text,
	"status_proyek" text,
	"kategori_kontrak" text,
	"project_type" text,
	"is_report" text,
	"estimate_bulan" text,
	"month_subs" integer,
	"nama_am" text,
	"nik_am" text,
	"report_date" text,
	"created_date" text,
	"snapshot_date" text,
	"tahun_anggaran" integer,
	"nik_handling" text,
	"nama_pembuat_lop" text,
	"import_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sales_funnel_target" (
	"id" serial PRIMARY KEY NOT NULL,
	"divisi" text,
	"tahun" integer NOT NULL,
	"bulan" integer,
	"target_full_ho" real DEFAULT 0 NOT NULL,
	"target_ho" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sales_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"nik" text NOT NULL,
	"fullname" text,
	"divisi" text,
	"segmen" text,
	"regional" text,
	"witel" text,
	"nipnas" text,
	"ca_name" text,
	"activity_type" text,
	"label" text,
	"lopid" text,
	"createdat_activity" text,
	"activity_start_date" text,
	"activity_end_date" text,
	"pic_name" text,
	"pic_jobtitle" text,
	"pic_role" text,
	"pic_phone" text,
	"activity_notes" text,
	"snapshot_date" text,
	"import_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "data_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"period" text NOT NULL,
	"snapshot_date" text,
	"source_url" text,
	"auto_telegram_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "telegram_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"nik" text NOT NULL,
	"nama_am" text NOT NULL,
	"telegram_chat_id" text,
	"status" text NOT NULL,
	"period" text NOT NULL,
	"message_type" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "telegram_announcement_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"funnel_announce_enabled" boolean DEFAULT false NOT NULL,
	"stagnant_reminder_enabled" boolean DEFAULT false NOT NULL,
	"stagnant_reminder_interval_days" integer DEFAULT 3 NOT NULL,
	"stagnant_reminder_hour_wib" integer DEFAULT 9 NOT NULL,
	"stagnant_reminder_last_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "telegram_bot_users" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"last_message" text DEFAULT '' NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "telegram_bulk_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"created_by_id" integer,
	"created_by_nik" text NOT NULL,
	"created_by_nama" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"used_by_am_id" integer,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_bulk_links_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_bot_token" text,
	"telegram_bot_username" text,
	"sharepoint_performance_url" text,
	"sharepoint_funnel_url" text,
	"sharepoint_activity_url" text,
	"auto_send_on_import" boolean DEFAULT true NOT NULL,
	"kpi_activity_default" integer DEFAULT 30 NOT NULL,
	"g_sheets_spreadsheet_id" text,
	"g_sheets_funnel_spreadsheet_id" text,
	"g_sheets_api_key" text,
	"g_sheets_funnel_pattern" text DEFAULT 'TREG3_SALES_FUNNEL_',
	"g_sheets_sync_enabled" boolean DEFAULT false NOT NULL,
	"g_sheets_sync_hour_wib" integer DEFAULT 6 NOT NULL,
	"g_sheets_sync_interval_days" integer DEFAULT 1 NOT NULL,
	"g_sheets_last_sync_at" timestamp with time zone,
	"g_sheets_last_sync_result" text,
	"g_drive_folder_performance" text,
	"g_drive_folder_funnel" text,
	"g_drive_folder_activity" text,
	"g_drive_folder_target" text,
	"g_drive_sync_enabled" boolean DEFAULT false NOT NULL,
	"g_drive_sync_hour_wib" integer DEFAULT 7 NOT NULL,
	"g_drive_sync_interval_days" integer DEFAULT 1 NOT NULL,
	"g_drive_last_check_at" timestamp with time zone,
	"non_aktif_ams_cleaned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "drive_read_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"folder_id" text,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"files_found" integer DEFAULT 0 NOT NULL,
	"latest_file_name" text,
	"latest_file_date_extracted" text,
	"existing_snapshot_date" text,
	"condition" text NOT NULL,
	"message" text NOT NULL,
	"rows_imported" integer,
	"detail" jsonb
);

CREATE TABLE IF NOT EXISTS "master_customer" (
	"id" serial PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"segmen" text,
	"witel" text DEFAULT 'SURAMADU',
	"divisi_cc" text,
	"divisi_am" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_customer_nama_unique" UNIQUE("nama")
);

CREATE TABLE IF NOT EXISTS "pending_am_discoveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"nik" text NOT NULL,
	"nama" text NOT NULL,
	"divisi" text,
	"witel" text,
	"source" text NOT NULL,
	"import_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "account_managers" (
	"id" serial PRIMARY KEY NOT NULL,
	"nik" text,
	"nama" text NOT NULL,
	"slug" text NOT NULL,
	"email" text,
	"password_hash" text,
	"reset_password_token" text,
	"reset_password_expires" timestamp with time zone,
	"photo_url" text,
	"role_id" integer,
	"role" text DEFAULT 'AM' NOT NULL,
	"tipe" text DEFAULT 'LESA',
	"divisi" text DEFAULT 'DPS' NOT NULL,
	"segmen" text,
	"witel" text DEFAULT 'SURAMADU' NOT NULL,
	"jabatan" text,
	"aktif" boolean DEFAULT true NOT NULL,
	"cross_witel" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"telegram_chat_id" text,
	"telegram_user_id" text,
	"telegram_username" text,
	"telegram_display_name" text,
	"telegram_linked_at" timestamp with time zone,
	"telegram_linked_by_access_code_id" integer,
	"telegram_code" text,
	"telegram_code_expiry" timestamp with time zone,
	"kpi_activity" integer,
	"discovered_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_managers_nik_unique" UNIQUE("nik"),
	CONSTRAINT "account_managers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "account_managers_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "auth_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" varchar(50) NOT NULL,
	"login_method" varchar(30),
	"challenge_id" varchar(50),
	"session_id" integer,
	"ip_address" varchar(45),
	"user_agent" text,
	"device_id" varchar(100),
	"status" varchar(20) DEFAULT 'SUCCESS' NOT NULL,
	"failure_reason" varchar(100),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"refresh_token_hash" varchar(255) NOT NULL,
	"device_id" varchar(100),
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL
);

CREATE TABLE IF NOT EXISTS "otp_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"challenge_id" varchar(50) NOT NULL,
	"otp_hash" varchar(255) NOT NULL,
	"channel" varchar(20) DEFAULT 'TELEGRAM' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_challenge_id_unique" UNIQUE("challenge_id")
);

CREATE TABLE IF NOT EXISTS "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "presentation_sessions" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_nik" varchar(50),
	"user_nama" varchar(255) NOT NULL,
	"user_role" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);

CREATE TABLE IF NOT EXISTS "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "telegram_access_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"code_hash" varchar(255) NOT NULL,
	"created_by" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_bulk_links_created_by_id_account_managers_id_fk') THEN
    ALTER TABLE "telegram_bulk_links" ADD CONSTRAINT "telegram_bulk_links_created_by_id_account_managers_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."account_managers"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_bulk_links_used_by_am_id_account_managers_id_fk') THEN
    ALTER TABLE "telegram_bulk_links" ADD CONSTRAINT "telegram_bulk_links_used_by_am_id_account_managers_id_fk" FOREIGN KEY ("used_by_am_id") REFERENCES "public"."account_managers"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_managers_role_id_roles_id_fk') THEN
    ALTER TABLE "account_managers" ADD CONSTRAINT "account_managers_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_logs_user_id_account_managers_id_fk') THEN
    ALTER TABLE "auth_logs" ADD CONSTRAINT "auth_logs_user_id_account_managers_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_managers"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_logs_session_id_sessions_id_fk') THEN
    ALTER TABLE "auth_logs" ADD CONSTRAINT "auth_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_user_id_account_managers_id_fk') THEN
    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_account_managers_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_managers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'otp_challenges_user_id_account_managers_id_fk') THEN
    ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_account_managers_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_managers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presentation_sessions_user_id_account_managers_id_fk') THEN
    ALTER TABLE "presentation_sessions" ADD CONSTRAINT "presentation_sessions_user_id_account_managers_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_managers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_roles_id_fk') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permission_id_permissions_id_fk') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_access_codes_user_id_account_managers_id_fk') THEN
    ALTER TABLE "telegram_access_codes" ADD CONSTRAINT "telegram_access_codes_user_id_account_managers_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_managers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_access_codes_created_by_account_managers_id_fk') THEN
    ALTER TABLE "telegram_access_codes" ADD CONSTRAINT "telegram_access_codes_created_by_account_managers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."account_managers"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
