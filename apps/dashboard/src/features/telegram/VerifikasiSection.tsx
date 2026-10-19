import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/shared/hooks/use-toast";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  CheckCircle2, XCircle, Users, RefreshCw,
  Link2, Unlink, ChevronRight, Download, ExternalLink, Trash2, X, ClipboardList,
  Shield, KeyRound, AlertCircle, Clock, Copy,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";

const API = import.meta.env.BASE_URL?.replace(/\/$/, "") + "/api";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(API + path, {
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw err;
  }
  return res.json();
}

type BulkLink = { amId: number; nama: string; nik: string; divisi: string; link: string | null; code: string; connected: boolean };

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  ADMIN:           { label: "Admin",           color: "text-red-700",      bg: "bg-red-100"       },
  OFFICER:         { label: "Officer",         color: "text-purple-700",   bg: "bg-purple-100"    },
  MANAGER:         { label: "Manager",         color: "text-orange-700",   bg: "bg-orange-100"    },
  ACCOUNT_MANAGER: { label: "AM",              color: "text-emerald-700", bg: "bg-emerald-100"   },
  AM:              { label: "AM",              color: "text-emerald-700", bg: "bg-emerald-100"   },
  INPUTER:         { label: "Inputer",         color: "text-teal-700",     bg: "bg-teal-100"      },
};

// ── BulkLinksModal ────────────────────────────────────────────────────────────
function BulkLinksModal({ data, expiresAt, onClose }: { data: BulkLink[]; expiresAt: string; onClose: () => void }) {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const copy = (text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyAll = () => {
    const text = data
      .map(r => `${r.nama}: ${r.link ?? r.code}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    toast({ title: "Semua link disalin!" });
  };

  const expiryLabel = format(new Date(expiresAt), "dd MMM yyyy HH:mm", { locale: idLocale });

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="font-display font-bold text-base text-foreground">Link Verifikasi Telegram</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.length} AM · Berlaku hingga <span className="font-semibold text-foreground">{expiryLabel}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyAll}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                copiedAll
                  ? "bg-green-100 text-green-700"
                  : "bg-primary text-white hover:bg-primary/90"
              )}
            >
              {copiedAll ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
              {copiedAll ? "Tersalin!" : "Salin Semua"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-3 pb-2 shrink-0">
          <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
            Bagikan link kepada AM masing-masing. Cukup klik link → bot Telegram otomatis terhubung.
            AM yang <span className="text-green-600 font-semibold">sudah terhubung</span> tetap mendapat link baru untuk mengganti koneksi.
          </p>
        </div>

        <div className="overflow-y-auto px-5 pb-5 space-y-2 flex-1">
          {data.map((r, idx) => (
            <div key={r.amId} className="flex items-center gap-3">
              <div className="flex items-center gap-2 shrink-0 w-56 min-w-0">
                <span className="text-[10px] font-mono text-muted-foreground/60 w-5 text-right shrink-0">{idx + 1}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{r.nama}</p>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{r.divisi}</span>
                    {r.connected && (
                      <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded-full font-bold">Terhubung</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 flex items-center gap-1.5 min-w-0">
                <input
                  readOnly
                  value={r.link ?? r.code}
                  className="flex-1 text-[11px] font-mono px-2.5 py-1.5 border border-border rounded-lg bg-secondary/40 text-foreground truncate min-w-0 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => copy(r.link ?? r.code, r.amId)}
                  className={cn(
                    "shrink-0 p-1.5 rounded-lg transition-colors",
                    copiedId === r.amId
                      ? "text-green-600 bg-green-50"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                  title="Salin link"
                >
                  {copiedId === r.amId
                    ? <CheckCircle2 className="w-3.5 h-3.5" />
                    : <Copy className="w-3.5 h-3.5" />}
                </button>
                {r.link && (
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Buka di Telegram"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── BulkDownloadButton ────────────────────────────────────────────────────────
function BulkDownloadButton({ onRefresh, duration }: { onRefresh: () => void; duration?: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const body: any = {};
      if (duration) body.duration = Number(duration);
      const data = await apiFetch("/telegram/bulk-generate-codes", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!data.results?.length) {
        toast({ title: "Semua AM sudah terhubung", description: "Tidak ada AM yang perlu dibuatkan kode verifikasi." });
        return;
      }

      const header = "Nama AM,NIK,Divisi,Kode Verifikasi,Berlaku Sampai";
      const rows = data.results.map((r: any) => {
        const expiry = new Date(r.expiresAt).toLocaleString("id-ID", { hour12: false });
        return `"${r.nama}","${r.nik}","${r.divisi}","${r.code}","${expiry}"`;
      });
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kode-verifikasi-telegram-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: `${data.total} kode berhasil dibuat`, description: "File CSV telah diunduh. Bagikan kode kepada masing-masing AM." });
      onRefresh();
    } catch {
      toast({ title: "Gagal generate kode", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border text-foreground rounded-lg hover:bg-secondary/50 disabled:opacity-50 transition-colors"
    >
      <Download className={cn("w-3.5 h-3.5", loading && "animate-pulse")} />
      {loading ? "Membuat kode..." : "Generate & Download CSV"}
    </button>
  );
}

// ── GenCodeModal ──────────────────────────────────────────────────────────────
function GenCodeModal({ code, link, nama, expiresAt, onClose }: {
  code: string; link: string | null; nama: string; expiresAt: string; onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Tersalin!", description: "Kode verifikasi sudah disalin ke clipboard." });
  };
  const expiryLabel = format(new Date(expiresAt), "dd MMM yyyy HH:mm", { locale: idLocale });

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-foreground">Kode Verifikasi Dibuat</h2>
              <p className="text-xs text-muted-foreground">untuk {nama}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-center space-y-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Kode Verifikasi</p>
          <p className="text-3xl font-mono font-bold tracking-widest text-primary">{code}</p>
          <p className="text-[11px] text-muted-foreground">
            Berlaku hingga <span className="font-semibold text-foreground">{expiryLabel}</span>
          </p>
        </div>

        {link && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1.5">
            <p className="font-semibold">Tautan Langsung:</p>
            <div className="flex items-center gap-1.5">
              <input readOnly value={link} className="flex-1 text-[10px] font-mono px-2 py-1 border border-blue-200 rounded bg-white truncate" />
              <button onClick={() => copy(link)} className="shrink-0 p-1 text-blue-600 hover:text-blue-800">
                {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <a href={link} target="_blank" rel="noreferrer" className="shrink-0 p-1 text-blue-600 hover:text-blue-800">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 space-y-1">
          <p className="font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Cara Penggunaan:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Bagikan kode/tautan ke {nama}</li>
            <li>{nama} buka Telegram → cari bot → ketik/ tempel kode</li>
            <li>Akun Telegram otomatis terhubung</li>
          </ol>
        </div>

        <div className="flex gap-2">
          <button onClick={() => copy(code)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors">
            <Copy className="w-4 h-4" /> Salin Kode
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg font-semibold text-sm text-muted-foreground hover:bg-secondary transition-colors">
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── DurationPicker ────────────────────────────────────────────────────────────
const DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: "30", label: "30 menit" },
  { value: "60", label: "1 jam" },
  { value: "120", label: "2 jam" },
  { value: "240", label: "4 jam" },
  { value: "480", label: "8 jam" },
  { value: "720", label: "12 jam" },
  { value: "1440", label: "24 jam" },
];

function DurationPicker({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-[11px] px-2 py-1 border border-border rounded-lg bg-background focus:ring-1 focus:ring-primary/30 outline-none"
      >
        {DURATION_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── SelectUserModal ───────────────────────────────────────────────────────────
function SelectUserModal({ users, onPick, onClose, loading }: {
  users: any[]; onPick: (userId: number, durationMins: number) => void; onClose: () => void; loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [duration, setDuration] = useState("30");
  const filtered = users.filter(u =>
    !u.telegramConnected && (
      u.nama.toLowerCase().includes(search.toLowerCase()) ||
      u.nik?.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase())
    )
  );
  const roleCfg = (role: string) => ROLE_CONFIG[role] ?? ROLE_CONFIG["ACCOUNT_MANAGER"];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="font-display font-bold text-sm text-foreground">Buat Kode Verifikasi</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-5 pt-3 pb-2 border-b border-border shrink-0 flex-wrap">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari nama, NIK, atau role..."
            className="flex-1 min-w-[160px] px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none" />
          <DurationPicker value={duration} onChange={setDuration} />
        </div>
        <div className="overflow-y-auto px-5 pb-5 space-y-1 flex-1">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              {users.filter(u => !u.telegramConnected).length === 0
                ? "Semua pengguna sudah terhubung Telegram"
                : "Tidak ada hasil pencarian"}
            </p>
          ) : (
            filtered.map(u => {
              const cfg = roleCfg(u.role);
              return (
                <button key={u.id}
                  onClick={() => onPick(u.id, Number(duration))}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/50 text-left transition-colors border border-transparent hover:border-border">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                    {(u.nama || "?")[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{u.nama}</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      {u.nik && <span className="font-mono">{u.nik}</span>}
                      <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold", cfg.bg, cfg.color)}>{cfg.label}</span>
                      {u.divisi && <span>{u.divisi}</span>}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 shrink-0">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── LegacyLinkButton ──────────────────────────────────────────────────────────
function LegacyLinkButton({ user, botUsername, refetch, duration }: { user: any; botUsername: string | null; refetch: () => void; duration?: string }) {
  const { toast } = useToast();
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGen = async () => {
    setGenLoading(true);
    try {
      const body: any = {};
      if (duration) body.duration = Number(duration);
      const data = await apiFetch(`/telegram/gen-link/${user.id}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (data.link) setMagicLink(data.link);
      else toast({ title: "Bot belum dikonfigurasi", description: "Atur token bot di halaman Pengaturan.", variant: "destructive" });
    } catch {
      toast({ title: "Gagal generate link", variant: "destructive" });
    } finally { setGenLoading(false); }
  };

  const isExpired = user.telegramCodeExpiry && new Date(user.telegramCodeExpiry) < new Date();
  const effectiveLink = magicLink ?? (user.telegramCode && !isExpired && botUsername ? `https://t.me/${botUsername}?start=${user.telegramCode}` : null);

  if (effectiveLink) {
    return (
      <div className="flex items-center gap-1 max-w-[220px]">
        <input readOnly value={effectiveLink} className="flex-1 text-[10px] font-mono px-1.5 py-1 border border-border rounded bg-secondary/50 truncate min-w-0" />
        <button onClick={() => copy(effectiveLink)} className="shrink-0 text-primary hover:text-primary/80">
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <a href={effectiveLink} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
          <ExternalLink className="w-3 h-3" />
        </a>
        <button onClick={() => { setMagicLink(null); refetch(); }} className="shrink-0 text-muted-foreground hover:text-foreground" title="Reset">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button onClick={handleGen} disabled={genLoading}
      className="flex items-center gap-1 text-[11px] text-primary font-semibold hover:text-primary/80 disabled:opacity-50 w-fit">
      <Link2 className="w-3 h-3" /> {genLoading ? "..." : "Link"}
    </button>
  );
}

// ── VerifikasiSection — Telegram verification table ───────────────────────────
export function VerifikasiSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [selectedAmId, setSelectedAmId] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLinksData, setBulkLinksData] = useState<{ results: BulkLink[]; expiresAt: string } | null>(null);
  const [genBulkLoading, setGenBulkLoading] = useState(false);
  const [showSubscribers, setShowSubscribers] = useState(false);
  const [showSelectUser, setShowSelectUser] = useState(false);
  const [genCodeResult, setGenCodeResult] = useState<{ code: string; link: string | null; nama: string; expiresAt: string } | null>(null);
  const [linkDuration, setLinkDuration] = useState("30");

  const { data: allUsers, refetch: refetchUsers } = useQuery<any[]>({
    queryKey: ["tg-users"],
    queryFn: () => apiFetch("/telegram/users"),
    staleTime: 0,
  });
  const { data: updates, isLoading: pollLoading, refetch: refetchUpdates, error: pollError } = useQuery<any>({
    queryKey: ["tg-updates"],
    queryFn: () => apiFetch("/telegram/updates"),
    enabled: false,
    retry: false,
  });
  const { data: botStatus } = useQuery<any>({
    queryKey: ["bot-status"],
    queryFn: () => apiFetch("/telegram/bot-status"),
    staleTime: 60000,
  });
  const botUsername: string | null = botStatus?.botUsername ?? null;

  const nonDgsUsers = allUsers?.filter((u: any) => u.divisi !== "DGS") || [];
  const connectedUsers = nonDgsUsers.filter((u: any) => u.telegramConnected);

  const syncAll = async () => {
    try { await apiFetch("/telegram/sync-now", { method: "POST" }); } catch { /* non-fatal */ }
    await refetchUpdates();
    await refetchUsers();
  };

  const genLVMut = useMutation({
    mutationFn: ({ userId, duration }: { userId: number; duration: number }) => apiFetch("/telegram/access-codes", {
      method: "POST",
      body: JSON.stringify({ userId, duration }),
    }),
    onSuccess: (data: any) => {
      setGenCodeResult({ code: data.code, link: data.link, nama: data.userNama, expiresAt: data.expiresAt });
      setShowSelectUser(false);
      refetchUsers();
    },
    onError: (e: any) => {
      toast({ title: "Gagal", description: e.error || "Tidak bisa membuat kode verifikasi", variant: "destructive" });
    },
  });

  const linkMut = useMutation({
    mutationFn: (body: { amId: number; chatId: string }) =>
      apiFetch("/telegram/link-am", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      toast({ title: "Berhasil Dihubungkan", description: "Pengguna berhasil dikaitkan dengan akun Telegram" });
      setLinkTarget(null); setSelectedAmId("");
      await refetchUsers();
      await refetchUpdates();
    },
    onError: (e: any) => toast({ title: "Gagal", description: e.error, variant: "destructive" }),
  });

  const unlinkMut = useMutation({
    mutationFn: (amId: number) => apiFetch(`/telegram/unlink-am/${amId}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast({ title: "Koneksi dilepas" });
      await refetchUsers();
      await refetchUpdates();
    },
  });

  const unlinkAllMut = useMutation({
    mutationFn: (amIds?: number[]) => apiFetch("/telegram/unlink-all", {
      method: "DELETE",
      body: JSON.stringify(amIds ? { amIds } : {}),
    }),
    onSuccess: async (_, amIds) => {
      const count = amIds ? amIds.length : connectedUsers.length;
      toast({ title: `${count} koneksi dilepas` });
      setSelectedIds(new Set());
      await refetchUsers();
      qc.invalidateQueries({ queryKey: ["tg-updates"] });
    },
    onError: () => toast({ title: "Gagal unlink", variant: "destructive" }),
  });

  const subscribers: any[] = updates?.subscribers || [];
  const unlinkedSubscribers = subscribers.filter(s => !s.linked);

  const handleGenBulk = async () => {
    setGenBulkLoading(true);
    try {
      const data = await apiFetch("/telegram/gen-links-bulk", {
        method: "POST",
        body: JSON.stringify({ duration: Number(linkDuration) }),
      });
      if (!data.botUsername) {
        toast({ title: "Bot belum dikonfigurasi", description: "Atur token bot Telegram di halaman Pengaturan.", variant: "destructive" });
        return;
      }
      setBulkLinksData({ results: data.results, expiresAt: data.expiresAt });
      await refetchUsers();
    } catch {
      toast({ title: "Gagal generate link", variant: "destructive" });
    } finally {
      setGenBulkLoading(false);
    }
  };

  const allConnectedSelected = connectedUsers.length > 0 && connectedUsers.every(u => selectedIds.has(u.id));
  const toggleSelectAll = () => {
    if (allConnectedSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(connectedUsers.map((u: any) => u.id)));
  };

  const roleCfg = (role: string) => ROLE_CONFIG[role] ?? ROLE_CONFIG["ACCOUNT_MANAGER"];

  return (
    <div className="space-y-5">
      {genCodeResult && (
        <GenCodeModal
          code={genCodeResult.code}
          link={genCodeResult.link}
          nama={genCodeResult.nama}
          expiresAt={genCodeResult.expiresAt}
          onClose={() => setGenCodeResult(null)}
        />
      )}

      {showSelectUser && (
        <SelectUserModal
          users={allUsers || []}
          onPick={(userId, duration) => genLVMut.mutate({ userId, duration })}
          onClose={() => setShowSelectUser(false)}
          loading={genLVMut.isPending}
        />
      )}

      {bulkLinksData && (
        <BulkLinksModal
          data={bulkLinksData.results}
          expiresAt={bulkLinksData.expiresAt}
          onClose={() => setBulkLinksData(null)}
        />
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <button
            onClick={() => setShowSubscribers(v => !v)}
            className="flex items-center gap-2 text-left group min-w-0 flex-1"
          >
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <span className="font-display font-bold text-sm text-foreground">Pengguna Bot Telegram</span>
              {updates && (
                <span className="ml-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{subscribers.length}</span> pengguna
                  {unlinkedSubscribers.length > 0 && (
                    <span className="ml-1.5 text-amber-600 font-semibold">· {unlinkedSubscribers.length} belum dipetakan</span>
                  )}
                </span>
              )}
              {!updates && <span className="ml-2 text-xs text-muted-foreground">Klik Refresh untuk memuat</span>}
            </div>
            <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", showSubscribers && "rotate-90")} />
          </button>
          <button
            onClick={syncAll}
            disabled={pollLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors shrink-0"
          >
            <RefreshCw className={cn("w-3 h-3", pollLoading && "animate-spin")} />
            {pollLoading ? "Memuat..." : "Refresh"}
          </button>
        </div>

        {showSubscribers && (
          <div className="px-5 pb-4 pt-3 space-y-2">
            {pollError && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-xs text-destructive">
                {(pollError as any).error || "Gagal memuat data pengguna bot."}
              </div>
            )}
            {!updates && !pollLoading && (
              <p className="text-center text-xs text-muted-foreground py-4">Klik "Refresh" untuk melihat siapa yang sudah chat ke bot</p>
            )}
            {subscribers.length === 0 && updates && (
              <p className="text-center text-xs text-muted-foreground py-4">Belum ada pengguna yang berinteraksi dengan bot</p>
            )}
            {subscribers.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-8">#</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Pengguna</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Chat ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Terakhir aktif</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {subscribers.map((s, idx) => (
                      <tr key={s.chatId} className={cn("hover:bg-secondary/20", s.linked ? "bg-green-50/50" : "bg-amber-50/30")}>
                        <td className="px-3 py-2.5 text-muted-foreground/50 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                              {(s.firstName || "?")[0]?.toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground leading-tight">{s.firstName} {s.lastName}</p>
                              {s.username && <p className="text-[10px] text-muted-foreground">@{s.username}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-foreground select-all">{s.chatId}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {s.lastSeen
                            ? <span>{format(new Date(s.lastSeen), "dd MMM HH:mm", { locale: idLocale })}</span>
                            : <span className="text-blue-500/70 italic">via DB</span>
                          }
                          {s.lastMessage && (
                            <p className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">"{s.lastMessage}"</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {s.linked ? (
                            <div>
                              <span className="inline-flex items-center gap-0.5 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">
                                <CheckCircle2 className="w-2.5 h-2.5" /> Terhubung
                              </span>
                              <p className="text-[10px] text-green-700 font-semibold mt-0.5 truncate max-w-[100px]">{s.linkedNama}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                              <XCircle className="w-2.5 h-2.5" /> Belum
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {!s.linked && (
                            linkTarget === s.chatId ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <select
                                  value={selectedAmId}
                                  onChange={e => setSelectedAmId(e.target.value)}
                                  className="text-[11px] px-1.5 py-1 border border-border rounded bg-background"
                                >
                                  <option value="">Pilih...</option>
                                  {nonDgsUsers.filter((u: any) => !u.telegramConnected).map((u: any) => (
                                    <option key={u.id} value={u.id}>{u.nama}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => selectedAmId && linkMut.mutate({ amId: Number(selectedAmId), chatId: s.chatId })}
                                  disabled={!selectedAmId || linkMut.isPending}
                                  className="text-[11px] px-1.5 py-1 bg-primary text-white rounded font-semibold disabled:opacity-50"
                                >Oke</button>
                                <button onClick={() => setLinkTarget(null)} className="text-[11px] text-muted-foreground">✕</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setLinkTarget(s.chatId)}
                                className="flex items-center gap-0.5 text-[11px] text-amber-600 font-semibold hover:text-amber-700"
                              >
                                <Link2 className="w-3 h-3" /> Petakan
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm text-foreground">Status Verifikasi Telegram</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {connectedUsers.length} dari {nonDgsUsers.length} terhubung · Semua role
              </p>
            </div>
            <button
              onClick={() => setShowSelectUser(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Kode Verifikasi</span>
              <span className="sm:hidden">Kode</span>
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleGenBulk}
              disabled={genBulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Link2 className={cn("w-3.5 h-3.5", genBulkLoading && "animate-pulse")} />
              {genBulkLoading ? "Membuat..." : "Generate Semua Link"}
            </button>
            <DurationPicker value={linkDuration} onChange={setLinkDuration} />
            {selectedIds.size > 0 && (
              <button
                onClick={() => unlinkAllMut.mutate([...selectedIds])}
                disabled={unlinkAllMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-destructive text-white rounded-lg hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                <Unlink className="w-3.5 h-3.5" />
                Unlink Terpilih ({selectedIds.size})
              </button>
            )}
            {connectedUsers.length > 0 && selectedIds.size === 0 && (
              <button
                onClick={() => {
                  if (confirm(`Putuskan koneksi semua ${connectedUsers.length} yang terhubung?`))
                    unlinkAllMut.mutate(undefined);
                }}
                disabled={unlinkAllMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-destructive/50 text-destructive rounded-lg hover:bg-destructive/5 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Unlink Semua
              </button>
            )}
            <BulkDownloadButton onRefresh={refetchUsers} duration={linkDuration} />
          </div>
        </div>

        <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex items-start gap-2">
          <Shield className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
          <p className="text-xs text-green-700 leading-relaxed">
            <span className="font-semibold">Kode Verifikasi (LV-XXXXXX)</span> dibuat oleh ADMIN, OFFICER, atau MANAGER
            dan memiliki masa berlaku sesuai durasi yang dipilih. Gunakan untuk menghubungkan akun Telegram pengguna ke sistem.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-muted-foreground font-medium">
              <tr>
                <th className="px-4 py-3 text-left w-8">
                  {connectedUsers.length > 0 && (
                    <input type="checkbox" checked={allConnectedSelected} onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 accent-primary" title="Pilih semua yang terhubung" />
                  )}
                </th>
                <th className="px-4 py-3 text-left text-xs">Nama</th>
                <th className="px-4 py-3 text-left text-xs">NIK</th>
                <th className="px-4 py-3 text-left text-xs">Role</th>
                <th className="px-4 py-3 text-left text-xs">Divisi</th>
                <th className="px-4 py-3 text-left text-xs">Status</th>
                <th className="px-4 py-3 text-left text-xs">Aksi / Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {nonDgsUsers.map((u: any) => {
                const cfg = roleCfg(u.role);
                return (
                  <tr key={u.id} className="hover:bg-secondary/20">
                    <td className="px-4 py-3">
                      {u.telegramConnected && (
                        <input type="checkbox" checked={selectedIds.has(u.id)}
                          onChange={e => {
                            const s = new Set(selectedIds);
                            if (e.target.checked) s.add(u.id); else s.delete(u.id);
                            setSelectedIds(s);
                          }}
                          className="w-3.5 h-3.5 accent-primary" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                          {(u.nama || "?")[0]?.toUpperCase()}
                        </div>
                        <span className="font-semibold text-foreground">{u.nama}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.nik || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[11px] font-bold px-1.5 py-0.5 rounded", cfg.bg, cfg.color)}>{cfg.label}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{u.divisi}</td>
                    <td className="px-4 py-3">
                      {u.telegramConnected ? (
                        <div>
                          <span className="inline-flex items-center gap-1 text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Terhubung
                          </span>
                          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">ID: {u.telegramChatId}</p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                          <XCircle className="w-3 h-3" /> Belum
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        {u.telegramConnected ? (
                          <button
                            onClick={() => unlinkMut.mutate(u.id)}
                            className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive font-medium w-fit"
                          >
                            <Unlink className="w-3 h-3" /> Putuskan
                          </button>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => {
                                genLVMut.mutate({ userId: u.id, duration: Number(linkDuration) });
                              }}
                              disabled={genLVMut.isPending}
                              className="flex items-center gap-1 text-[11px] text-green-600 font-semibold hover:text-green-700 disabled:opacity-50 w-fit"
                              title="Buat Kode Verifikasi LV-XXXXXX"
                            >
                              <KeyRound className="w-3 h-3" />
                              {genLVMut.isPending ? "..." : "Kode Verifikasi"}
                            </button>
                            <div className="flex items-center gap-1.5">
                              <DurationPicker value={linkDuration} onChange={setLinkDuration} />
                              <LegacyLinkButton user={u} botUsername={botUsername} refetch={refetchUsers} duration={linkDuration} />
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {nonDgsUsers.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-xs">Belum ada data pengguna</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
