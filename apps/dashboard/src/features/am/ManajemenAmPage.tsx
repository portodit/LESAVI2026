import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Trash2, Users, Wifi, WifiOff, Search, X,
  MessageSquare, AlertTriangle, RefreshCw, UserCog, Shield,
  ToggleLeft, ToggleRight
} from "lucide-react";
import { useAuth } from "@/shared/hooks/use-auth";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { RowActions } from "@/shared/ui/row-actions";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: number;
  nik: string | null;
  nama: string;
  email: string | null;
  role: string;
  tipe: string | null;
  divisi: string;
  segmen: string | null;
  witel: string;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramDisplayName: string | null;
  telegramConnected: boolean;
  kpiActivity: number;
  crossWitel: boolean;
  createdAt: string;
  registeredAkun: boolean;
  aktif: boolean;
  discoveredFrom: string | null;
}

interface UserFormData {
  nik: string;
  nama: string;
  email: string;
  role: string;
  tipe: string;
  divisi: string;
  segmen: string;
  witel: string;
  telegramChatId: string;
  telegramUsername: string;
  telegramDisplayName: string;
}

const EMPTY_FORM: UserFormData = {
  nik: "", nama: "", email: "", role: "AM", tipe: "LESA",
  divisi: "DPS", segmen: "", witel: "SURAMADU", telegramChatId: "", telegramUsername: "", telegramDisplayName: "",
};

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include", ...opts });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${r.status}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

// ─── Reusable: FormField ─────────────────────────────────────────────────────

function FormField({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Reusable: SelectField ───────────────────────────────────────────────────

function SelectField({ value, onChange, options, disabled, className }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean; className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
        "focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── Reusable: ConfirmDeleteDialog ────────────────────────────────────────────

function ConfirmDeleteDialog({ open, onClose, onConfirm, name, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  name: string; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <DialogTitle className="text-base">Hapus Anggota</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            Apakah kamu yakin ingin menghapus <span className="font-semibold text-foreground">{name}</span>?
            Data ini tidak dapat dikembalikan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Batal</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Hapus
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Role & Tipe configs ──────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ADMIN:         { label: "Admin",         color: "text-red-700",     bg: "bg-red-100",       border: "border-red-200" },
  OFFICER:       { label: "Officer",       color: "text-purple-700", bg: "bg-purple-100",    border: "border-purple-200" },
  MANAGER:       { label: "Manager",       color: "text-orange-700", bg: "bg-orange-100",   border: "border-orange-200" },
  ACCOUNT_MANAGER: { label: "AM",           color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-200" },
  AM:              { label: "AM",           color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-200" },
};

const TIPE_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  LESA: { color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
};

const DIVISI_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  DPS: { color: "text-blue-700",   bg: "bg-blue-100",   border: "border-blue-200" },
  DSS: { color: "text-violet-700", bg: "bg-violet-100", border: "border-violet-200" },
  DGS: { color: "text-cyan-700",   bg: "bg-cyan-100",   border: "border-cyan-200" },
};

// ─── User Form Dialog ─────────────────────────────────────────────────────────

function UserFormDialog({ open, onClose, onSubmit, initial, loading, mode }: {
  open: boolean; onClose: () => void;
  onSubmit: (data: UserFormData) => void;
  initial?: UserFormData; loading?: boolean; mode: "add" | "edit";
}) {
  const [form, setForm] = useState<UserFormData>(initial ?? EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<UserFormData>>({});

  useEffect(() => {
    if (open) { setForm(initial ?? EMPTY_FORM); setErrors({}); }
  }, [open, initial]);

  function set(field: keyof UserFormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }
  function setSelect(field: keyof UserFormData) {
    return (v: string) => setForm(f => ({ ...f, [field]: v }));
  }

  const isOfficer = form.role === "OFFICER";
  const isAccountManager = form.role === "ACCOUNT_MANAGER" || form.role === "AM";

  function validate(): boolean {
    const errs: Partial<UserFormData> = {};
    if (!form.nama.trim()) errs.nama = "Nama wajib diisi";
    if (isAccountManager && !form.nik.trim()) errs.nik = "NIK wajib diisi";
    if (isAccountManager && form.nik.trim() && !/^\d+$/.test(form.nik.trim())) errs.nik = "NIK harus berupa angka";
    if (isAccountManager && !form.divisi) errs.divisi = "Divisi wajib dipilih";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) onSubmit(form);
  }

  const roleOptions = [
    { v: "ACCOUNT_MANAGER", label: "Account Manager" },
    { v: "MANAGER", label: "Manager" },
    { v: "OFFICER", label: "Officer" },
    { v: "ADMIN", label: "Admin" },
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="w-4 h-4 text-primary" />
            {mode === "add" ? "Tambah Anggota" : "Edit Anggota"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {mode === "add" ? "Isi data anggota baru." : "Ubah informasi anggota yang dipilih."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1 overflow-y-auto flex-1 min-h-0 pr-1">

          {/* Row 1: Role + Tipe */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Role">
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className={cn(
                  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors",
                  "focus:outline-none focus:ring-1 focus:ring-ring"
                )}
              >
                {roleOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </FormField>
            <FormField label="Tipe">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, tipe: "LESA" }))}
                className={cn(
                  "w-full h-10 rounded-md border text-sm font-semibold transition-colors",
                  form.tipe === "LESA"
                    ? "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-700"
                    : "bg-secondary text-muted-foreground border-border"
                )}
              >LESA</button>
            </FormField>
          </div>

          {/* Row 2: NIK + Divisi (AM) or NIK + Email (Officer/Admin) */}
          {isAccountManager ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="NIK" required error={errors.nik}>
                <Input
                  value={form.nik} onChange={set("nik")}
                  placeholder="mis. 850099"
                  disabled={mode === "edit"}
                  className={cn("h-10", errors.nik ? "border-destructive" : "")}
                />
              </FormField>
              <FormField label="Divisi" required error={errors.divisi}>
                <SelectField
                  value={form.divisi}
                  onChange={setSelect("divisi")}
                  options={[
                    { value: "DPS", label: "DPS" },
                    { value: "DSS", label: "DSS" },
                    { value: "DGS", label: "DGS" },
                  ]}
                  className="h-10"
                />
              </FormField>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="NIK">
                <Input
                  value={form.nik} onChange={set("nik")}
                  placeholder="mis. 850099 (opsional)"
                  disabled={mode === "edit"}
                  className="h-10"
                />
              </FormField>
              <FormField label="Email Login">
                <Input
                  type="email"
                  value={form.email} onChange={set("email")}
                  placeholder="mis. officer@example.com"
                  className="h-10"
                />
              </FormField>
            </div>
          )}

          {/* Row 3: Nama Lengkap — always full width */}
          <FormField label="Nama Lengkap" required error={errors.nama}>
            <Input
              value={form.nama} onChange={set("nama")}
              placeholder="mis. RENI WULANSARI"
              className={cn("h-10", errors.nama ? "border-destructive" : "")}
            />
          </FormField>

          {/* AM-only fields */}
          {isAccountManager && (
            <>
              {/* Segmen + Witel */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Segmen">
                  <SelectField
                    value={form.segmen}
                    onChange={setSelect("segmen")}
                    options={[
                      { value: "", label: "— Pilih Segmen —" },
                      { value: "Enterprise", label: "Enterprise" },
                      { value: "Government", label: "Government" },
                      { value: "SME", label: "SME" },
                    ]}
                    className="h-10"
                  />
                </FormField>
                <FormField label="Witel">
                  <SelectField
                    value={form.witel}
                    onChange={setSelect("witel")}
                    options={[
                      { value: "SURAMADU", label: "SURAMADU" },
                      { value: "SURABAYA", label: "SURABAYA" },
                      { value: "MADURA", label: "MADURA" },
                    ]}
                    className="h-10"
                  />
                </FormField>
              </div>

              {/* Telegram fields — compact */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data Telegram (opsional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Username Telegram">
                    <Input
                      value={form.telegramUsername} onChange={set("telegramUsername")}
                      placeholder="@username"
                      className="h-9"
                    />
                  </FormField>
                  <FormField label="Nama Tampilan">
                    <Input
                      value={form.telegramDisplayName} onChange={set("telegramDisplayName")}
                      placeholder="Nama tampil di bot"
                      className="h-9"
                    />
                  </FormField>
                </div>
                <FormField label="Chat ID Bot">
                  <Input
                    value={form.telegramChatId} onChange={set("telegramChatId")}
                    placeholder="ID numerik dari Telegram (opsional)"
                    className="h-9"
                  />
                </FormField>
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-2 shrink-0 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Batal</Button>
            <Button type="submit" disabled={loading}>
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {mode === "add" ? "Tambah Anggota" : "Simpan Perubahan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

function UserRow({ user, onEdit, onDelete, isPrivileged, onToggleAktif, togglingAktif }: {
  user: User; onEdit: () => void; onDelete: () => void;
  isPrivileged: boolean; onToggleAktif: () => void; togglingAktif: boolean;
}) {
  const role = (user.role === "AM" ? "ACCOUNT_MANAGER" : (user.role || "ACCOUNT_MANAGER"));
  const roleCfg = ROLE_CONFIG[role] ?? ROLE_CONFIG["ACCOUNT_MANAGER"];
  const tipeCfg = user.tipe ? (TIPE_CONFIG[user.tipe] ?? TIPE_CONFIG["LESA"]) : TIPE_CONFIG["LESA"];
  const divisiCfg = DIVISI_CONFIG[user.divisi] ?? DIVISI_CONFIG["DPS"];
  const isAccountManager = role === "ACCOUNT_MANAGER" || role === "AM";
  const isNonaktif = !user.aktif;

  return (
    <tr className={cn("border-b border-border/50 transition-colors", isNonaktif ? "bg-amber-50/40 hover:bg-amber-50/60 dark:bg-amber-950/10 dark:hover:bg-amber-950/20" : "hover:bg-secondary/20")}>
      {/* NIK */}
      <td className="px-4 py-3 whitespace-nowrap">
        {user.nik
          ? <span className={cn("font-mono text-base font-black tracking-tight", isNonaktif ? "text-muted-foreground" : "text-foreground")}>{user.nik}</span>
          : <span className="text-muted-foreground/40 text-sm">—</span>
        }
      </td>

      {/* Nama + Avatar */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-full border flex items-center justify-center shrink-0",
            isNonaktif ? "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-700 opacity-70" :
            role === "OFFICER" ? "bg-purple-50 border-purple-200 dark:bg-purple-950/30" :
            role === "MANAGER" ? "bg-orange-50 border-orange-200 dark:bg-orange-950/30" :
            "bg-primary/10 border-primary/20"
          )}>
            <span className={cn("text-[10px] font-black",
              isNonaktif ? "text-amber-600/70" :
              role === "OFFICER" ? "text-purple-600" :
              role === "MANAGER" ? "text-orange-600" : "text-primary"
            )}>
              {user.nama.split(" ").slice(0, 2).map(n => n[0]).join("")}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className={cn("font-semibold text-sm leading-tight truncate max-w-[200px]", isNonaktif ? "text-muted-foreground" : "text-foreground")}>{user.nama}</p>
              {isNonaktif && (
                <span className="inline-flex items-center text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-700 shrink-0">
                  BARU
                </span>
              )}
            </div>
            {user.email && (
              <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{user.email}</p>
            )}
            {user.crossWitel && isAccountManager && !isNonaktif && (
              <span className="text-[10px] text-amber-600 font-bold">Cross Witel</span>
            )}
          </div>
        </div>
      </td>

      {/* Role Badge */}
      <td className="px-4 py-3">
        <Badge className={cn("text-[11px] font-bold border", isNonaktif ? "bg-muted text-muted-foreground border-border opacity-70" : cn(roleCfg.bg, roleCfg.color, roleCfg.border))}>
          {roleCfg.label}
        </Badge>
      </td>

      {/* Tipe Badge */}
      <td className="px-4 py-3">
        {user.tipe ? (
          <Badge className={cn("text-[11px] font-bold border", isNonaktif ? "bg-muted text-muted-foreground border-border opacity-70" : cn(tipeCfg.bg, tipeCfg.color, tipeCfg.border))}>
            {user.tipe}
          </Badge>
        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
      </td>

      {/* Divisi */}
      <td className="px-4 py-3">
        {isAccountManager ? (
          <Badge className={cn("text-[11px] font-bold border", isNonaktif ? "bg-muted text-muted-foreground border-border opacity-70" : cn(divisiCfg.bg, divisiCfg.color, divisiCfg.border))}>
            {user.divisi}
          </Badge>
        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
      </td>

      {/* Witel */}
      <td className="px-4 py-3 whitespace-nowrap">
        {user.witel ? (
          <span className={cn(
            "inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-md border",
            isNonaktif
              ? "bg-muted text-muted-foreground border-border opacity-70"
              : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-700"
          )}>
            {user.witel}
          </span>
        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
      </td>

      {/* Segmen */}
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
        {isAccountManager ? (user.segmen || <span className="text-border text-xs">—</span>) : <span className="text-muted-foreground/40 text-xs">—</span>}
      </td>

      {/* Telegram */}
      <td className="px-4 py-3">
        {isAccountManager ? (user.telegramConnected ? (
          <div className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-semibold text-emerald-600 block truncate max-w-[100px]">
                {user.telegramUsername ? `@${user.telegramUsername}` : user.telegramDisplayName || "Terhubung"}
              </span>
              {user.telegramDisplayName && user.telegramUsername && (
                <span className="text-[10px] text-muted-foreground/60 block truncate max-w-[100px]">{user.telegramDisplayName}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {user.telegramUsername ? (
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono text-muted-foreground/60">@{user.telegramUsername}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              <span className="text-[10px] text-muted-foreground/50">Belum</span>
            </div>
          </div>
        )) : <span className="text-xs text-muted-foreground/40">—</span>}
      </td>

      {/* Status Aktif */}
      <td className="px-4 py-3">
        {!isAccountManager ? (
          <span className="text-xs text-muted-foreground/40">—</span>
        ) : isPrivileged ? (
          <button
            onClick={onToggleAktif}
            disabled={togglingAktif}
            title={user.aktif ? "Nonaktifkan" : "Aktifkan"}
            className="flex items-center gap-1.5 group"
          >
            {togglingAktif ? (
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : user.aktif ? (
              <>
                <ToggleRight className="w-5 h-5 text-emerald-500 group-hover:text-emerald-600 transition-colors" />
                <span className="text-xs font-semibold text-emerald-600 group-hover:text-emerald-700">Aktif</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-5 h-5 text-amber-400 group-hover:text-amber-600 transition-colors" />
                <span className="text-xs font-semibold text-amber-600 group-hover:text-amber-700">Nonaktif</span>
              </>
            )}
          </button>
        ) : (
          user.aktif
            ? <span className="text-xs font-semibold text-emerald-600">Aktif</span>
            : <span className="text-xs font-semibold text-amber-600">Nonaktif</span>
        )}
      </td>

      {/* Aksi — always visible */}
      <td className="px-4 py-3">
        <RowActions actions={[
          { type: "edit", onClick: onEdit },
          { type: "delete", onClick: onDelete },
        ]} />
      </td>
    </tr>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: React.ReactNode;
  sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", color || "bg-primary/10")}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide leading-none mb-1">{label}</p>
        <p className="text-2xl font-black text-foreground leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterRole = "all" | "ACCOUNT_MANAGER" | "AM" | "MANAGER" | "OFFICER" | "ADMIN";
type FilterDivisi = "all" | "DPS" | "DSS" | "DGS";

export default function ManajemenAmPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const isPrivileged = currentUser && ["ADMIN", "OFFICER", "MANAGER"].includes(currentUser.role || "");

  const [search, setSearch] = useState("");
  const [filterDivisi, setFilterDivisi] = useState<FilterDivisi>("all");
  const [filterRole, setFilterRole] = useState<FilterRole>("all");
  const [filterWitel, setFilterWitel] = useState<string>("all");
  const [togglingAktifId, setTogglingAktifId] = useState<number | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: users = [], isLoading, error } = useQuery<User[]>({
    queryKey: ["am-list"],
    queryFn: () => apiFetch("/api/am"),
    staleTime: 30_000,
  });

  // Telegram stats — counts ALL non-DGS roles (not just AM)
  const { data: tgStats } = useQuery<{
    totalNonDgs: number; totalConnected: number;
    totalAktifNonDgs: number; totalAktifConnected: number;
  }>({
    queryKey: ["tg-stats"],
    queryFn: () => apiFetch("/api/telegram/stats"),
    staleTime: 15_000,
  });

  const aktifMutation = useMutation({
    mutationFn: ({ id, aktif }: { id: number; aktif: boolean }) =>
      apiFetch<User>(`/api/am/${id}/aktif`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aktif }),
      }),
    onMutate: ({ id }) => setTogglingAktifId(id),
    onSettled: () => setTogglingAktifId(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["am-list"] }),
  });

  const addMutation = useMutation({
    mutationFn: (data: UserFormData) => apiFetch<User>("/api/am", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nik: data.nik.trim() || null,
        nama: data.nama.trim().toUpperCase(),
        email: data.email.trim() || null,
        role: data.role,
        tipe: data.tipe,
        divisi: data.role === "ACCOUNT_MANAGER" ? data.divisi : "DPS",
        segmen: data.role === "ACCOUNT_MANAGER" ? (data.segmen || null) : null,
        witel: data.role === "ACCOUNT_MANAGER" ? data.witel : "SURAMADU",
        telegramChatId: data.role === "ACCOUNT_MANAGER" ? (data.telegramChatId || null) : null,
        telegramUsername: data.role === "ACCOUNT_MANAGER" ? (data.telegramUsername || null) : null,
        telegramDisplayName: data.role === "ACCOUNT_MANAGER" ? (data.telegramDisplayName || null) : null,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["am-list"] }); setShowAdd(false); setFormError(null); },
    onError: (e: Error) => setFormError(e.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserFormData }) =>
      apiFetch<User>(`/api/am/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nama: data.nama.trim().toUpperCase(),
          role: data.role,
          tipe: data.tipe,
          divisi: data.role === "ACCOUNT_MANAGER" ? data.divisi : undefined,
          segmen: data.role === "ACCOUNT_MANAGER" ? (data.segmen || null) : null,
          witel: data.role === "ACCOUNT_MANAGER" ? data.witel : undefined,
          telegramChatId: data.role === "ACCOUNT_MANAGER" ? (data.telegramChatId || null) : undefined,
          telegramUsername: data.role === "ACCOUNT_MANAGER" ? (data.telegramUsername || null) : undefined,
          telegramDisplayName: data.role === "ACCOUNT_MANAGER" ? (data.telegramDisplayName || null) : undefined,
          email: data.email.trim() || null,
        }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["am-list"] }); setEditTarget(null); setFormError(null); },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/am/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["am-list"] }); setDeleteTarget(null); },
  });

  const amOnly        = users.filter(u => u.role === "ACCOUNT_MANAGER" || u.role === "AM");
  const activeAmOnly  = amOnly.filter(u => u.aktif);
  const managers      = users.filter(u => u.role === "MANAGER");
  const officers      = users.filter(u => u.role === "OFFICER");
  const newAmCount    = amOnly.filter(u => !u.aktif).length;

  const availableWitels = [...new Set(users.map(u => u.witel).filter(Boolean))].sort();

  const filtered = users.filter(u => {
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (filterDivisi !== "all" && (u.role !== "ACCOUNT_MANAGER" || u.divisi !== filterDivisi)) return false;
    if (filterWitel !== "all" && u.witel !== filterWitel) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.nama.toLowerCase().includes(q)
        || (u.nik || "").includes(q)
        || (u.segmen || "").toLowerCase().includes(q)
        || (u.email || "").toLowerCase().includes(q)
        || (u.witel || "").toLowerCase().includes(q);
    }
    return true;
  });

  const dpsCount = activeAmOnly.filter(a => a.divisi === "DPS").length;
  const dssCount = activeAmOnly.filter(a => a.divisi === "DSS").length;
  const dgsCount = activeAmOnly.filter(a => a.divisi === "DGS").length;

  function toFormData(u: User): UserFormData {
    return {
      nik: u.nik || "", nama: u.nama, email: u.email || "",
      role: u.role || "AM", tipe: u.tipe || "LESA",
      divisi: u.divisi, segmen: u.segmen || "", witel: u.witel,
      telegramChatId: u.telegramChatId || "",
      telegramUsername: u.telegramUsername || "",
      telegramDisplayName: u.telegramDisplayName || "",
    };
  }

  const divisiButtons: { v: FilterDivisi; label: string }[] = [
    { v: "DPS", label: "DPS" },
    { v: "DSS", label: "DSS" },
    { v: "DGS", label: "DGS" },
    { v: "all", label: "Semua" },
  ];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Manajemen Akun</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Kelola akun Officer, Manager, dan Account Manager Witel Suramadu</p>
        </div>
        <Button onClick={() => { setFormError(null); setShowAdd(true); }} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Tambah Anggota
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Users className="w-5 h-5 text-primary" />}
          label="AM Aktif"
          value={<span>{activeAmOnly.length}{newAmCount > 0 && <span className="text-sm font-semibold text-amber-500 ml-1.5">+{newAmCount}</span>}</span>}
          sub={`${dpsCount} DPS · ${dssCount} DSS · ${dgsCount} DGS`}
          color="bg-primary/10"
        />
        <StatCard
          icon={<UserCog className="w-5 h-5 text-orange-600" />}
          label="Manager" value={managers.length}
          sub="Supervisi"
          color="bg-orange-50 dark:bg-orange-950/30"
        />
        <StatCard
          icon={<Shield className="w-5 h-5 text-purple-600" />}
          label="Officer" value={officers.length}
          sub="Akses penuh"
          color="bg-purple-50 dark:bg-purple-950/30"
        />
        <StatCard
          icon={<MessageSquare className="w-5 h-5 text-emerald-600" />}
          label="Telegram Aktif" value={tgStats?.totalConnected ?? 0}
          sub={`dari ${tgStats?.totalNonDgs ?? activeAmOnly.length} pengguna aktif`}
          color="bg-emerald-50 dark:bg-emerald-950/30"
        />
      </div>

      {/* ── Info: AM baru nonaktif (jika ada) ── */}
      {isPrivileged && newAmCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
          <ToggleLeft className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-bold">{newAmCount} AM baru</span> terdeteksi dari import data — ditandai <span className="font-bold">BARU</span> dan belum aktif. Aktifkan secara manual lewat tombol toggle di kolom Status.
          </p>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-card border border-border rounded-xl shadow-sm">

        {/* Filter Bar */}
        <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center gap-3 flex-wrap">

          {/* Role filter — dropdown */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-semibold text-muted-foreground">Role:</span>
            <select
              value={filterRole}
              onChange={e => setFilterRole(e.target.value as FilterRole)}
              className={cn(
                "h-8 pl-3 pr-7 text-xs font-semibold rounded-lg border border-border bg-background",
                "focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer",
                "appearance-none"
              )}
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
            >
              <option value="all">Semua Role</option>
              <option value="ACCOUNT_MANAGER">Account Manager</option>
              <option value="MANAGER">Manager</option>
              <option value="OFFICER">Officer</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          {/* Witel filter — dropdown */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-semibold text-muted-foreground">Witel:</span>
            <select
              value={filterWitel}
              onChange={e => setFilterWitel(e.target.value)}
              className={cn(
                "h-8 pl-3 pr-7 text-xs font-semibold rounded-lg border border-border bg-background",
                "focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer",
                "appearance-none",
                filterWitel !== "all" && "border-primary/50 ring-1 ring-primary/20 text-primary"
              )}
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
            >
              <option value="all">Semua Witel</option>
              {availableWitels.map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>

          {/* Divisi filter — button group (only when showing AM) */}
          {(filterRole === "all" || filterRole === "ACCOUNT_MANAGER") && (
            <div className="flex items-center gap-1">
              {divisiButtons.map(d => (
                <button
                  key={d.v}
                  onClick={() => setFilterDivisi(d.v)}
                  className={cn(
                    "h-8 px-3 rounded-lg text-xs font-bold transition-all duration-150 border",
                    filterDivisi === d.v
                      ? "bg-primary text-white border-primary shadow-sm"
                      : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Cari nama, NIK, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-7 py-1.5 text-sm bg-background border border-border rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {filtered.length} dari {users.length} anggota
          </span>
        </div>

        {/* Table */}
        <div className="p-3">
          <div className="border border-border overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-red-700 text-white text-xs font-black uppercase tracking-wide">
                <th className="px-4 py-3 whitespace-nowrap w-28">NIK</th>
                <th className="px-4 py-3 min-w-[200px]">Nama</th>
                <th className="px-4 py-3 w-24">Role</th>
                <th className="px-4 py-3 w-20">Tipe</th>
                <th className="px-4 py-3 w-20">Divisi</th>
                <th className="px-4 py-3 w-28">Witel</th>
                <th className="px-4 py-3 w-28">Segmen</th>
                <th className="px-4 py-3 w-32">Telegram</th>
                <th className="px-4 py-3 w-32">Status</th>
                <th className="px-4 py-3 w-32">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {[...Array(9)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-secondary rounded animate-pulse" style={{ width: `${[60, 160, 60, 40, 40, 80, 70, 80, 90][j]}px` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={10} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="w-6 h-6 text-destructive" />
                    <p className="text-sm">Gagal memuat data</p>
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Users className="w-8 h-8 opacity-30" />
                    <p className="text-sm font-medium">
                      {search || filterDivisi !== "all" || filterRole !== "all" || filterWitel !== "all"
                        ? "Tidak ada anggota yang cocok dengan filter"
                        : "Belum ada data anggota"}
                    </p>
                    {!search && filterDivisi === "all" && filterRole === "all" && filterWitel === "all" && (
                      <Button size="sm" onClick={() => setShowAdd(true)}>
                        <Plus className="w-3.5 h-3.5" /> Tambah Anggota Pertama
                      </Button>
                    )}
                  </div>
                </td></tr>
              ) : filtered.map(u => (
                <UserRow
                  key={u.id}
                  user={u}
                  onEdit={() => { setFormError(null); setEditTarget(u); }}
                  onDelete={() => setDeleteTarget(u)}
                  isPrivileged={!!isPrivileged}
                  onToggleAktif={() => aktifMutation.mutate({ id: u.id, aktif: !u.aktif })}
                  togglingAktif={togglingAktifId === u.id}
                />
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
      </div>

      {/* Add Dialog */}
      <UserFormDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); setFormError(null); }}
        onSubmit={data => addMutation.mutate(data)}
        loading={addMutation.isPending}
        mode="add"
      />
      {formError && showAdd && (
        <div className="text-sm text-destructive text-center mt-2">{formError}</div>
      )}

      {/* Edit Dialog */}
      <UserFormDialog
        open={!!editTarget}
        onClose={() => { setEditTarget(null); setFormError(null); }}
        onSubmit={data => editTarget && editMutation.mutate({ id: editTarget.id, data })}
        initial={editTarget ? toFormData(editTarget) : undefined}
        loading={editMutation.isPending}
        mode="edit"
      />
      {formError && !!editTarget && (
        <div className="text-sm text-destructive text-center mt-2">{formError}</div>
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        name={deleteTarget?.nama ?? ""}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
