import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/shared/hooks/use-toast";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  Send, History, CheckCircle2, XCircle,
  BarChart2, GitBranch, Activity, MessageSquare,
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

type MsgTab = "semua" | "performa" | "funnel" | "activity";

const MSG_TABS: { id: MsgTab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "semua", label: "Semua Data", icon: <MessageSquare className="w-4 h-4" />, desc: "Kirim gabungan performa, funnel, dan activity" },
  { id: "performa", label: "Performa Revenue", icon: <BarChart2 className="w-4 h-4" />, desc: "Kirim laporan target vs real revenue AM" },
  { id: "funnel", label: "Sales Funnel", icon: <GitBranch className="w-4 h-4" />, desc: "Kirim ringkasan LOP aktif dan pipeline" },
  { id: "activity", label: "Sales Activity", icon: <Activity className="w-4 h-4" />, desc: "Kirim status KPI kunjungan AM" },
];

// ── SnapshotPicker helper ──────────────────────────────────────────────────────
function SnapshotPicker({
  label, hint, imports, value, onChange, emptyMsg,
}: {
  label: string; hint?: string; imports: any[] | undefined;
  value: number | null; onChange: (id: number | null, period: string) => void;
  emptyMsg?: string;
}) {
  const opts = imports || [];
  return (
    <div>
      <label className="text-xs font-bold text-foreground block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground mb-1.5 leading-snug">{hint}</p>}
      {opts.length === 0 ? (
        <div className="px-3 py-2.5 bg-secondary/30 border border-dashed border-border rounded-lg text-xs text-muted-foreground">
          {emptyMsg || "Belum ada snapshot tersedia"}
        </div>
      ) : (
        <select
          value={value ?? ""}
          onChange={e => {
            const id = Number(e.target.value);
            const found = opts.find(o => o.id === id);
            onChange(id || null, found?.period ?? "");
          }}
          className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        >
          {opts.map(o => (
            <option key={o.id} value={o.id}>
              {o.snapshotDate
                ? format(new Date(o.snapshotDate), "d MMM yyyy", { locale: idLocale })
                : format(new Date(o.createdAt), "d MMM yyyy HH:mm", { locale: idLocale })}
              {o.period ? ` — ${o.period}` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

type ConfigTab = "performa" | "funnel" | "activity";

// ── KirimPesanSection ──────────────────────────────────────────────────────────
function KirimPesanSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [msgTab, setMsgTab] = useState<MsgTab>("semua");
  const [configTab, setConfigTab] = useState<ConfigTab>("performa");
  const [customMsg, setCustomMsg] = useState("");
  const [targetNiks, setTargetNiks] = useState<string[] | null>(null);

  const [perfSnapId, setPerfSnapId] = useState<number | null>(null);
  const [perfPeriod, setPerfPeriod] = useState("");
  const [funnelCurrId, setFunnelCurrId] = useState<number | null>(null);
  const [funnelPrevId, setFunnelPrevId] = useState<number | null>(null);
  const [activityCurrId, setActivityCurrId] = useState<number | null>(null);

  const { data: ams } = useQuery<any[]>({ queryKey: ["ams"], queryFn: () => apiFetch("/am") });

  const { data: allImports } = useQuery<any[]>({
    queryKey: ["import-history"],
    queryFn: () => apiFetch("/import/history"),
  });
  const perfImports  = allImports?.filter(i => i.type === "performance") ?? [];
  const funnelImports = allImports?.filter(i => i.type === "funnel")      ?? [];
  const actImports   = allImports?.filter(i => i.type === "activity")     ?? [];

  React.useEffect(() => {
    if (perfImports.length > 0 && perfSnapId === null) {
      setPerfSnapId(perfImports[0].id);
      setPerfPeriod(perfImports[0].period ?? "");
    }
  }, [perfImports.length]);
  React.useEffect(() => {
    if (funnelImports.length > 0 && funnelCurrId === null) setFunnelCurrId(funnelImports[0].id);
    if (funnelImports.length > 1 && funnelPrevId === null) setFunnelPrevId(funnelImports[1].id);
  }, [funnelImports.length]);
  React.useEffect(() => {
    if (actImports.length > 0 && activityCurrId === null) setActivityCurrId(actImports[0].id);
  }, [actImports.length]);

  const sendMut = useMutation({
    mutationFn: (body: object) => apiFetch("/telegram/send", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res: any) => {
      toast({ title: "Broadcast Selesai", description: `Terkirim: ${res.sent} · Gagal: ${res.failed} · Lewati: ${res.skipped}` });
      qc.invalidateQueries({ queryKey: ["tg-logs"] });
    },
    onError: (e: any) => toast({ title: "Gagal Kirim", description: e.error || "Terjadi kesalahan", variant: "destructive" }),
  });

  const effectivePeriod = (() => {
    if (msgTab === "funnel") return funnelImports.find(i => i.id === funnelCurrId)?.period || perfPeriod;
    if (msgTab === "activity") return actImports.find(i => i.id === activityCurrId)?.period || perfPeriod;
    return perfPeriod;
  })();

  const handleSend = () => {
    sendMut.mutate({
      period: effectivePeriod,
      includePerformance: msgTab === "semua" || msgTab === "performa",
      includeFunnel: msgTab === "semua" || msgTab === "funnel",
      includeActivity: msgTab === "semua" || msgTab === "activity",
      perfSnapshotId: perfSnapId,
      funnelCurrSnapshotId: funnelCurrId,
      funnelPrevSnapshotId: funnelPrevId,
      activitySnapshotId: activityCurrId,
      customMessage: customMsg || null,
      targetNiks,
    });
  };

  const connectedAms = ams?.filter((a: any) => a.telegramConnected && a.divisi !== "DGS") || [];
  const needsPerf    = msgTab === "semua" || msgTab === "performa";
  const needsFunnel  = msgTab === "semua" || msgTab === "funnel";
  const needsAct     = msgTab === "semua" || msgTab === "activity";

  const activeConfig: ConfigTab =
    msgTab === "performa" ? "performa" :
    msgTab === "funnel"   ? "funnel" :
    msgTab === "activity" ? "activity" :
    configTab;

  const CONFIG_TABS: { id: ConfigTab; label: string }[] = [
    { id: "performa", label: "Performa" },
    { id: "funnel",   label: "Funnel" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
      <div className="xl:col-span-2 space-y-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-display font-bold text-sm mb-4 text-foreground">Konfigurasi Pesan</h3>
          <div className="space-y-4">

            {msgTab === "semua" && (
              <div className="flex border-b border-border -mx-5 px-5">
                {CONFIG_TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setConfigTab(t.id)}
                    className={cn(
                      "py-2 px-4 text-xs font-semibold transition-all border-b-2 -mb-px",
                      configTab === t.id
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {activeConfig === "performa" && (
              <div className="space-y-3">
                <SnapshotPicker
                  label="Snapshot Performa"
                  hint="Data bulanan performa revenue AM"
                  imports={perfImports}
                  value={perfSnapId}
                  onChange={(id, p) => { setPerfSnapId(id); setPerfPeriod(p); }}
                  emptyMsg="Import data performa terlebih dahulu"
                />
                <div>
                  <label className="text-xs font-bold text-foreground block mb-1.5">Periode Laporan</label>
                  <input
                    type="month"
                    value={perfPeriod}
                    onChange={e => setPerfPeriod(e.target.value)}
                    className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
              </div>
            )}

            {activeConfig === "funnel" && (
              <div className="space-y-3">
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-700 leading-snug">
                  LOP dengan status F yang <strong>tidak berubah</strong> antara dua snapshot = belum diperbarui
                </div>
                <SnapshotPicker
                  label="Snapshot Minggu Ini"
                  hint="Snapshot funnel terkini"
                  imports={funnelImports}
                  value={funnelCurrId}
                  onChange={(id) => setFunnelCurrId(id)}
                  emptyMsg="Import data funnel minggu ini terlebih dahulu"
                />
                <SnapshotPicker
                  label="Snapshot Minggu Lalu"
                  hint="Dibandingkan dengan minggu ini untuk deteksi LOP stagnan"
                  imports={funnelImports}
                  value={funnelPrevId}
                  onChange={(id) => setFunnelPrevId(id)}
                  emptyMsg="Belum ada snapshot minggu lalu"
                />
              </div>
            )}

            {activeConfig === "activity" && (
              <div className="space-y-3">
                <div className="p-2.5 bg-purple-50 border border-purple-200 rounded-lg text-[11px] text-purple-700 leading-snug">
                  Cek jumlah aktivitas kunjungan minggu ini dan status pencapaian KPI masing-masing AM
                </div>
                <SnapshotPicker
                  label="Snapshot Minggu Ini"
                  hint="Data aktivitas minggu berjalan"
                  imports={actImports}
                  value={activityCurrId}
                  onChange={(id) => setActivityCurrId(id)}
                  emptyMsg="Import data activity minggu ini terlebih dahulu"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-foreground block mb-1.5">Target Penerima</label>
              <select
                value={targetNiks === null ? "" : "specific"}
                onChange={e => setTargetNiks(e.target.value === "" ? null : [])}
                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
              >
                <option value="">Semua AM Terhubung ({connectedAms.length} orang)</option>
                <option value="specific">Pilih AM tertentu</option>
              </select>
              {targetNiks !== null && (
                <div className="mt-2 space-y-1 max-h-36 overflow-y-auto border border-border rounded-lg p-2">
                  {connectedAms.map((am: any) => (
                    <label key={am.nik} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-secondary/50 px-2 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={targetNiks.includes(am.nik)}
                        onChange={e => {
                          if (e.target.checked) setTargetNiks([...(targetNiks || []), am.nik]);
                          else setTargetNiks((targetNiks || []).filter(n => n !== am.nik));
                        }}
                        className="w-3.5 h-3.5"
                      />
                      <span className="font-medium">{am.nama}</span>
                      <span className="text-xs text-muted-foreground">({am.divisi})</span>
                    </label>
                  ))}
                  {connectedAms.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Belum ada AM terhubung</p>}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-foreground block mb-1.5">Pesan Tambahan (Opsional)</label>
              <textarea
                rows={3}
                value={customMsg}
                onChange={e => setCustomMsg(e.target.value)}
                placeholder="Semangat pagi, mohon cek performa kamu..."
                className="w-full px-3 py-2.5 bg-secondary/50 border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 mb-1">Info Koneksi</p>
          <p className="text-sm font-bold text-amber-900">{connectedAms.length} dari {ams?.length || 0} AM terhubung</p>
          <p className="text-xs text-amber-600 mt-1">
            Kelola koneksi & buat kode verifikasi di tab{" "}
            <a href="/manajemen-akun" className="font-semibold underline">Manajemen Akun → Telegram Akun</a>.
          </p>
        </div>
      </div>

      <div className="xl:col-span-3 space-y-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-display font-bold text-sm mb-3 text-foreground">Tipe Pesan</h3>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {MSG_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMsgTab(tab.id)}
                className={cn(
                  "flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all",
                  msgTab === tab.id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40 hover:bg-secondary/50"
                )}
              >
                <span className={cn("mt-0.5 shrink-0", msgTab === tab.id ? "text-primary" : "text-muted-foreground")}>{tab.icon}</span>
                <div>
                  <p className="text-xs font-bold">{tab.label}</p>
                  <p className="text-[10px] mt-0.5 leading-tight">{tab.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="bg-secondary/40 rounded-lg p-3 mb-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Konten yang dikirim:</p>
            <div className="flex flex-wrap gap-1.5">
              {needsPerf && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  <BarChart2 className="w-3 h-3" /> Performa Revenue
                </span>
              )}
              {needsFunnel && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  <GitBranch className="w-3 h-3" /> Sales Funnel
                </span>
              )}
              {needsAct && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                  <Activity className="w-3 h-3" /> Sales Activity
                </span>
              )}
            </div>
          </div>

          {msgTab === "funnel" && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
              <p className="font-semibold mb-1">ℹ️ Tujuan Reminder Funnel</p>
              <p className="text-blue-700 leading-relaxed">Membandingkan status F (Funnel) dua snapshot minggu — LOP yang <strong>tidak ada perubahan status</strong> antara minggu lalu dan minggu ini akan ditandai sebagai belum diperbarui.</p>
            </div>
          )}
          {msgTab === "activity" && (
            <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-800">
              <p className="font-semibold mb-1">ℹ️ Tujuan Reminder Activity</p>
              <p className="text-purple-700 leading-relaxed">Melacak jumlah aktivitas kunjungan minggu berjalan dan menginformasikan apakah KPI aktivitas sudah tercapai atau belum.</p>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={sendMut.isPending || connectedAms.length === 0}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/25 hover:shadow-primary/40 active:scale-[0.99] transition-all disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {sendMut.isPending ? "Mengirim..." : `Kirim ${targetNiks?.length ? `ke ${targetNiks.length} AM` : `ke Semua (${connectedAms.length})`}`}
          </button>

          {sendMut.isSuccess && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
              <p className="font-semibold mb-1">Broadcast selesai!</p>
              <p>Terkirim: {(sendMut.data as any).sent} · Gagal: {(sendMut.data as any).failed} · Dilewati: {(sendMut.data as any).skipped}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RiwayatSection() {
  const { data: logs } = useQuery<any[]>({
    queryKey: ["tg-logs"],
    queryFn: () => apiFetch("/telegram/logs"),
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-display font-bold text-sm text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" /> Riwayat Pengiriman Bot
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-secondary/50 text-muted-foreground font-medium">
            <tr>
              <th className="px-5 py-3 text-left text-xs">Waktu</th>
              <th className="px-5 py-3 text-left text-xs">Nama AM</th>
              <th className="px-5 py-3 text-left text-xs">Periode</th>
              <th className="px-5 py-3 text-left text-xs">Status</th>
              <th className="px-5 py-3 text-left text-xs">Keterangan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs?.map((log: any) => (
              <tr key={log.id} className="hover:bg-secondary/20">
                <td className="px-5 py-3 text-muted-foreground text-xs">{format(new Date(log.createdAt), "dd/MM/yy HH:mm")}</td>
                <td className="px-5 py-3 font-semibold">{log.namaAm}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{log.period}</td>
                <td className="px-5 py-3">
                  {log.status === "success" || log.status === "sent" ? (
                    <span className="inline-flex items-center gap-1 text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                      <CheckCircle2 className="w-3 h-3" /> Terkirim
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-bold">
                      <XCircle className="w-3 h-3" /> Gagal
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground max-w-[220px] truncate">{log.error || "OK"}</td>
              </tr>
            ))}
            {logs?.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground text-sm">Belum ada riwayat pengiriman</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MainTab = "kirim" | "riwayat";

const MAIN_TABS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  { id: "kirim",   label: "Kirim Pesan",   icon: <Send    className="w-4 h-4" /> },
  { id: "riwayat", label: "Riwayat Log",   icon: <History className="w-4 h-4" /> },
];

export default function TelegramBot() {
  const [mainTab, setMainTab] = useState<MainTab>("kirim");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
          <Send className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">Bot Telegram RLEGS</h1>
          <p className="text-sm text-muted-foreground">
            Kirim reminder performa otomatis ke AM via Telegram.
            {" "}<span className="font-semibold text-foreground">Kelola koneksi & kode verifikasi</span> di{" "}
            <a href="/manajemen-akun" className="font-semibold text-primary hover:underline">Manajemen Akun → Telegram Akun</a>.
          </p>
        </div>
      </div>

      <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl w-fit">
        {MAIN_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMainTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
              mainTab === tab.id
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "kirim"   && <KirimPesanSection />}
      {mainTab === "riwayat" && <RiwayatSection />}
    </div>
  );
}
