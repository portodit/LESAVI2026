import React, { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { useImportPerformance, useImportFunnel, useImportActivity, useListImportHistory } from "@workspace/api-client-react";
import { useToast } from "@/shared/hooks/use-toast";
import { useImportGuard } from "@/shared/hooks/use-import-guard";
import { Button } from "@/shared/ui/button";
import {
  UploadCloud, CheckCircle2, History, Loader2, Calendar,
  AlertCircle, ArrowRight, X, FileSpreadsheet, Trash2,
  Eye, AlertTriangle, RefreshCw, BarChart2, Filter, Activity, Layers, Target, Plus, Save,
  Users, UserCheck, UserX, Pencil, ShieldCheck, ChevronDown, ChevronUp,
  Clock, CircleCheck, CircleX, FolderOpen, Download,
  ListChecks, Terminal, CheckSquare2, Square
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { RowActions } from "@/shared/ui/row-actions";
import { format } from "date-fns";
import { id } from "date-fns/locale";

const TABS = [
  { id: "performansi", label: "Performa AM",   icon: BarChart2, type: "performance" },
  { id: "funnel",      label: "Sales Funnel",  icon: Filter,    type: "funnel" },
  { id: "activity",    label: "Sales Activity", icon: Activity,  type: "activity" },
  { id: "target-ho",  label: "Target HO",      icon: Target,    type: "target" },
  { id: "target-am",  label: "Target AM",      icon: Users,     type: "target-am" },
];

const MONTHS_FULL = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const base = (import.meta.env.BASE_URL || "").replace(/\/$/, "");
  const r = await fetch(`${base}${path}`, { credentials: "include", ...opts });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `API ${r.status}`); }
  return r.json();
}

export function extractDateFromFilename(source: string): { display: string; isoDate: string; period: string } | null {
  // Pattern 1: underscore or hyphen before date: PERFORMANSI_RLEGS_20260607.xlsx, TREG3_ACTIVITY_20260316.xlsx
  const match1 = source.match(/[_-](\d{8})[._?&\s]/);
  if (match1) {
    const raw = match1[1];
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const y = parseInt(year), mo = parseInt(month), d = parseInt(day);
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return {
      isoDate: `${year}-${month}-${day}`,
      period: `${year}-${month}`,
      display: `${day}/${month}/${year}`,
    };
  }
  // Pattern 2: parentheses around date: PERFORMANSI RLEGS 2026 (20260607).xlsx
  const match2 = source.match(/\((\d{8})\)/);
  if (match2) {
    const raw = match2[1];
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const y = parseInt(year), mo = parseInt(month), d = parseInt(day);
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return {
      isoDate: `${year}-${month}-${day}`,
      period: `${year}-${month}`,
      display: `${day}/${month}/${year}`,
    };
  }
}

/** Normalize period display: handle YYYYMM (6-digit), YYYYMMDD (8-digit), and YYYY-MM formats */
function displayPeriod(p: string): string {
  if (!p) return "—";
  if (p.length === 8) return `${p.slice(0, 4)}-${p.slice(4, 6)}`; // YYYYMMDD → YYYY-MM
  if (p.length === 6) return `${p.slice(0, 4)}-${p.slice(4, 6)}`; // YYYYMM → YYYY-MM
  return p; // already YYYY-MM or other
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Read just the sheet names from an Excel file (fast, no full parse) */
async function readSheetNames(file: File): Promise<string[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { bookSheets: true });
        resolve(wb.SheetNames || []);
      } catch {
        resolve([]);
      }
    };
    reader.onerror = () => resolve([]);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Detect if an Excel file uses pivot cache format (data stored in pivotCache XML, not flat sheets).
 * Returns true if pivotCacheDefinition files are found inside the ZIP.
 */
async function isPivotCacheFile(file: File): Promise<boolean> {
  // Read entire file as ASCII and scan for pivotCacheDefinition string.
  // ZIP Central Directory stores all entry names uncompressed — this is the most reliable method.
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const uint8 = new Uint8Array(reader.result as ArrayBuffer);
        // Check ZIP signature first
        if (uint8[0] !== 0x50 || uint8[1] !== 0x4B) { resolve(false); return; }
        // Decode as ASCII and search
        const decoder = new TextDecoder("iso-8859-1");
        const text = decoder.decode(uint8);
        resolve(text.includes("pivotCacheDefinition"));
      } catch { resolve(false); }
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file);
  });
}

function formatSnapshotTitle(createdAt: string, type: string, snapshotDate?: string | null): string {
  const dateStr = snapshotDate || createdAt;
  const date = format(new Date(dateStr), "d MMMM yyyy", { locale: id });
  const upper = date.toUpperCase();
  if (type === "performance") return `SNAPSHOT PERFORMANSI AM WITEL SURAMADU (${upper})`;
  if (type === "funnel") return `SNAPSHOT SALES FUNNEL WITEL SURAMADU (${upper})`;
  return `SNAPSHOT SALES ACTIVITY WITEL SURAMADU (${upper})`;
}

type ConflictInfo = {
  error: string;
  existingId: number;
  existingRows: number;
  period: string;
  importedAt: string;
  pendingBody: any;
  pendingTab: string;
};

type SheetPicker = {
  file: File;
  sheets: string[];
};

// ─── Activity Cleaning Checklist ──────────────────────────────────────────────

const ACTIVITY_CLEANING_STEPS = [
  {
    id: 1, threshold: 5,
    label: "Filter folder path: Sales_Activity_Suramadu",
    detail: "Table.SelectRows — hanya baca file dari subfolder yang benar",
    code: `= Table.SelectRows(#"Filtered Rows", each Text.Contains([Folder Path], "Sales_Activity_Suramadu"))`,
  },
  {
    id: 2, threshold: 12,
    label: "Filter file tersembunyi dihapus",
    detail: `Table.SelectRows — Attributes[Hidden] <> true`,
    code: `= Table.SelectRows(#"Filtered Rows1", each [Attributes]?[Hidden]? <> true)`,
  },
  {
    id: 3, threshold: 22,
    label: "Baca & gabungkan semua file (Folder Connector)",
    detail: "Table.AddColumn — invoke transform function untuk setiap file",
    code: `= Table.AddColumn(#"Filtered Hidden Files1", "Transform File (2)", each #"Transform File (2)"([Content]))`,
  },
  {
    id: 4, threshold: 33,
    label: `Rename kolom "Name" → "Source.Name"`,
    detail: "Table.RenameColumns — preservasi nama file sumber",
    code: `= Table.RenameColumns(#"Invoke Custom Function1", {"Name", "Source.Name"})`,
  },
  {
    id: 5, threshold: 44,
    label: "Pilih kolom: Source.Name + Transform File",
    detail: "Table.SelectColumns — hapus kolom tidak relevan",
    code: `= Table.SelectColumns(#"Renamed Columns1", {"Source.Name", "Transform File (2)"})`,
  },
  {
    id: 6, threshold: 55,
    label: "Expand semua kolom dari tabel gabungan",
    detail: "Table.ExpandTableColumn — 20 kolom: nik, fullname, divisi, ca_name, dll",
    code: `= Table.ExpandTableColumn(#"Removed Other Columns1", "Transform File (2)", ...)`,
  },
  {
    id: 7, threshold: 68,
    label: "Set tipe kolom",
    detail: "Table.TransformColumnTypes — nik→Int64, createdat/start/end_date→datetime",
    code: `= Table.TransformColumnTypes(..., {{"nik", Int64.Type}, {"createdat", type datetime}, ...})`,
  },
  {
    id: 8, threshold: 85,
    label: "Filter: (divisi=DPS atau DSS) AND witel=SURAMADU",
    detail: "Table.SelectRows — filter final sesuai Power BI, target 1.300+ baris",
    code: `= Table.SelectRows(#"Changed Type", each ([divisi] = "DPS" or [divisi] = "DSS") and ([witel] = "SURAMADU"))`,
  },
];

function ActivityCleaningChecklist({ progress }: { progress: { percent: number; stage: string } | null }) {
  const [expanded, setExpanded] = useState(false);
  const pct = progress?.percent ?? -1;
  const isImporting = progress !== null && progress.percent < 100;
  const isDone = progress?.percent === 100;

  const getStepStatus = (step: typeof ACTIVITY_CLEANING_STEPS[0], idx: number) => {
    if (isDone) return "done";
    if (pct < 0) return "pending";
    if (pct >= step.threshold) return "done";
    const prevThreshold = idx === 0 ? 0 : ACTIVITY_CLEANING_STEPS[idx - 1].threshold;
    if (pct > prevThreshold) return "active";
    return "pending";
  };

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all duration-300",
      isImporting ? "border-primary/30 bg-primary/[0.02]" : isDone ? "border-emerald-200 bg-emerald-50/30" : "border-border bg-secondary/30"
    )}>
      {/* Header */}
      <button
        type="button"
        onClick={() => { if (!isImporting) setExpanded(e => !e); }}
        className={cn(
          "w-full px-4 py-2.5 flex items-center gap-2 text-left",
          isImporting ? "bg-primary/5" : isDone ? "bg-emerald-50/60" : "bg-secondary/60 hover:bg-secondary/80",
          "border-b border-border/60 transition-colors"
        )}
      >
        <ListChecks className={cn("w-3.5 h-3.5 shrink-0", isImporting ? "text-primary" : isDone ? "text-emerald-600" : "text-primary/60")} />
        <span className="text-xs font-bold text-foreground flex-1">
          Prosedur Cleaning Power BI
          <span className="font-normal text-muted-foreground ml-1.5">(8 langkah Power Query)</span>
        </span>
        {isImporting && (
          <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full animate-pulse shrink-0">
            Sedang berjalan...
          </span>
        )}
        {isDone && (
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
            ✓ Semua selesai
          </span>
        )}
        {!isImporting && !isDone && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0 flex items-center gap-0.5">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Tutup" : "Lihat detail"}
          </span>
        )}
      </button>

      {/* Checklist body — always visible when importing, collapsed otherwise */}
      {(isImporting || isDone || expanded) && (
        <div className="px-4 py-3 space-y-1.5">
          {ACTIVITY_CLEANING_STEPS.map((step, idx) => {
            const status = getStepStatus(step, idx);
            return (
              <div key={step.id} className={cn(
                "flex items-start gap-2.5 transition-all duration-300",
                status === "pending" ? "opacity-40" : "opacity-100"
              )}>
                {/* Status icon */}
                <div className="shrink-0 mt-[1px]">
                  {status === "done" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : status === "active" ? (
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-border/50 bg-transparent" />
                  )}
                </div>
                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-xs font-semibold leading-tight",
                    status === "done" ? "text-foreground" : status === "active" ? "text-primary" : "text-muted-foreground"
                  )}>
                    <span className="font-mono text-[10px] text-muted-foreground/60 mr-1">#{step.id}</span>
                    {step.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">{step.detail}</div>
                  {(expanded || isImporting || isDone) && (
                    <div className="mt-1 px-2 py-1 rounded bg-secondary/80 border border-border/40 font-mono text-[9px] text-foreground/50 leading-relaxed break-all">
                      {step.code}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Info note */}
          <div className="pt-1.5 mt-1.5 border-t border-border/40 text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-semibold text-muted-foreground">Catatan:</span>{" "}
            Baris dengan <code className="bg-secondary px-0.5 rounded">ca_name</code> kosong (aktivitas "Tanpa Pelanggan") tetap disimpan. Dedup otomatis via constraint{" "}
            <code className="bg-secondary px-0.5 rounded">(nik, createdat_activity)</code>.
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImportData() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("performansi");
  const [files, setFiles] = useState<Record<string, File | null>>({ performansi: null, funnel: null, activity: null });
  const [sheetNames, setSheetNames] = useState<Record<string, string>>({ performansi: "", funnel: "", activity: "" });
  const [snapshotOverride, setSnapshotOverride] = useState<Record<string, string>>({ performansi: "", funnel: "", activity: "" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [sheetPicker, setSheetPicker] = useState<SheetPicker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { setIsImporting } = useImportGuard();

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  const [isOverwriting, setIsOverwriting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ percent: number; stage: string } | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const qc = useQueryClient();
  const { data: history, refetch } = useListImportHistory();
  const perfMut = useImportPerformance();
  const funnelMut = useImportFunnel();
  const actMut = useImportActivity();

  // Target HO state
  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const [tSaving, setTSaving] = useState(false);
  const [tDelConfirm, setTDelConfirm] = useState<number | null>(null);
  const [editRowId, setEditRowId] = useState<number | "new" | null>(null);
  const [editRowData, setEditRowData] = useState({ tahun: String(curYear), divisi: "DPS", targetHo: "", targetFullHo: "" });
  const [focusField, setFocusField] = useState<string | null>(null);
  const [labelHo, setLabelHo] = useState(() => localStorage.getItem("label_target_ho") || "Target HO");
  const [labelFullHo, setLabelFullHo] = useState(() => localStorage.getItem("label_target_full_ho") || "Target FULL (HO+BA)");
  const [editingHeader, setEditingHeader] = useState<"ho" | "fullho" | null>(null);
  const [headerEditVal, setHeaderEditVal] = useState("");
  const saveHeaderLabel = (field: "ho" | "fullho", val: string) => {
    const trimmed = val.trim() || (field === "ho" ? "Target HO" : "Target FULL (HO+BA)");
    if (field === "ho") { localStorage.setItem("label_target_ho", trimmed); setLabelHo(trimmed); }
    else { localStorage.setItem("label_target_full_ho", trimmed); setLabelFullHo(trimmed); }
    setEditingHeader(null);
  };
  const { data: targets = [], refetch: refetchTargets } = useQuery<any[]>({
    queryKey: ["funnel-targets"],
    queryFn: () => apiFetch("/api/funnel/targets"),
    staleTime: 30_000,
  });

  // Target AM state
  const [amTahun, setAmTahun] = useState(String(curYear));
  const [amTargetSaving, setAmTargetSaving] = useState(false);
  const [amTargetDelConfirm, setAmTargetDelConfirm] = useState<number | null>(null);
  const [amTargetEditId, setAmTargetEditId] = useState<string | null>(null);
  const [amTargetEditVal, setAmTargetEditVal] = useState("");
  const { data: masterAmsRaw = [] } = useQuery<any[]>({
    queryKey: ["master-am"],
    queryFn: async () => {
      const res = await apiFetch<any>("/api/funnel/master-am");
      return Array.isArray(res) ? res : (res?.rows ?? []);
    },
    staleTime: 60_000,
  });
  const masterAmsActive = masterAmsRaw.filter((m: any) => m.aktif && (m.role === "AM" || m.role === "ACCOUNT_MANAGER") && m.nik);
  const { data: amTargetsDB = [], refetch: refetchAmTargets } = useQuery<any[]>({
    queryKey: ["funnel-am-targets", amTahun],
    queryFn: () => apiFetch(`/api/funnel/am-targets?tahun=${amTahun}`),
    staleTime: 0,
  });
  const amTargetMap = Object.fromEntries(Array.isArray(amTargetsDB) ? amTargetsDB.map((r: any) => [r.nikAm, r]) : []);

  // Google Drive sync state
  const [driveListLoading, setDriveListLoading] = useState<Record<string, boolean>>({});
  const [driveFiles, setDriveFiles] = useState<Record<string, any[]>>({});
  const [driveSyncing, setDriveSyncing] = useState<Record<string, boolean>>({});
  const [driveSyncResult, setDriveSyncResult] = useState<Record<string, any>>({});
  // Upload mode per tab: "manual" | "drive"
  const [uploadMode, setUploadMode] = useState<Record<string, "manual" | "drive">>({ performansi: "manual", funnel: "manual", activity: "manual" });
  // Date override for Drive mode per driveType ("performance" | "funnel" | "activity")
  const [driveSnapshotOverride, setDriveSnapshotOverride] = useState<Record<string, string>>({});
  // Progress simulation for Drive sync
  const [driveProgress, setDriveProgress] = useState<Record<string, { percent: number; stage: string } | null>>({});
  const driveProgressRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // Multi-select per driveType
  const [driveSelectedFiles, setDriveSelectedFiles] = useState<Record<string, Record<string, boolean>>>({});
  // Sync log — keyed by driveType so each tab has its own log
  type SyncLogEntry = { fileId: string; fileName: string; status: "waiting" | "running" | "ok" | "error"; message: string; rows?: number };
  const [syncLog, setSyncLog] = useState<Record<string, SyncLogEntry[]>>({});
  const [syncLogOpen, setSyncLogOpen] = useState<Record<string, boolean>>({});

  const { data: appSettings } = useQuery<any>({
    queryKey: ["app-settings-gs"],
    queryFn: () => apiFetch("/api/settings"),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!appSettings) return;
    setUploadMode(p => ({
      performansi: appSettings.gDriveFolderPerformance ? "drive" : p.performansi,
      funnel: appSettings.gDriveFolderFunnel ? "drive" : p.funnel,
      activity: appSettings.gDriveFolderActivity ? "drive" : p.activity,
    }));
  }, [appSettings]);

  const handleDriveList = async (type: string) => {
    setDriveListLoading(p => ({ ...p, [type]: true }));
    setDriveFiles(p => ({ ...p, [type]: [] }));
    try {
      const data = await apiFetch<{ files: any[] }>(`/api/gdrive/list?type=${type}`);
      const files = data.files || [];
      setDriveFiles(p => ({ ...p, [type]: files }));
      // Auto-detect snapshot date from latest file name
      if (files.length > 0) {
        const detected = extractDateFromFilename(files[0].name);
        if (detected) {
          setDriveSnapshotOverride(p => ({ ...p, [type]: detected.isoDate }));
        }
      }
    } catch (e: any) {
      toast({ title: "Gagal Memuat Daftar File", description: e.message, variant: "destructive" });
    } finally { setDriveListLoading(p => ({ ...p, [type]: false })); }
  };

  const DRIVE_STAGES = [
    { to: 15, step: 1.2, label: "Menghubungi Google Drive..." },
    { to: 40, step: 0.5, label: "Mengunduh file Excel..." },
    { to: 75, step: 0.3, label: "Proses cleaning & import data..." },
    { to: 95, step: 0.04, label: "Menyimpan ke database..." },
  ];

  const startDriveProgress = (type: string) => {
    let p = 0; let si = 0;
    setDriveProgress(prev => ({ ...prev, [type]: { percent: 0, stage: DRIVE_STAGES[0].label } }));
    driveProgressRef.current[type] = setInterval(() => {
      p += DRIVE_STAGES[si].step;
      if (p >= DRIVE_STAGES[si].to && si < DRIVE_STAGES.length - 1) si++;
      const capped = Math.min(p, DRIVE_STAGES[si].to);
      setDriveProgress(prev => ({ ...prev, [type]: { percent: Math.round(capped), stage: DRIVE_STAGES[si].label } }));
    }, 50);
  };

  const stopDriveProgress = (type: string, success: boolean) => {
    if (driveProgressRef.current[type]) {
      clearInterval(driveProgressRef.current[type]);
      delete driveProgressRef.current[type];
    }
    if (success) {
      setDriveProgress(prev => ({ ...prev, [type]: { percent: 100, stage: "Selesai ✓" } }));
      setTimeout(() => setDriveProgress(prev => ({ ...prev, [type]: null })), 2500);
    } else {
      setDriveProgress(prev => ({ ...prev, [type]: null }));
    }
  };

  const handleDriveSync = async (type: string, fileId?: string, snapshotDateDirect?: string) => {
    setDriveSyncing(p => ({ ...p, [type]: true }));
    setDriveSyncResult(p => ({ ...p, [type]: null }));
    startDriveProgress(type);
    try {
      const snapshotDate = snapshotDateDirect ?? driveSnapshotOverride[type] ?? undefined;
      const result = await apiFetch<any>(`/api/gdrive/sync?type=${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, snapshotDate: snapshotDate || undefined }),
      });
      stopDriveProgress(type, true);
      setDriveSyncResult(p => ({ ...p, [type]: result }));
      refetch();
      toast({ title: "Sync Berhasil", description: `${result.imported} baris diimport dari "${result.fileName}"` });
      if ((result.newAmDiscovered ?? 0) > 0) {
        setTimeout(() => {
          toast({
            title: `🔔 ${result.newAmDiscovered} AM Baru Terdeteksi`,
            description: `NIK baru ditemukan dari data import. Buka halaman Manajemen Akun untuk menyetujui penambahan AM.`,
          });
        }, 600);
      }
    } catch (e: any) {
      stopDriveProgress(type, false);
      toast({ title: "Sync Gagal", description: e.message, variant: "destructive" });
    } finally { setDriveSyncing(p => ({ ...p, [type]: false })); }
  };

  const handleDriveSyncBatch = async (type: string, filesToSync: any[]) => {
    if (filesToSync.length === 0) return;
    const entries: SyncLogEntry[] = filesToSync.map(f => ({
      fileId: f.id, fileName: f.name, status: "waiting", message: "Menunggu...",
    }));
    setSyncLog(p => ({ ...p, [type]: entries }));
    setSyncLogOpen(p => ({ ...p, [type]: true }));
    setDriveSyncing(p => ({ ...p, [type]: true }));
    setDriveSyncResult(p => ({ ...p, [type]: null }));
    startDriveProgress(type);
    let anyOk = false;
    for (let i = 0; i < filesToSync.length; i++) {
      const f = filesToSync[i];
      setSyncLog(prev => ({ ...prev, [type]: (prev[type] || []).map((e, idx) => idx === i ? { ...e, status: "running", message: "Sedang download & import..." } : e) }));
      try {
        const fDetected = extractDateFromFilename(f.name);
        const result = await apiFetch<any>(`/api/gdrive/sync?type=${type}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: f.id, snapshotDate: fDetected?.isoDate || driveSnapshotOverride[type] || undefined }),
        });
        setSyncLog(prev => ({ ...prev, [type]: (prev[type] || []).map((e, idx) => idx === i ? { ...e, status: "ok", message: `${result.imported} baris berhasil diimport`, rows: result.imported } : e) }));
        anyOk = true;
      } catch (e: any) {
        setSyncLog(prev => ({ ...prev, [type]: (prev[type] || []).map((e2, idx) => idx === i ? { ...e2, status: "error", message: e.message || "Gagal" } : e2) }));
      }
    }
    stopDriveProgress(type, anyOk);
    setDriveSyncing(p => ({ ...p, [type]: false }));
    if (anyOk) refetch();
  };

  // Data Quality proof state
  const [dqExpanded, setDqExpanded] = useState(false);
  const { data: dqData } = useQuery<any>({
    queryKey: ["data-quality"],
    queryFn: () => apiFetch("/api/funnel/data-quality"),
    staleTime: 60_000,
  });

  const handleSaveTargetRow = async () => {
    if (!editRowData.tahun || !editRowData.divisi) {
      toast({ title: "Lengkapi data", description: "Tahun dan divisi wajib diisi", variant: "destructive" }); return;
    }
    setTSaving(true);
    try {
      await apiFetch("/api/funnel/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tahun: Number(editRowData.tahun),
          divisi: editRowData.divisi,
          targetHo: Number(editRowData.targetHo.replace(/\D/g, "") || 0),
          targetFullHo: Number(editRowData.targetFullHo.replace(/\D/g, "") || 0),
        }),
      });
      toast({ title: "Tersimpan", description: `${editRowData.divisi} ${editRowData.tahun}` });
      refetchTargets();
      qc.invalidateQueries({ queryKey: ["funnel-data"] });
      qc.invalidateQueries({ queryKey: ["funnel-data-pres"] });
      setEditRowId(null);
      setFocusField(null);
    } catch (e: any) {
      toast({ title: "Gagal Menyimpan", description: e.message || "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setTSaving(false);
    }
  };

  const handleDeleteTarget = async (id: number) => {
    try {
      await apiFetch(`/api/funnel/targets/${id}`, { method: "DELETE" });
      toast({ title: "Target Dihapus" });
      setTDelConfirm(null);
      refetchTargets();
      qc.invalidateQueries({ queryKey: ["funnel-data"] });
      qc.invalidateQueries({ queryKey: ["funnel-data-pres"] });
    } catch (e: any) {
      toast({ title: "Gagal Menghapus", description: e.message, variant: "destructive" });
    }
  };

  const activeTabData = TABS.find(t => t.id === activeTab)!;
  const currentFile = files[activeTab] || null;
  const currentSnapshotOverride = snapshotOverride[activeTab] || "";
  const currentSheetName = sheetNames[activeTab] || "";

  const fileDetected = currentFile ? extractDateFromFilename(currentFile.name) : null;
  // Final snapshot = override OR auto-detected from filename
  const finalSnapshotDate = currentSnapshotOverride || fileDetected?.isoDate || null;
  const finalPeriod = finalSnapshotDate ? finalSnapshotDate.slice(0, 7) : fileDetected?.period || null;

  const isPending =
    (activeTab === "performansi" && perfMut.isPending) ||
    (activeTab === "funnel" && funnelMut.isPending) ||
    (activeTab === "activity" && actMut.isPending);

  // Block browser back/reload while importing
  useEffect(() => {
    if (!isPending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Import sedang berjalan, yakin ingin meninggalkan halaman?";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isPending]);

  const filteredHistory = history?.filter(h => h.type === activeTabData.type) || [];
  // Show warning only for actual conflict (same period + same snapshot date)
  const sameDayImport = filteredHistory.find(h =>
    finalPeriod && h.period?.replace("-", "") === finalPeriod.replace("-", "") &&
    h.snapshotDate === finalSnapshotDate
  );

  // ── File selection handler ─────────────────────────────────────────────────
  const applyFile = useCallback(async (file: File) => {
    // ALWAYS clear sheet picker FIRST — prevents ghost modal from previous session
    setSheetPicker(null);

    // Check if this is a pivot cache file FIRST
    const pivot = await isPivotCacheFile(file);

    if (pivot) {
      // For pivot cache files: auto-detect date and use without sheet selection
      const detected = extractDateFromFilename(file.name);
      if (detected) {
        setSnapshotOverride(prev => ({ ...prev, [activeTab]: detected.isoDate }));
      }
      // Set file with empty sheet name (backend will extract from pivot cache)
      setFiles(prev => ({ ...prev, [activeTab]: file }));
      setSheetNames(prev => ({ ...prev, [activeTab]: ""}));
      return;
    }

    // Normal file: read sheet names and show picker if multiple
    const sheets = await readSheetNames(file);
    if (sheets.length > 1) {
      setSheetPicker({ file, sheets });
    } else {
      commitFile(file, sheets[0] || "");
    }
  }, [activeTab]);

  const commitFile = useCallback((file: File, sheet: string) => {
    setFiles(prev => ({ ...prev, [activeTab]: file }));
    setSheetNames(prev => ({ ...prev, [activeTab]: sheet }));
    // Auto-fill snapshot date from filename
    const detected = extractDateFromFilename(file.name);
    if (detected) {
      setSnapshotOverride(prev => ({ ...prev, [activeTab]: detected.isoDate }));
    }
    setSheetPicker(null);
  }, [activeTab]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
    e.target.value = "";
  };

  const clearFile = () => {
    setFiles(prev => ({ ...prev, [activeTab]: null }));
    setSheetNames(prev => ({ ...prev, [activeTab]: "" }));
    setSnapshotOverride(prev => ({ ...prev, [activeTab]: "" }));
  };

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) {
      applyFile(file);
    } else if (file) {
      toast({ title: "Format Tidak Didukung", description: "Hanya file .xlsx atau .xls yang diperbolehkan", variant: "destructive" });
    }
  };

  // ── Progress simulation ────────────────────────────────────────────────────
  const PROGRESS_STAGES = [
    { to: 20,  step: 0.8,   label: "Membaca & encode file..." },
    { to: 60,  step: 0.4,   label: "Proses cleaning data..." },
    { to: 95,  step: 0.04,  label: "Menyimpan ke database..." },
  ];

  function startProgressSim() {
    let p = 0;
    let si = 0;
    setImportProgress({ percent: 0, stage: PROGRESS_STAGES[0].label });
    setIsImporting(true);
    progressIntervalRef.current = setInterval(() => {
      p += PROGRESS_STAGES[si].step;
      if (p >= PROGRESS_STAGES[si].to && si < PROGRESS_STAGES.length - 1) si++;
      const capped = Math.min(p, PROGRESS_STAGES[si].to);
      setImportProgress({ percent: Math.round(capped), stage: PROGRESS_STAGES[si].label });
    }, 50);
  }

  function stopProgressSim(success: boolean) {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setIsImporting(false);
    if (success) {
      setImportProgress({ percent: 100, stage: "Selesai ✓" });
      setTimeout(() => setImportProgress(null), 2000);
    } else {
      setImportProgress(null);
    }
  }

  // ── Import logic ───────────────────────────────────────────────────────────
  const buildBody = async (): Promise<any | null> => {
    if (!currentFile) {
      toast({ title: "File Kosong", description: "Pilih file Excel terlebih dahulu", variant: "destructive" });
      return null;
    }
    try {
      const fileData = await fileToBase64(currentFile);
      const body: any = { fileData };
      if (currentSheetName) body.sheetName = currentSheetName;
      if (finalPeriod) body.period = finalPeriod;
      if (finalSnapshotDate) body.snapshotDate = finalSnapshotDate;
      return body;
    } catch {
      toast({ title: "Gagal Membaca File", description: "File tidak dapat dibaca", variant: "destructive" });
      return null;
    }
  };

  const runImport = async (body: any, tab: string) => {
    const mut = tab === "performansi" ? perfMut : tab === "funnel" ? funnelMut : actMut;
    const tabData = TABS.find(t => t.id === tab)!;
    const res = await mut.mutateAsync({ data: body });
    const extraInfo = (res as any).rawCount != null
      ? ` (${(res as any).rawCount} baris mentah, ${res.rowsImported} lolos cleaning)`
      : ` (${res.rowsImported} baris)`;
    toast({
      title: "Import Berhasil",
      description: `Data ${tabData.label} berhasil diimport${extraInfo}. Periode: ${res.period}`,
    });
    const discovered = (res as any).newAmDiscovered ?? 0;
    if (discovered > 0) {
      setTimeout(() => {
        toast({
          title: `🔔 ${discovered} AM Baru Terdeteksi`,
          description: `NIK baru ditemukan dari data import. Buka halaman Manajemen Akun untuk melihat dan menyetujui penambahan AM.`,
        });
      }, 600);
    }
    setConflictInfo(null);
    refetch();
  };

  const handleSync = async () => {
    const body = await buildBody();
    if (!body) return;
    startProgressSim();
    try {
      await runImport(body, activeTab);
      stopProgressSim(true);
    } catch (e: any) {
      stopProgressSim(false);
      const errData = e?.data || e?.error;
      if (e?.status === 409 || errData?.conflict) {
        const info = errData || e?.data;
        setConflictInfo({
          error: info?.error || "Data periode ini sudah ada",
          existingId: info?.existingId,
          existingRows: info?.existingRows,
          period: info?.period,
          importedAt: info?.importedAt,
          pendingBody: body,
          pendingTab: activeTab,
        });
        return;
      }
      const errMsg = e?.data?.error || e?.error?.error || e?.message || "Gagal menghubungi server";
      toast({ title: "Import Gagal", description: errMsg, variant: "destructive" });
    }
  };

  const handleOverwrite = async () => {
    if (!conflictInfo) return;
    setIsOverwriting(true);
    startProgressSim();
    try {
      await runImport({ ...conflictInfo.pendingBody, forceOverwrite: true }, conflictInfo.pendingTab);
      stopProgressSim(true);
    } catch (e: any) {
      stopProgressSim(false);
      const errMsg = e?.data?.error || e?.message || "Gagal menimpa data";
      toast({ title: "Gagal Menimpa", description: errMsg, variant: "destructive" });
    } finally {
      setIsOverwriting(false);
    }
  };

  const handleDeleteImport = async (importId: number) => {
    setIsDeleting(true);
    try {
      const base = (import.meta.env.BASE_URL || "").replace(/\/$/, "");
      const res = await fetch(`${base}/api/import/${importId}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menghapus");
      toast({ title: "Import Dihapus", description: data.message });
      setDeleteConfirmId(null);
      refetch();
    } catch (e: any) {
      toast({ title: "Gagal Menghapus", description: e.message || "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sheet Picker Modal */}
      {sheetPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <Layers className="w-4 h-4 text-primary" />
              <div>
                <p className="font-display font-bold text-sm text-foreground">Pilih Sheet</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[220px]">{sheetPicker.file.name}</p>
              </div>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-muted-foreground mb-3">File ini memiliki {sheetPicker.sheets.length} sheet. Pilih sheet yang berisi data:</p>
              {sheetPicker.sheets.map(sheet => (
                <button
                  key={sheet}
                  onClick={() => commitFile(sheetPicker.file, sheet)}
                  className="w-full text-left px-4 py-2.5 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 text-sm font-medium text-foreground transition-all"
                >
                  {sheet}
                </button>
              ))}
            </div>
            <div className="px-4 pb-4">
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setSheetPicker(null)}>
                Batal
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Warning Banner */}
      {conflictInfo && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-display font-bold text-amber-900 text-sm mb-1">Data Duplikat Terdeteksi</p>
              <p className="text-amber-800 text-xs mb-3">{conflictInfo.error}</p>
              <div className="bg-amber-100/70 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-amber-700">Import yang ada:</span><span className="font-semibold text-amber-900">#{conflictInfo.existingId}</span></div>
                <div className="flex justify-between"><span className="text-amber-700">Baris lama:</span><span className="font-semibold text-amber-900">{conflictInfo.existingRows?.toLocaleString("id-ID")} baris</span></div>
                <div className="flex justify-between"><span className="text-amber-700">Waktu import lama:</span><span className="font-semibold text-amber-900">{conflictInfo.importedAt ? format(new Date(conflictInfo.importedAt), "dd MMM yyyy, HH:mm", { locale: id }) : "-"}</span></div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={handleOverwrite} disabled={isOverwriting} className="bg-amber-600 hover:bg-amber-700">
                  {isOverwriting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  Timpa Data Lama
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConflictInfo(null)} disabled={isOverwriting}>Batalkan</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main card */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Tab bar — disabled while importing */}
        <div className="flex border-b border-border bg-secondary/20">
          {TABS.map(tab => (
            <button
              key={tab.id}
              disabled={isPending && activeTab !== tab.id}
              onClick={() => { if (!isPending) { setActiveTab(tab.id); setConflictInfo(null); } }}
              title={isPending && activeTab !== tab.id ? "Tunggu import selesai sebelum ganti tab" : undefined}
              className={cn(
                "flex items-center gap-2 px-5 py-4 text-sm font-semibold transition-all relative",
                activeTab === tab.id ? "text-primary" : "text-muted-foreground hover:text-foreground",
                isPending && activeTab !== tab.id && "opacity-40 cursor-not-allowed pointer-events-none"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
              )}
            </button>
          ))}
          {isPending && (
            <div className="ml-auto flex items-center px-4 text-[11px] text-amber-600 dark:text-amber-400 font-medium gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Import berjalan...
            </div>
          )}
        </div>

        {/* Target HO Tab Content — Excel-style inline edit */}
        {activeTab === "target-ho" && (
          <div className="p-6">
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-red-700 text-white">
                      <th className="px-4 py-2.5 text-xs font-black uppercase w-24">Tahun</th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase w-24">Divisi</th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase text-right">
                        {editingHeader === "ho" ? (
                          <input autoFocus value={headerEditVal}
                            onChange={e => setHeaderEditVal(e.target.value)}
                            onBlur={() => saveHeaderLabel("ho", headerEditVal)}
                            onKeyDown={e => { if (e.key === "Enter") saveHeaderLabel("ho", headerEditVal); if (e.key === "Escape") setEditingHeader(null); }}
                            className="bg-transparent border-b border-white text-white text-xs font-black uppercase text-right w-full focus:outline-none placeholder-white/50"
                            placeholder="Target HO"
                          />
                        ) : (
                          <button onClick={() => { setHeaderEditVal(labelHo); setEditingHeader("ho"); }}
                            className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity group/hdr">
                            {labelHo}
                            <Pencil className="w-2.5 h-2.5 opacity-50 group-hover/hdr:opacity-100" />
                          </button>
                        )}
                      </th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase text-right">
                        {editingHeader === "fullho" ? (
                          <input autoFocus value={headerEditVal}
                            onChange={e => setHeaderEditVal(e.target.value)}
                            onBlur={() => saveHeaderLabel("fullho", headerEditVal)}
                            onKeyDown={e => { if (e.key === "Enter") saveHeaderLabel("fullho", headerEditVal); if (e.key === "Escape") setEditingHeader(null); }}
                            className="bg-transparent border-b border-white text-white text-xs font-black uppercase text-right w-full focus:outline-none placeholder-white/50"
                            placeholder="Target FULL (HO+BA)"
                          />
                        ) : (
                          <button onClick={() => { setHeaderEditVal(labelFullHo); setEditingHeader("fullho"); }}
                            className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity group/hdr">
                            {labelFullHo}
                            <Pencil className="w-2.5 h-2.5 opacity-50 group-hover/hdr:opacity-100" />
                          </button>
                        )}
                      </th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase text-right w-24">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {targets.length === 0 && editRowId !== "new" && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-sm">
                          <Target className="w-8 h-8 mx-auto mb-3 opacity-20" />
                          Belum ada data. Klik <span className="font-semibold text-primary">+ Tambah Baris</span> di bawah.
                        </td>
                      </tr>
                    )}

                    {targets.map((t: any) => {
                      const isEditing = editRowId === t.id;
                      const isDeleting = tDelConfirm === t.id;
                      return (
                        <tr
                          key={t.id}
                          className={cn(
                            "transition-colors group",
                            isDeleting ? "bg-red-50" : isEditing ? "bg-yellow-50" : "hover:bg-secondary/20"
                          )}
                          onDoubleClick={(e) => {
                            if (isEditing) return;
                            const td = (e.target as Element).closest("td");
                            const idx = td ? Array.from(td.parentElement!.children).indexOf(td) : -1;
                            setEditRowId(t.id);
                            setEditRowData({
                              tahun: String(t.tahun),
                              divisi: t.divisi || "DPS",
                              targetHo: String(t.targetHo || ""),
                              targetFullHo: String(t.targetFullHo || ""),
                            });
                            if (idx === 2) setFocusField("targetHo");
                            else if (idx === 3) setFocusField("targetFullHo");
                            else setFocusField(null);
                          }}
                        >
                          {/* TAHUN */}
                          <td className="px-2 py-1.5">
                            {isEditing ? (
                              <input
                                type="number" min="2020" max="2099"
                                value={editRowData.tahun}
                                ref={el => { if (el && (focusField === "tahun" || focusField === null)) { el.focus(); el.select(); } }}
                                onChange={e => setEditRowData(p => ({ ...p, tahun: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                                className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm font-mono focus:outline-none"
                              />
                            ) : (
                              <span className="px-2 font-mono text-sm">{t.tahun}</span>
                            )}
                          </td>
                          {/* DIVISI */}
                          <td className="px-2 py-1.5">
                            {isEditing ? (
                              <select
                                value={editRowData.divisi}
                                onChange={e => setEditRowData(p => ({ ...p, divisi: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                                className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm focus:outline-none"
                              >
                                <option value="DPS">DPS</option>
                                <option value="DSS">DSS</option>
                              </select>
                            ) : (
                              <span className={cn("text-xs font-bold px-2 py-0.5 rounded", t.divisi === "DPS" ? "bg-blue-100 text-blue-800" : "bg-violet-100 text-violet-800")}>
                                {t.divisi || "—"}
                              </span>
                            )}
                          </td>
                          {/* TARGET HO */}
                          <td className="px-2 py-1.5 text-right">
                            {isEditing ? (
                              <input
                                type="text" placeholder="0"
                                ref={el => { if (el && focusField === "targetHo") { el.focus(); el.select(); } }}
                                value={editRowData.targetHo}
                                onChange={e => setEditRowData(p => ({ ...p, targetHo: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                                className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm font-mono text-right focus:outline-none"
                              />
                            ) : (
                              <span className="px-2 font-mono text-sm">Rp {(new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })).format((t.targetHo||0)/1e9)}</span>
                            )}
                          </td>
                          {/* TARGET FULL HO */}
                          <td className="px-2 py-1.5 text-right">
                            {isEditing ? (
                              <input
                                type="text" placeholder="0"
                                ref={el => { if (el && focusField === "targetFullHo") { el.focus(); el.select(); } }}
                                value={editRowData.targetFullHo}
                                onChange={e => setEditRowData(p => ({ ...p, targetFullHo: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                                className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm font-mono text-right focus:outline-none"
                              />
                            ) : (
                              <span className="px-2 font-mono text-sm font-semibold">Rp {(new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })).format((t.targetFullHo||0)/1e9)}</span>
                            )}
                          </td>
                          {/* AKSI */}
                          <td className="px-2 py-1.5 text-right">
                            {isEditing ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" onClick={handleSaveTargetRow} disabled={tSaving}
                                  className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white text-xs">
                                  {tSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditRowId(null); setFocusField(null); }}
                                  className="h-7 px-2 text-muted-foreground hover:text-foreground text-xs">
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : isDeleting ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="destructive" onClick={() => handleDeleteTarget(t.id)} className="h-7 px-2 text-xs">Hapus</Button>
                                <Button size="sm" variant="ghost" onClick={() => setTDelConfirm(null)} className="h-7 px-2 text-xs">Batal</Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setTDelConfirm(t.id)}
                                className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* New row being added */}
                    {editRowId === "new" && (
                      <tr className="bg-yellow-50">
                        <td className="px-2 py-1.5">
                          <input type="number" min="2020" max="2099"
                            value={editRowData.tahun} autoFocus
                            onChange={e => setEditRowData(p => ({ ...p, tahun: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                            className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm font-mono focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={editRowData.divisi}
                            onChange={e => setEditRowData(p => ({ ...p, divisi: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                            className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm focus:outline-none">
                            <option value="DPS">DPS</option>
                            <option value="DSS">DSS</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="text" placeholder="0"
                            value={editRowData.targetHo}
                            onChange={e => setEditRowData(p => ({ ...p, targetHo: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                            className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm font-mono text-right focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="text" placeholder="0"
                            value={editRowData.targetFullHo}
                            onChange={e => setEditRowData(p => ({ ...p, targetFullHo: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") handleSaveTargetRow(); if (e.key === "Escape") { setEditRowId(null); setFocusField(null); } }}
                            className="w-full h-8 px-2 bg-white border-2 border-primary rounded text-sm font-mono text-right focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" onClick={handleSaveTargetRow} disabled={tSaving}
                              className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white text-xs">
                              {tSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setEditRowId(null); setFocusField(null); }}
                              className="h-7 px-2 text-muted-foreground hover:text-foreground text-xs">
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Add row button row */}
                    {editRowId === null && (
                      <tr>
                        <td colSpan={5} className="px-3 py-1.5">
                          <button
                            onClick={() => {
                              setEditRowId("new");
                              setEditRowData({ tahun: String(curYear), divisi: "DPS", targetHo: "", targetFullHo: "" });
                              setFocusField(null);
                            }}
                            className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary font-semibold py-1 px-1 rounded transition-colors"
                          >
                            <span className="text-base leading-none">+</span> Tambah Baris
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {targets.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Klik dua kali pada baris untuk mengedit · Enter untuk simpan · Esc untuk batal</p>
            )}
          </div>
        )}

        {/* ── Target AM Section ─────────────────────────────────────────────── */}
        {activeTab === "target-am" && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div>
                <h3 className="font-bold text-base">Target Nilai Proyek per AM</h3>
                <p className="text-xs text-muted-foreground">Target tahunan setiap Account Manager — disinkronkan otomatis ke kolom Target di tabel Sales Funnel.</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-semibold">Tahun</span>
                <input
                  type="number"
                  min="2020"
                  max="2099"
                  value={amTahun}
                  onChange={e => setAmTahun(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-red-500 w-20 font-mono text-center"
                />
              </div>
            </div>
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-red-700 text-white">
                      <th className="px-4 py-2.5 text-xs font-black uppercase">Account Manager</th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase w-20">Divisi</th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase text-right min-w-[160px]">Target {amTahun} (Rp)</th>
                      <th className="px-4 py-2.5 text-xs font-black uppercase text-right w-20">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {masterAmsActive.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">Belum ada data Account Manager aktif</td></tr>
                    )}
                    {masterAmsActive.map((am: any) => {
                      const existing = amTargetMap[am.nik];
                      const isEditing = amTargetEditId === am.nik;
                      return (
                        <tr key={am.nik} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5 font-semibold text-sm">{am.nama}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold", am.divisi==="DPS"?"bg-blue-100 text-blue-700":am.divisi==="DSS"?"bg-emerald-100 text-emerald-700":"bg-slate-100 text-slate-600")}>{am.divisi}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {isEditing ? (
                              <input
                                autoFocus
                                type="number"
                                value={amTargetEditVal}
                                onChange={e => setAmTargetEditVal(e.target.value)}
                                onKeyDown={async e => {
                                  if (e.key === "Escape") { setAmTargetEditId(null); setAmTargetEditVal(""); return; }
                                  if (e.key === "Enter") {
                                    setAmTargetSaving(true);
                                    try {
                                      await apiFetch("/api/funnel/am-targets", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ nikAm: am.nik, tahun: Number(amTahun), targetValue: Number(amTargetEditVal)||0 }) });
                                      await refetchAmTargets();
                                      toast({ title: "Target disimpan", description: `${am.nama} — Target ${amTahun}` });
                                    } finally { setAmTargetSaving(false); setAmTargetEditId(null); setAmTargetEditVal(""); }
                                  }
                                }}
                                onBlur={async () => {
                                  setAmTargetSaving(true);
                                  try {
                                    await apiFetch("/api/funnel/am-targets", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ nikAm: am.nik, tahun: Number(amTahun), targetValue: Number(amTargetEditVal)||0 }) });
                                    await refetchAmTargets();
                                  } finally { setAmTargetSaving(false); setAmTargetEditId(null); setAmTargetEditVal(""); }
                                }}
                                className="w-full border border-primary rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-background tabular-nums"
                                placeholder="0"
                              />
                            ) : (
                              <button
                                onClick={() => { setAmTargetEditId(am.nik); setAmTargetEditVal(existing ? String(existing.targetValue) : ""); }}
                                className="group/cell w-full flex items-center justify-end gap-2 hover:text-red-600 transition-colors">
                                <span className="font-mono tabular-nums text-sm">
                                  {existing ? `Rp ${typeof existing?.targetValue==="number"&&!isNaN(existing?.targetValue)?(new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })).format(existing.targetValue):"0"}` : <span className="text-muted-foreground italic text-xs">Belum diset</span>}
                                </span>
                                <Pencil className="w-3 h-3 text-muted-foreground group-hover/cell:text-red-600 shrink-0" />
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {existing && (
                              amTargetDelConfirm === existing.id ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={async () => {
                                    setAmTargetSaving(true);
                                    try {
                                      await apiFetch(`/api/funnel/am-targets/${existing.id}`, { method: "DELETE" });
                                      await refetchAmTargets();
                                      toast({ title: "Target dihapus" });
                                    } finally { setAmTargetSaving(false); setAmTargetDelConfirm(null); }
                                  }} className="text-[10px] px-1.5 py-0.5 bg-red-600 text-white rounded font-bold hover:bg-red-700">Ya</button>
                                  <button onClick={() => setAmTargetDelConfirm(null)} className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded font-bold hover:bg-secondary">Batal</button>
                                </div>
                              ) : (
                                <button onClick={() => setAmTargetDelConfirm(existing.id)} className="text-red-600 hover:text-red-800 transition-colors">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {masterAmsActive.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Klik nilai target untuk mengedit · Enter untuk simpan · Esc untuk batal</p>
            )}
          </div>
        )}

        {/* File-based tabs content */}
        {activeTab !== "target-ho" && activeTab !== "target-am" && (() => {
          const typeMap: Record<string, string> = { performansi: "performance", funnel: "funnel", activity: "activity" };
          const driveType = typeMap[activeTab];
          const driveHasFolder = driveType === "performance" ? !!appSettings?.gDriveFolderPerformance
            : driveType === "funnel" ? !!appSettings?.gDriveFolderFunnel
            : !!appSettings?.gDriveFolderActivity;
          const curMode = uploadMode[activeTab] || "manual";
          const driveFilesList = driveFiles[driveType] || [];
          const isListing = !!driveListLoading[driveType];
          const isSyncing = !!driveSyncing[driveType];
          const syncResult = driveSyncResult[driveType];
          const curDriveSnap = driveSnapshotOverride[driveType] || "";
          const driveDetected = driveFilesList.length > 0 ? extractDateFromFilename(driveFilesList[0].name) : null;
          const curDriveProgress = driveProgress[driveType] || null;

          return (
          <div className="p-6 space-y-4">
            {/* Upload mode toggle */}
            <div className="flex items-center gap-1 p-1 bg-red-50 border border-red-200 rounded-lg w-fit">
              {([
                { key: "manual", label: "Upload Manual", icon: UploadCloud },
                { key: "drive",  label: "Google Drive",  icon: FolderOpen },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setUploadMode(p => ({ ...p, [activeTab]: key }));
                    if (key === "drive" && driveHasFolder && driveFilesList.length === 0) {
                      handleDriveList(driveType);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                    curMode === key
                      ? "bg-red-700 text-white shadow-sm"
                      : "text-red-700/70 hover:text-red-700 hover:bg-red-100"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {key === "drive" && !driveHasFolder && (
                    <span className={cn("ml-1 text-[9px] font-normal normal-case", curMode === key ? "text-red-200" : "text-red-400/60")}>(belum diatur)</span>
                  )}
                </button>
              ))}
            </div>

            {/* ── MANUAL MODE ────────────────────────────────────────────────── */}
            {curMode === "manual" && (
              <>
                {/* File upload with drag & drop */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    File Excel (.xlsx / .xls)
                  </label>
                  {currentFile ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-emerald-800 truncate">{currentFile.name}</p>
                        <p className="text-xs text-emerald-600">
                          {(currentFile.size / 1024).toFixed(0)} KB
                          {currentSheetName && <> · Sheet: <span className="font-medium">{currentSheetName}</span></>}
                        </p>
                      </div>
                      <button onClick={clearFile} className="text-emerald-400 hover:text-emerald-700 transition-colors p-0.5">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={cn(
                        "w-full px-4 py-8 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all select-none",
                        isDragOver
                          ? "border-primary bg-primary/5 scale-[1.01]"
                          : "border-border hover:border-primary/40 hover:bg-primary/[0.02]"
                      )}
                    >
                      <UploadCloud className={cn("w-8 h-8 mx-auto mb-2 transition-colors", isDragOver ? "text-primary" : "text-muted-foreground/40")} />
                      <p className={cn("text-sm font-semibold transition-colors", isDragOver ? "text-primary" : "text-muted-foreground")}>
                        {isDragOver ? "Lepaskan file di sini" : "Klik atau seret file Excel ke sini"}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Format: .xlsx atau .xls</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileInputChange} />
                </div>

                {/* Auto-detected / warning banners */}
                {fileDetected && (
                  <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-700 text-xs font-medium">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>Snapshot terdeteksi dari nama file: <strong>{fileDetected.display}</strong> (Periode: {fileDetected.period})</span>
                  </div>
                )}
                {!fileDetected && currentFile && (
                  <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border bg-amber-50 border-amber-200 text-amber-700 text-xs font-medium">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Tanggal tidak terdeteksi dari nama file — isi tanggal snapshot secara manual di bawah</span>
                  </div>
                )}

                {/* Same-day duplicate warning */}
                {sameDayImport && (
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border bg-amber-50 border-amber-300 text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <div className="text-xs">
                      <p className="font-bold mb-0.5">Snapshot Duplikat Terdeteksi</p>
                      <p className="text-amber-700 leading-relaxed">
                        Data dengan periode dan tanggal snapshot yang sama sudah ada (ID #{sameDayImport.id}, {sameDayImport.rowsImported} baris).
                        Mengklik "Import Sekarang" akan <strong>menimpa data lama</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {/* Snapshot date + Import button */}
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Tanggal Snapshot
                      <span className="text-[10px] font-normal normal-case text-muted-foreground/60">(opsional)</span>
                    </label>
                    <input
                      type="date"
                      value={currentSnapshotOverride}
                      onChange={e => setSnapshotOverride(prev => ({ ...prev, [activeTab]: e.target.value }))}
                      className="h-9 px-3 bg-secondary/40 border border-border rounded-lg text-sm font-sans focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
                    />
                  </div>
                  {currentSnapshotOverride && !isPending && (
                    <Button size="sm" variant="outline" onClick={() => setSnapshotOverride(prev => ({ ...prev, [activeTab]: "" }))}>
                      Reset
                    </Button>
                  )}
                  {/* Progress bar (inline, appears when importing) */}
                  {importProgress && (
                    <div className="flex-1 min-w-[160px] flex flex-col justify-end gap-1.5 pb-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground truncate">{importProgress.stage}</span>
                        <span className={cn(
                          "text-[11px] font-bold tabular-nums shrink-0",
                          importProgress.percent === 100 ? "text-emerald-600" : "text-primary"
                        )}>{importProgress.percent}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-200 ease-out",
                            importProgress.percent === 100 ? "bg-emerald-500" : "bg-primary"
                          )}
                          style={{ width: `${importProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <Button onClick={handleSync} disabled={isPending || !currentFile} className="h-9 px-5 gap-2">
                    {isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengimport...</>
                      : <><UploadCloud className="w-4 h-4" /> Import Sekarang <ArrowRight className="w-3.5 h-3.5" /></>
                    }
                  </Button>
                </div>

                {/* Period info */}
                {finalPeriod && !isPending && (
                  <p className="text-xs text-muted-foreground">
                    periode: <span className="font-semibold text-foreground">{finalPeriod}</span>
                    {finalSnapshotDate && <> &middot; snapshot: <span className="font-semibold text-foreground">{finalSnapshotDate}</span></>}
                  </p>
                )}

                {/* Cleaning info */}
                {activeTab !== "activity" && (
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-secondary/60 border border-border text-xs text-muted-foreground">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary/60" />
                    <div>
                      <span className="font-semibold text-foreground">Pipeline cleaning aktif:</span>
                      {activeTab === "performansi" && " Filter WITEL_CC=SURAMADU, ekstrak dari pivot cache (cache #2) atau sheet RAW_AM."}
                      {activeTab === "funnel" && " Filter witel=SURAMADU, divisi=DPS/DSS, validasi NIK, fix AM Reni→Havea (mulai 2026), UPPER+TRIM pelanggan."}
                    </div>
                  </div>
                )}

                {/* Activity: full Power BI cleaning checklist */}
                {activeTab === "activity" && (
                  <ActivityCleaningChecklist progress={importProgress} />
                )}
              </>
            )}

            {/* ── DRIVE MODE ─────────────────────────────────────────────────── */}
            {curMode === "drive" && (
              <>
                {!driveHasFolder ? (
                  <div className="flex items-start gap-3 px-4 py-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                    <div className="text-xs">
                      <p className="font-bold mb-1">Folder Google Drive Belum Dikonfigurasi</p>
                      <p className="text-amber-700">Buka tab <strong>Google Sheets</strong> → pilih mode <em>Auto-sync Drive</em> → isi URL folder untuk tab ini.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Snapshot date override for Drive mode */}
                    <div className="space-y-2">
                      <div className="flex items-end gap-2 flex-wrap">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" /> Tanggal Snapshot
                            <span className="text-[10px] font-normal normal-case text-muted-foreground/60">(auto-detect dari nama file)</span>
                          </label>
                          <input
                            type="date"
                            value={curDriveSnap}
                            onChange={e => setDriveSnapshotOverride(p => ({ ...p, [driveType]: e.target.value }))}
                            className="h-9 px-3 bg-secondary/40 border border-border rounded-lg text-sm font-sans focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
                          />
                        </div>
                        {curDriveSnap && (
                          <Button size="sm" variant="outline" onClick={() => setDriveSnapshotOverride(p => ({ ...p, [driveType]: driveDetected?.isoDate || "" }))}>
                            Reset
                          </Button>
                        )}
                      </div>
                      {curDriveSnap && (
                        <p className="text-xs text-muted-foreground">
                          snapshot: <span className="font-semibold text-foreground">{curDriveSnap}</span>
                          &middot; periode: <span className="font-semibold text-foreground">{curDriveSnap.slice(0, 7)}</span>
                        </p>
                      )}
                    </div>

                    {/* Drive action buttons */}
                    <div className="space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => {
                          handleDriveList(driveType);
                          setDriveSelectedFiles(p => ({ ...p, [driveType]: {} }));
                          setSyncLog([]);
                        }} disabled={isListing || isSyncing} className="gap-2 h-8 text-xs">
                          {isListing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5 text-amber-500" />}
                          {driveFilesList.length > 0 ? "Refresh Daftar File" : "Cek File di Drive"}
                        </Button>
                      </div>
                      {/* Progress bar for Drive sync */}
                      {curDriveProgress && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-muted-foreground truncate">{curDriveProgress.stage}</span>
                            <span className={cn(
                              "text-[11px] font-bold tabular-nums shrink-0",
                              curDriveProgress.percent === 100 ? "text-emerald-600" : "text-amber-600"
                            )}>{curDriveProgress.percent}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-border overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-200 ease-out",
                                curDriveProgress.percent === 100 ? "bg-emerald-500" : "bg-amber-500"
                              )}
                              style={{ width: `${curDriveProgress.percent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* File list with multi-select */}
                    {driveFilesList.length > 0 && (() => {
                      const selMap = driveSelectedFiles[driveType] || {};
                      const selectedIds = driveFilesList.filter((f: any) => selMap[f.id]).map((f: any) => f.id);
                      const allSelected = driveFilesList.length > 0 && driveFilesList.every((f: any) => selMap[f.id]);
                      const someSelected = selectedIds.length > 0;
                      const toggleAll = () => {
                        const next: Record<string, boolean> = {};
                        if (!allSelected) driveFilesList.forEach((f: any) => { next[f.id] = true; });
                        setDriveSelectedFiles(p => ({ ...p, [driveType]: next }));
                      };
                      const toggleFile = (fid: string) => {
                        setDriveSelectedFiles(p => ({
                          ...p,
                          [driveType]: { ...(p[driveType] || {}), [fid]: !(p[driveType] || {})[fid] },
                        }));
                        // Sync snapshot date picker to the clicked file's detected date
                        const clickedFile = driveFilesList.find((f: any) => f.id === fid);
                        if (clickedFile) {
                          const detected = extractDateFromFilename(clickedFile.name);
                          if (detected) {
                            setDriveSnapshotOverride(p => ({ ...p, [driveType]: detected.isoDate }));
                          }
                        }
                      };
                      return (
                        <div className="border border-border rounded-xl overflow-hidden">
                          {/* Header with select-all + action */}
                          <div className="px-3 py-2 bg-secondary/40 border-b border-border flex items-center gap-2">
                            <button onClick={toggleAll} disabled={isSyncing} className="flex items-center gap-1.5 text-[11px] font-bold text-foreground hover:text-primary transition-colors">
                              {allSelected
                                ? <CheckSquare2 className="w-3.5 h-3.5 text-primary" />
                                : someSelected
                                  ? <CheckSquare2 className="w-3.5 h-3.5 text-muted-foreground" />
                                  : <Square className="w-3.5 h-3.5 text-muted-foreground" />
                              }
                              {driveFilesList.length} file ditemukan
                            </button>
                            <div className="ml-auto flex items-center gap-2">
                              {someSelected && (
                                <Button size="sm"
                                  onClick={() => handleDriveSyncBatch(driveType, driveFilesList.filter((f: any) => selMap[f.id]))}
                                  disabled={isSyncing}
                                  className="h-6 px-2.5 text-[10px] gap-1.5 bg-red-700 hover:bg-red-800 text-white"
                                >
                                  {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListChecks className="w-3 h-3" />}
                                  Sync {selectedIds.length} file
                                </Button>
                              )}
                              <Button size="sm"
                                onClick={() => handleDriveSyncBatch(driveType, driveFilesList.slice(0, 1))}
                                disabled={isSyncing}
                                className="h-6 px-2.5 text-[10px] gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                              >
                                {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                Terbaru saja
                              </Button>
                            </div>
                          </div>
                          <div className="divide-y divide-border/50 max-h-60 overflow-y-auto">
                            {driveFilesList.map((f: any, i: number) => {
                              const fDetected = extractDateFromFilename(f.name);
                              const isGSheet = f.mimeType === "application/vnd.google-apps.spreadsheet";
                              const isChecked = !!(selMap[f.id]);
                              return (
                                <div
                                  key={f.id}
                                  onClick={() => !isSyncing && toggleFile(f.id)}
                                  className={cn(
                                    "px-3 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors select-none",
                                    isChecked ? "bg-primary/5 border-l-2 border-l-primary" : i === 0 ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-secondary/30"
                                  )}
                                >
                                  {isChecked
                                    ? <CheckSquare2 className="w-3.5 h-3.5 shrink-0 text-primary" />
                                    : <Square className="w-3.5 h-3.5 shrink-0 text-border" />
                                  }
                                  <FileSpreadsheet className={cn("w-3.5 h-3.5 shrink-0", i === 0 ? "text-amber-600" : isGSheet ? "text-green-600" : "text-muted-foreground/60")} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-xs font-semibold text-foreground truncate">{f.name}</p>
                                      {isGSheet && (
                                        <span className="shrink-0 text-[9px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200">Sheets</span>
                                      )}
                                      {i === 0 && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full border border-amber-200 shrink-0">Terbaru</span>}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      {f.modifiedTime ? format(new Date(f.modifiedTime), "d MMM yyyy, HH:mm", { locale: id }) : ""}
                                      {fDetected && <> · <span className="font-medium text-emerald-600">Snapshot: {fDetected.display}</span></>}
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost" size="sm"
                                    onClick={e => {
                                      e.stopPropagation();
                                      handleDriveSyncBatch(driveType, [f]);
                                    }}
                                    disabled={isSyncing}
                                    className="h-6 px-2 text-[10px] shrink-0 hover:bg-amber-100 hover:text-amber-800"
                                  >
                                    <Download className="w-3 h-3 mr-0.5" /> Sync ini
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Sync log panel — collapsible, per driveType */}
                    {(syncLog[driveType] || []).length > 0 && (
                      <div className="border border-border rounded-xl overflow-hidden">
                        <button
                          onClick={() => setSyncLogOpen(p => ({ ...p, [driveType]: !p[driveType] }))}
                          className="w-full px-3 py-2 flex items-center gap-2 bg-secondary/40 hover:bg-secondary/60 transition-colors border-b border-border text-left"
                        >
                          <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-[11px] font-bold text-foreground flex-1">Log Proses Sync</span>
                          <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                            (syncLog[driveType] || []).every(e => e.status === "ok") ? "bg-emerald-100 text-emerald-700"
                            : (syncLog[driveType] || []).some(e => e.status === "error") ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                          )}>
                            {(syncLog[driveType] || []).filter(e => e.status === "ok").length}/{(syncLog[driveType] || []).length} OK
                          </span>
                          {syncLogOpen[driveType] ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                        </button>
                        {syncLogOpen[driveType] && (
                          <div className="max-h-52 overflow-y-auto divide-y divide-border/40 bg-[#1e1e2e]/[0.03]">
                            {(syncLog[driveType] || []).map((entry, i) => (
                              <div key={entry.fileId} className="flex items-start gap-2.5 px-3 py-2.5">
                                <div className="shrink-0 mt-0.5">
                                  {entry.status === "waiting" && <Clock className="w-3.5 h-3.5 text-muted-foreground/40" />}
                                  {entry.status === "running" && <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />}
                                  {entry.status === "ok" && <CircleCheck className="w-3.5 h-3.5 text-emerald-500" />}
                                  {entry.status === "error" && <CircleX className="w-3.5 h-3.5 text-red-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-semibold text-foreground truncate">{entry.fileName}</p>
                                  <p className={cn(
                                    "text-[10px] mt-0.5",
                                    entry.status === "ok" ? "text-emerald-600" : entry.status === "error" ? "text-red-600" : "text-muted-foreground"
                                  )}>{entry.message}</p>
                                </div>
                                {entry.rows !== undefined && (
                                  <span className="shrink-0 text-[10px] font-bold tabular-nums text-emerald-600">{entry.rows.toLocaleString("id-ID")} baris</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          );
        })()}
      </div>

      {/* History Table — only for file-import tabs */}
      {activeTab !== "target-ho" && activeTab !== "target-am" && (
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <History className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-display font-bold text-sm text-foreground">Riwayat Import — {activeTabData.label}</h2>
          <span className="ml-auto text-xs text-muted-foreground">{filteredHistory.length} snapshot tersedia</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-secondary/30 border-b border-border">
                <th className="px-6 py-3 text-xs font-bold text-foreground uppercase tracking-wide">Versi Snapshot</th>
                <th className="px-5 py-3 text-xs font-bold text-foreground uppercase tracking-wide">Periode</th>
                <th className="px-5 py-3 text-xs font-bold text-foreground uppercase tracking-wide text-right">Baris</th>
                <th className="px-5 py-3 text-xs font-bold text-foreground uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-bold text-foreground uppercase tracking-wide text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredHistory.map((h, i) => (
                <tr key={i} className={cn("transition-colors", deleteConfirmId === h.id ? "bg-red-50" : "hover:bg-secondary/20")}>
                  <td className="px-6 py-3.5">
                    <p className="text-xs font-semibold text-foreground leading-snug">{formatSnapshotTitle(h.createdAt, h.type, h.snapshotDate)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(h.createdAt), 'HH:mm:ss', { locale: id })} WIB · ID #{h.id}</p>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-sm text-foreground">{displayPeriod(h.period)}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-foreground tabular-nums">{h.rowsImported.toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-semibold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      <CheckCircle2 className="w-3 h-3" /> Sukses
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {deleteConfirmId === h.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-xs text-red-600 font-semibold">Hapus semua data?</span>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteImport(h.id)} disabled={isDeleting}>
                          {isDeleting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                          Ya, Hapus
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDeleteConfirmId(null)} disabled={isDeleting}>Batal</Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end">
                        <RowActions actions={[
                          { type: "view", onClick: () => navigate(`/import/detail/${h.type}/${h.id}`), label: "Lihat Data" },
                          {
                            type: "presentation" as const,
                            href: `/presentation?type=${h.type}&snapshot=${h.id}`,
                            label: "Visualisasi",
                          },
                          { type: "delete", onClick: () => setDeleteConfirmId(h.id) },
                        ]} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-14 text-center text-muted-foreground text-sm">
                    <History className="w-8 h-8 mx-auto mb-3 opacity-30" />
                    Belum ada riwayat import untuk {activeTabData.label}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Data Cleaning Proof — hidden, data still fetched for internal use */}
      {false && activeTab === "funnel" && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <button
            className="w-full px-6 py-4 border-b border-border flex items-center gap-3 hover:bg-secondary/20 transition-colors text-left"
            onClick={() => setDqExpanded(p => !p)}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h2 className="font-display font-bold text-sm text-foreground flex-1">Laporan Pembersihan Data (Data Quality Proof)</h2>
            {dqExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {dqExpanded && (
            <div className="p-6 space-y-5">
              {/* Stats row */}
              {dqData && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Total LOP Valid", value: dqData.totalLop?.toLocaleString("id-ID"), color: "text-foreground" },
                    { label: "LOP DPS", value: dqData.dpLop?.toLocaleString("id-ID"), color: "text-blue-700" },
                    { label: "LOP DSS", value: dqData.dssLop?.toLocaleString("id-ID"), color: "text-violet-700" },
                    { label: "AM Aktif", value: dqData.activeAm, color: "text-emerald-700" },
                    { label: "Unik AM (NIK)", value: dqData.uniqueAmNik, color: "text-foreground" },
                    { label: "LOP Havea (ex-Reni)", value: dqData.haveaLop?.toLocaleString("id-ID"), color: "text-amber-700" },
                    { label: "AM Nama Kosong", value: dqData.nullAmRows, color: dqData?.nullAmRows > 0 ? "text-red-700" : "text-emerald-700" },
                    { label: "Nama Numerik (NIK)", value: dqData.numericAmName, color: dqData?.numericAmName > 0 ? "text-red-700" : "text-emerald-700" },
                  ].map(s => (
                    <div key={s.label} className="bg-secondary/30 border border-border rounded-xl p-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">{s.label}</div>
                      <div className={cn("text-2xl font-black font-mono", s.color)}>{s.value ?? "—"}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Cleaning steps table */}
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-emerald-700 text-white">
                  <h4 className="text-xs font-black uppercase tracking-wide">Langkah Pembersihan yang Diterapkan</h4>
                </div>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-secondary/40 text-xs font-bold text-foreground uppercase tracking-wide">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Langkah</th>
                      <th className="px-4 py-2">Rule / Aturan</th>
                      <th className="px-4 py-2 text-right">Data Terdampak</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {(dqData?.cleaningSteps || []).map((s: any, i: number) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-secondary/20"}>
                        <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5 font-bold text-foreground text-sm">{s.step}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-foreground">{s.rule}</td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold font-mono">
                          {s.affected !== undefined ? s.affected.toLocaleString("id-ID") + " baris" : <span className="text-muted-foreground">semua data</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {s.status === "applied" && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> Diterapkan
                            </span>
                          )}
                          {s.status === "applied_on_new_import" && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                              <CheckCircle2 className="w-3 h-3" /> Import Baru
                            </span>
                          )}
                          {s.status === "applied_at_query" && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                              <CheckCircle2 className="w-3 h-3" /> Saat Query
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 mr-1">Diterapkan</span> = berlaku untuk semua data (termasuk data lama).{" "}
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 mr-1">Import Baru</span> = berlaku saat import file berikutnya.{" "}
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 mr-1">Saat Query</span> = filter diterapkan tiap kali dashboard memuat data.{" "}
                AM Aktif = {dqData?.activeAm ?? 13} dari account_managers (aktif = true).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
