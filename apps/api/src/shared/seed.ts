import { db, accountManagersTable, appSettingsTable, salesFunnelTargetTable, rolesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { seedAmFunnelTargets } from "../seeds/seed-am-funnel-targets";

// Role IDs (from RBAC migration)
const ROLE_ID = { ADMIN: 1, MANAGER: 2, OFFICER: 3, ACCOUNT_MANAGER: 4, INPUTER: 5 };

// Default Google Drive folder IDs (TREG3 Suramadu production folders)
const DEFAULT_GDRIVE_FOLDERS = {
  gDriveFolderPerformance: "1qt32nVLMT6Xd3HRXHIZvW4PPN3osuOjX",
  gDriveFolderFunnel:      "1BX1uNVRo7EtqmFdvVQxgtACh21M0-4BT",
  gDriveFolderActivity:    "1sFgsmn016jDQGrIXaRuygj_CTgKKGP16",
  gDriveFolderTarget:      "1O082T_jUbeY5hoaDMJtF-cwH3HfOJDee",
};

const DEFAULT_AMS = [
  { nik: "401431", nama: "NYARI KUSUMANINGRUM",                     slug: "nyari-kusumaningrum",                      tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: true,  discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "402478", nama: "ANA RUKMANA",                              slug: "ana-rukmana",                              tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "403613", nama: "NADYA ZAHROTUL HAYATI",                    slug: "nadya-zahrotul-hayati",                    tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "404429", nama: "WILDAN ARIEF",                             slug: "wildan-arief",                             tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: true,  discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "405075", nama: "KATATA VEKANIDYA SEKAR PUSPITASARI",       slug: "katata-vekanidya-sekar-puspitasari",       tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "405690", nama: "CAESAR RIO ANGGINA TORUAN",                slug: "caesar-rio-anggina-toruan",                tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "850046", nama: "MOH RIZAL BIN MOH. FERRY Y.P. DARA",      slug: "moh-rizal-bin-moh-ferry-yp-dara",          tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "870022", nama: "HAVEA PERTIWI",                            slug: "havea-pertiwi",                            tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "896661", nama: "NI MADE NOVI WIRANA",                      slug: "ni-made-novi-wirana",                      tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "910017", nama: "SAFIRINA FEBRYANTI",                       slug: "safirina-febryanti",                       tipe: "LESA", divisi: "DSS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "910024", nama: "VIVIN VIOLITA",                            slug: "vivin-violita",                            tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "920064", nama: "ERVINA HANDAYANI",                         slug: "ervin-handayani",                          tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: false, discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
  { nik: "980067", nama: "HANDIKA DAGNA NEVANDA",                    slug: "handika-dagna-nevanda",                    tipe: "LESA", divisi: "DPS", witel: "SURAMADU", kpiActivity: 30, aktif: true, crossWitel: true,  discoveredFrom: "seeder", roleId: ROLE_ID.ACCOUNT_MANAGER },
];

const DEFAULT_MANAGER = {
  nik: "850099",
  nama: "RENI WULANSARI",
  slug: "reni-wulansari",
  role: "MANAGER",
  roleId: ROLE_ID.MANAGER,
  tipe: "LESA",
  divisi: "DPS",
  witel: "SURAMADU",
  kpiActivity: 0,
  aktif: true,
  discoveredFrom: "seeder",
};

const DEFAULT_OFFICERS = [
  {
    nik: "950160",
    nama: "DIAN ING TYAS DANANJAYA",
    slug: "dian-ing-tyas-dananjaya",
    role: "OFFICER",
    roleId: ROLE_ID.OFFICER,
    tipe: "LESA",
    divisi: "DPS",
    witel: "SURAMADU",
    kpiActivity: 0,
    aktif: true,
    crossWitel: false,
  },
  {
    nik: "980134",
    nama: "AYU KIRANA",
    slug: "ayu-kirana",
    role: "OFFICER",
    roleId: ROLE_ID.OFFICER,
    tipe: "LESA",
    divisi: "DPS",
    witel: "SURAMADU",
    kpiActivity: 0,
    aktif: true,
    crossWitel: false,
  },
  {
    nik: "940094",
    nama: "KARENDIYA KINASIH",
    slug: "karendiya-kinasih",
    role: "OFFICER",
    roleId: ROLE_ID.OFFICER,
    tipe: "LESA",
    divisi: "DPS",
    witel: "SURAMADU",
    kpiActivity: 0,
    aktif: true,
    crossWitel: false,
  },
];

const DEFAULT_INPUTERS = [
  {
    nik: null,
    nama: "DATA INPUTER",
    slug: "data-inputer",
    role: "INPUTER",
    roleId: ROLE_ID.INPUTER,
    tipe: "LESA",
    divisi: "DPS",
    witel: "SURAMADU",
    kpiActivity: 0,
    aktif: true,
    crossWitel: false,
  },
];

const DEFAULT_FUNNEL_TARGETS = [
  { divisi: "DPS", tahun: 2026, targetFullHo: 97076000000, targetHo: 95973000000 },
  { divisi: "DSS", tahun: 2026, targetFullHo: 73780000000, targetHo: 57036000000 },
];

export async function ensureDefaultSeed(): Promise<void> {
  // ── Seed roles table (idempotent) ─────────────────────────────────────────
  const existingRoles = await db.select({ id: rolesTable.id, code: rolesTable.code }).from(rolesTable);
  const existingCodes = new Set(existingRoles.map(r => r.code));

  const rolesToSeed = [
    { id: 1, code: "ADMIN",           name: "Admin",           level: 10 },
    { id: 2, code: "MANAGER",         name: "Manager",         level: 20 },
    { id: 3, code: "OFFICER",         name: "Officer",         level: 30 },
    { id: 4, code: "ACCOUNT_MANAGER", name: "Account Manager", level: 40 },
    { id: 5, code: "INPUTER",         name: "Inputer",         level: 35 },
  ];

  for (const role of rolesToSeed) {
    if (!existingCodes.has(role.code)) {
      await db.insert(rolesTable).values(role as any);
    }
  }

  // ── One-time cleanup: hapus AM non-aktif yang ditemukan dari import (bukan seed asli)
  // Flag disimpan di app_settings.nonAktifAmsCleaned — hanya dijalankan sekali
  const settingsForCleanup = await db.select({ id: appSettingsTable.id, nonAktifAmsCleaned: appSettingsTable.nonAktifAmsCleaned }).from(appSettingsTable).limit(1);
  const shouldClean = settingsForCleanup.length === 0 || !settingsForCleanup[0].nonAktifAmsCleaned;
  if (shouldClean) {
    await db.delete(accountManagersTable).where(
      and(eq(accountManagersTable.aktif, false), eq(accountManagersTable.role, "AM"))
    );
    if (settingsForCleanup.length > 0) {
      await db.update(appSettingsTable).set({ nonAktifAmsCleaned: true }).where(eq(appSettingsTable.id, settingsForCleanup[0].id));
    }
  }

  // Always upsert all AMs — using onConflictDoNothing so we never overwrite user edits
  // but also never skip if admin/manager accounts already exist in the table
  for (const am of DEFAULT_AMS) {
    await db.insert(accountManagersTable).values(am as any).onConflictDoNothing();
  }

  // Upsert default manager
  await db.insert(accountManagersTable).values(DEFAULT_MANAGER as any).onConflictDoNothing();

  // Upsert default officers (non-admin — no email/password)
  for (const o of DEFAULT_OFFICERS) {
    await db.insert(accountManagersTable).values(o as any).onConflictDoNothing();
  }

  // Upsert default inputers
  for (const inp of DEFAULT_INPUTERS) {
    await db.insert(accountManagersTable).values(inp as any).onConflictDoNothing();
  }

  const googleApiKey = process.env.GOOGLE_API_KEY || null;

  const existingSettings = await db.select({ id: appSettingsTable.id, gSheetsApiKey: appSettingsTable.gSheetsApiKey }).from(appSettingsTable).limit(1);
  if (existingSettings.length === 0) {
    // Fresh install: seed everything including API key and Drive folders
    await db.insert(appSettingsTable).values({
      autoSendOnImport: true,
      kpiActivityDefault: 30,
      gSheetsFunnelPattern: "TREG3_SALES_FUNNEL_",
      gSheetsSyncEnabled: false,
      gSheetsSyncHourWib: 5,
      gSheetsSyncIntervalDays: 1,
      gSheetsApiKey: googleApiKey,
      ...DEFAULT_GDRIVE_FOLDERS,
      gDriveSyncEnabled: false,
      gDriveSyncHourWib: 7,
      gDriveSyncIntervalDays: 1,
    });
  } else {
    // Settings already exist — patch missing fields from env/defaults without overwriting user data
    const current = existingSettings[0];
    const patches: Record<string, any> = {};

    // Apply Google API key from env if DB is still empty
    if (!current.gSheetsApiKey && googleApiKey) {
      patches.gSheetsApiKey = googleApiKey;
    }

    // Apply default Drive folder IDs if missing (patch only, don't overwrite)
    const existingFull = await db.select().from(appSettingsTable).limit(1);
    const s = existingFull[0] as any;
    if (!s.gDriveFolderPerformance) patches.gDriveFolderPerformance = DEFAULT_GDRIVE_FOLDERS.gDriveFolderPerformance;
    if (!s.gDriveFolderFunnel)      patches.gDriveFolderFunnel      = DEFAULT_GDRIVE_FOLDERS.gDriveFolderFunnel;
    if (!s.gDriveFolderActivity)    patches.gDriveFolderActivity    = DEFAULT_GDRIVE_FOLDERS.gDriveFolderActivity;
    if (!s.gDriveFolderTarget)      patches.gDriveFolderTarget      = DEFAULT_GDRIVE_FOLDERS.gDriveFolderTarget;

    if (Object.keys(patches).length > 0) {
      await db.update(appSettingsTable).set(patches).where(eq(appSettingsTable.id, current.id));
    }
  }

  // Upsert sales funnel targets (divisi+tahun) — always update nilai agar production ikut dev
  for (const t of DEFAULT_FUNNEL_TARGETS) {
    const existing = await db.select({ id: salesFunnelTargetTable.id })
      .from(salesFunnelTargetTable)
      .where(and(eq(salesFunnelTargetTable.divisi, t.divisi), eq(salesFunnelTargetTable.tahun, t.tahun)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(salesFunnelTargetTable).values(t);
    } else {
      await db.update(salesFunnelTargetTable)
        .set({ targetFullHo: t.targetFullHo, targetHo: t.targetHo })
        .where(eq(salesFunnelTargetTable.id, existing[0].id));
    }
  }

  // Seed AM-level funnel targets (upsert — safe to run every startup)
  await seedAmFunnelTargets();
}
