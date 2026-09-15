import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { cn, formatRupiahFull } from "@/shared/lib/utils";
import { ChevronRight, ChevronDown, Search, X, Filter, Expand, Minimize2, Check } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

const PHASES = ["F0", "F1", "F2", "F3", "F4", "F5"];
const PHASE_LABELS: Record<string, string> = { F0:"Lead", F1:"Prospect", F2:"Quote", F3:"Negosiasi", F4:"Closing", F5:"Won/Closed" };
const PHASE_COLORS: Record<string, { pill: string; bar: string; text: string }> = {
  F0: { pill:"bg-sky-100 text-sky-800",     bar:"#38bdf8", text:"#0369a1" },
  F1: { pill:"bg-blue-100 text-blue-800",   bar:"#3b82f6", text:"#1d4ed8" },
  F2: { pill:"bg-indigo-100 text-indigo-800", bar:"#6366f1", text:"#4338ca" },
  F3: { pill:"bg-violet-100 text-violet-800", bar:"#7c3aed", text:"#5b21b6" },
  F4: { pill:"bg-orange-100 text-orange-800", bar:"#f97316", text:"#c2410c" },
  F5: { pill:"bg-emerald-100 text-emerald-800", bar:"#10b981", text:"#065f46" },
};
const MONTHS_ID = ["","Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];

function periodLabel(p: string): string {
  const [y, m] = p.split("-");
  return `${MONTHS_ID[parseInt(m)] || m} ${y}`;
}

function kategoriColor(k: string): string {
  if (!k) return "";
  const kl = k.toLowerCase();
  if (kl.includes("new") || kl.includes("baru")) return "bg-emerald-100 text-emerald-800";
  if (kl.includes("upsell") || kl.includes("up sell")) return "bg-blue-100 text-blue-800";
  if (kl.includes("cross")) return "bg-violet-100 text-violet-800";
  if (kl.includes("renew") || kl.includes("perpanjang")) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function resolveAmDivisi(am: { divisi: string; phases: Map<string, any[]> }): string {
  if (am.divisi) return am.divisi;
  const counts: Record<string, number> = {};
  for (const lops of am.phases.values())
    for (const l of lops as any[]) if (l.divisi) counts[l.divisi] = (counts[l.divisi] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

// ─── Mini SelectDropdown ────────────────────────────────────────────────────
function SfSelect({ label, value, onChange, options, disabled, className }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const current = options.find(o => o.value === value);
  return (
    <div className={cn("flex flex-col gap-1 relative", className)} ref={ref}>
      {label && <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{label}</label>}
      <button type="button" disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={cn("h-9 px-3 bg-secondary/50 border border-border rounded-lg text-xs flex items-center gap-1.5 w-full transition-colors text-left",
          open && "border-primary/50 ring-2 ring-primary/20", disabled && "opacity-50 cursor-not-allowed")}>
        <span className="flex-1 truncate text-foreground">{current?.label ?? value}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-xl shadow-xl min-w-[160px] max-h-64 overflow-y-auto py-1">
          {options.map(opt => (
            <button key={opt.value} type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors flex items-center gap-2 text-foreground",
                opt.value === value && "font-semibold text-primary")}>
              <span className="w-3.5 shrink-0 flex items-center justify-center">{opt.value === value ? <Check className="w-3 h-3" /> : null}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mini CheckboxDropdown ──────────────────────────────────────────────────
function SfMultiSelect({ label, options, selected, onChange, labelFn, placeholder, summaryLabel, className }: {
  label?: string; options: string[]; selected: Set<string>;
  onChange: (s: Set<string>) => void; labelFn?: (v: string) => string;
  placeholder?: string; summaryLabel?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const getLabel = labelFn ?? ((v: string) => v);
  const toggle = (v: string) => {
    const n = new Set(selected);
    n.has(v) ? n.delete(v) : n.add(v);
    onChange(n);
  };
  const displayText = selected.size === 0
    ? (placeholder ?? `Semua ${summaryLabel ?? ""}`)
    : selected.size === 1 ? getLabel([...selected][0])
    : `${selected.size} ${summaryLabel ?? "terpilih"}`;
  return (
    <div className={cn("flex flex-col gap-1 relative", className)} ref={ref}>
      {label && <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{label}</label>}
      <button type="button" onClick={() => setOpen(o => !o)}
        className={cn("h-9 px-3 bg-secondary/50 border border-border rounded-lg text-xs flex items-center gap-1.5 w-full transition-colors text-left",
          open && "border-primary/50 ring-2 ring-primary/20")}>
        <span className="flex-1 truncate text-foreground">{displayText}</span>
        {selected.size > 0 && <button type="button" onClick={e => { e.stopPropagation(); onChange(new Set()); }} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-card border border-border rounded-xl shadow-xl min-w-[180px] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
            <span className="text-xs font-bold text-muted-foreground">{selected.size === 0 ? "Semua" : `${selected.size} dipilih`}</span>
            {selected.size > 0 && <button type="button" onClick={() => onChange(new Set())} className="text-xs text-primary hover:underline">Reset</button>}
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {options.map(opt => (
              <button key={opt} type="button" onClick={() => toggle(opt)}
                className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/50 cursor-pointer flex items-center gap-2", selected.has(opt) ? "font-semibold text-primary bg-primary/5" : "text-foreground")}>
                <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center", selected.has(opt) ? "bg-primary border-primary" : "border-border")}>
                  {selected.has(opt) && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                {getLabel(opt)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main FunnelSectionCard ─────────────────────────────────────────────────
export function FunnelSectionCard() {
  const [sectionExpanded, setSectionExpanded] = useState(false);

  const [filterYear, setFilterYear] = useState("2026");
  const [filterMonths, setFilterMonths] = useState<Set<string>>(new Set());
  const [importId, setImportId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<Set<string>>(new Set());
  const [filterAm, setFilterAm] = useState<Set<string>>(new Set());
  const [filterDurasi, setFilterDurasi] = useState<"all"|"single_year"|"multi_year">("all");
  const [search, setSearch] = useState("");
  const [expandedAm, setExpandedAm] = useState<Record<string, boolean>>({});
  const [expandedPhase, setExpandedPhase] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  const { data: snapshots = [] } = useQuery<any[]>({
    queryKey: ["funnel-snapshots-performa"],
    queryFn: () => apiFetch("/api/public/funnel/snapshots"),
    staleTime: 60_000,
    enabled: sectionExpanded,
  });

  const yearOptions = useMemo(() => {
    const snapsArr = Array.isArray(snapshots) ? snapshots : [];
    const years = [...new Set(snapsArr.map((s: any) => s.period.slice(0, 4)))].sort().reverse() as string[];
    if (years.length === 0) return [{ value: "2026", label: "2026" }];
    return years.map(y => ({ value: y, label: y }));
  }, [snapshots]);

  const snapshotOptions = useMemo(() =>
    (Array.isArray(snapshots) ? snapshots : []).filter((s: any) => {
      if (!s.period.startsWith(filterYear)) return false;
      if (filterMonths.size > 0 && !filterMonths.has(s.period.slice(5, 7))) return false;
      return true;
    }).map((s: any) => ({
      value: String(s.id),
      label: s.snapshotDate
        ? format(new Date(s.snapshotDate), "d MMM yyyy", { locale: idLocale }) + ` — ${periodLabel(s.period)}`
        : `${periodLabel(s.period)} (${s.rowsImported?.toLocaleString()} LOP)`,
    }))
  , [snapshots, filterYear, filterMonths]);

  useEffect(() => { if (yearOptions.length > 0) setFilterYear(yearOptions[0].value); }, [yearOptions.length]);
  useEffect(() => { if (snapshotOptions.length > 0 && importId === null) setImportId(Number(snapshotOptions[0].value)); }, [snapshotOptions, importId]);

  const funnelParams = useMemo(() => {
    const p = new URLSearchParams();
    if (importId) p.set("import_id", String(importId));
    p.set("rd_year", filterYear); // rd_year = strict reportDate.year filter (sama dg bot & FunnelPage)
    if (filterDurasi !== "all") p.set("durasi_filter", filterDurasi);
    // GTMA & Own Channel — sama kayak bot
    p.set("kategori_kontrak", "GTMA,Own Channel");
    return p.toString();
  }, [importId, filterYear, filterDurasi]);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["funnel-data-performa", funnelParams],
    queryFn: () => apiFetch(`/api/public/funnel?${funnelParams}`),
    enabled: sectionExpanded && (importId !== null || (Array.isArray(snapshots) && snapshots.length === 0)),
    staleTime: 30_000,
  });

  // Period filtering
  const periodFilteredLops = useMemo(() => {
    if (!data) return [];
    return (data.lops || []).filter((l: any) => {
      if (!l.reportDate) return false;
      const rd = String(l.reportDate).slice(0, 10);
      const yr = rd.slice(0, 4);
      if (yr !== filterYear) return false;
      if (filterMonths.size > 0 && !filterMonths.has(rd.slice(5, 7))) return false;
      return true;
    });
  }, [data, filterYear, filterMonths]);

  const amOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of periodFilteredLops) { if (l.nikAm && l.namaAm && l.namaAm.trim() !== "") map.set(l.nikAm, l.namaAm); }
    return Array.from(map.keys()).sort((a, b) => (map.get(a) || "").localeCompare(map.get(b) || ""));
  }, [periodFilteredLops]);

  const amLabelFn = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of periodFilteredLops) { if (l.nikAm && l.namaAm) map.set(l.nikAm, l.namaAm); }
    return (nik: string) => map.get(nik) || nik;
  }, [periodFilteredLops]);

  const filteredLops = useMemo(() => {
    const q = search.toLowerCase();
    return periodFilteredLops.filter((l: any) => {
      if (filterAm.size > 0 && (!l.nikAm || !filterAm.has(l.nikAm))) return false;
      if (filterStatus.size > 0 && (!l.statusF || !filterStatus.has(l.statusF))) return false;
      if (q) { const hay = `${l.judulProyek} ${l.pelanggan} ${l.lopid} ${l.namaAm}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
  }, [periodFilteredLops, filterAm, filterStatus, search]);

  const groupedByAm = useMemo(() => {
    const getAnnualized = (l: any) => {
      const m = l.monthSubs;
      return (m && m < 12) ? Math.round((l.nilaiProyek || 0) * 12 / m) : (l.nilaiProyek || 0);
    };
    const amMap = new Map<string, { namaAm: string; nikAm: string; divisi: string; phases: Map<string, any[]> }>();
    for (const l of filteredLops) {
      const key = l.nikAm || l.namaAm || "Unknown";
      if (!amMap.has(key)) amMap.set(key, { namaAm: l.namaAm || key, nikAm: l.nikAm || "", divisi: l.divisi || "", phases: new Map() });
      const e = amMap.get(key)!;
      if (!e.divisi && l.divisi) e.divisi = l.divisi;
      const phase = l.statusF || "Unknown";
      if (!e.phases.has(phase)) e.phases.set(phase, []);
      e.phases.get(phase)!.push(l);
    }
    return Array.from(amMap.values()).sort((a, b) => {
      const totA = Array.from(a.phases.values()).flat().reduce((s: number, l: any) => s + getAnnualized(l), 0);
      const totB = Array.from(b.phases.values()).flat().reduce((s: number, l: any) => s + getAnnualized(l), 0);
      return totB - totA;
    });
  }, [filteredLops]);

  // Summary stats — annualized nilaiProyek & CR sama kayak bot: F5/(F3+F4+F5)
  const stats = useMemo(() => {
    const lops = periodFilteredLops;
    const getAnnualized = (l: any) => {
      const m = l.monthSubs;
      return (m && m < 12) ? Math.round((l.nilaiProyek || 0) * 12 / m) : (l.nilaiProyek || 0);
    };
    const byPhase = PHASES.map(p => ({
      phase: p,
      count: lops.filter((l: any) => l.statusF === p).length,
      nilai: lops.filter((l: any) => l.statusF === p).reduce((s: number, l: any) => s + getAnnualized(l), 0),
    }));
    const f3 = byPhase.find(p => p.phase === "F3")?.nilai || 0;
    const f4 = byPhase.find(p => p.phase === "F4")?.nilai || 0;
    const f5 = byPhase.find(p => p.phase === "F5")?.nilai || 0;
    const cr = (f3 + f4 + f5) > 0 ? (f5 / (f3 + f4 + f5)) * 100 : 0;
    return { totalLop: lops.length, totalNilai: byPhase.reduce((s, p) => s + p.nilai, 0), byPhase, cr };
  }, [periodFilteredLops]);

  const lastAutoExpandId = useRef<number | null>(undefined as any);
  useEffect(() => {
    if (groupedByAm.length === 0) return;
    if (importId === lastAutoExpandId.current) return;
    lastAutoExpandId.current = importId;
    setExpandedAm({}); setExpandedPhase({}); setAllExpanded(false);
  }, [groupedByAm, importId]);

  function toggleAmRow(key: string) { setExpandedAm(p => ({ ...p, [key]: !p[key] })); }
  function handleAmExpandIcon(amKey: string, phases: string[]) {
    const isNowExpanding = !expandedAm[amKey];
    setExpandedAm(p => ({ ...p, [amKey]: isNowExpanding }));
    if (isNowExpanding) {
      const pk: Record<string, boolean> = {};
      for (const ph of phases) pk[`${amKey}|${ph}`] = true;
      setExpandedPhase(p => ({ ...p, ...pk }));
    } else {
      setExpandedPhase(p => { const n = { ...p }; for (const ph of phases) delete n[`${amKey}|${ph}`]; return n; });
    }
  }
  function togglePhaseRow(key: string) { setExpandedPhase(p => ({ ...p, [key]: !p[key] })); }
  function handleToggleAll() {
    const next = !allExpanded;
    setAllExpanded(next);
    if (next) {
      const ak: Record<string, boolean> = {}, pk: Record<string, boolean> = {};
      for (const am of groupedByAm) {
        ak[am.nikAm || am.namaAm] = true;
        for (const [ph] of am.phases) pk[`${am.nikAm || am.namaAm}|${ph}`] = true;
      }
      setExpandedAm(ak); setExpandedPhase(pk);
    } else { setExpandedAm({}); setExpandedPhase({}); }
  }

  const lopBadge = filteredLops.length !== (periodFilteredLops.length)
    ? `${filteredLops.length} / ${periodFilteredLops.length}`
    : filteredLops.length.toLocaleString("id-ID");

  const TB_STYLE: React.CSSProperties = { minWidth: "860px", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: "100%" };
  function ColGroup() {
    return (
      <colgroup>
        <col style={{ width: "34%" }} />
        <col style={{ width: "110px" }} />
        <col style={{ width: "110px" }} />
        <col />
        <col style={{ width: "180px" }} />
      </colgroup>
    );
  }

  function renderAmTables(): React.ReactNode {
    if (isLoading) return (
      <table className="text-left text-sm" style={TB_STYLE}><ColGroup />
        <tbody><tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">Memuat data funnel...</td></tr></tbody>
      </table>
    );
    if (groupedByAm.length === 0) return (
      <table className="text-left text-sm" style={TB_STYLE}><ColGroup />
        <tbody><tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">{search || filterAm.size > 0 || filterStatus.size > 0 ? "Tidak ada data yang cocok" : "Belum ada data funnel"}</td></tr></tbody>
      </table>
    );

    return <>{groupedByAm.map((am) => {
      const amKey = am.nikAm || am.namaAm;
      const amExpanded = !!expandedAm[amKey];
      const getAnnualized = (l: any) => {
        const m = l.monthSubs;
        return (m && m < 12) ? Math.round((l.nilaiProyek || 0) * 12 / m) : (l.nilaiProyek || 0);
      };
      const amTotal = Array.from(am.phases.values()).flat().reduce((s: number, l: any) => s + getAnnualized(l), 0);
      const amLopCount = Array.from(am.phases.values()).flat().length;
      const orderedPhases = [...PHASES.filter(p => am.phases.has(p)), ...Array.from(am.phases.keys()).filter(p => !PHASES.includes(p))];
      const divisi = resolveAmDivisi(am);
      const bgCard = "hsl(var(--card))";
      const divBadge = divisi ? (
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",
          divisi === "DPS" ? "bg-blue-100 text-blue-700" : divisi === "DSS" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
          {divisi}
        </span>
      ) : null;

      if (!amExpanded) {
        return (
          <table key={amKey} className="text-left text-sm" style={{ ...TB_STYLE, border: "1.5px solid #e2e8f0" }}>
            <ColGroup />
            <tbody>
              <tr className="cursor-pointer select-none bg-card hover:bg-secondary/30 transition-colors" onClick={() => toggleAmRow(amKey)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-black text-foreground text-sm uppercase tracking-wide">{am.namaAm}</span>
                    {divBadge}
                    <button type="button" onClick={e => { e.stopPropagation(); handleAmExpandIcon(amKey, orderedPhases); }}
                      className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0" title="Expand semua proyek">
                      <Expand className="w-3 h-3" />
                    </button>
                  </div>
                </td>
                <td className="px-3 py-3" colSpan={3}><span className="text-xs font-black text-foreground tracking-wide">TOTAL {amLopCount} LOP</span></td>
                <td className="px-4 py-3 text-right whitespace-nowrap"><span className="font-black text-foreground tabular-nums text-sm">{formatRupiahFull(amTotal)}</span></td>
              </tr>
            </tbody>
          </table>
        );
      }

      return (
        <table key={amKey} className="text-left text-sm" style={{ ...TB_STYLE, border: "2px solid #dc2626" }}>
          <ColGroup />
          <thead style={{ position: "sticky", top: 0, zIndex: 12 }}>
            <tr className="cursor-pointer select-none hover:brightness-95 transition-colors" onClick={() => toggleAmRow(amKey)}>
              <th className="px-4 py-2.5 font-normal text-left" style={{ backgroundColor: bgCard }}>
                <div className="flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rotate-90" />
                  <span className="font-black text-foreground text-sm uppercase tracking-wide">{am.namaAm}</span>
                  {divBadge}
                  <button type="button" onClick={e => { e.stopPropagation(); handleAmExpandIcon(amKey, orderedPhases); }}
                    className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0" title="Collapse semua proyek">
                    <Minimize2 className="w-3 h-3" />
                  </button>
                </div>
              </th>
              <th className="px-3 py-2.5 font-normal" colSpan={4} style={{ backgroundColor: bgCard }}>
                <span className="text-xs font-black text-foreground tracking-wide">TOTAL {amLopCount} LOP</span>
              </th>
            </tr>
          </thead>
          {orderedPhases.map((phase) => {
            const lops = am.phases.get(phase) || [];
            const phaseKey = `${amKey}|${phase}`;
            const phaseExpanded = !!expandedPhase[phaseKey];
            const phaseTotal = lops.reduce((s: number, l: any) => s + getAnnualized(l), 0);
            const c = PHASE_COLORS[phase];
            const phaseBg = phaseExpanded ? "rgb(253,242,248)" : "rgba(253,242,248,0.75)";
            const phaseCell: React.CSSProperties = { background: phaseBg };
            return (
              <tbody key={phaseKey}>
                <tr className="cursor-pointer select-none" onClick={() => togglePhaseRow(phaseKey)}>
                  <td style={{ ...phaseCell, borderLeft: `4px solid ${c?.bar || "#94a3b8"}` }} className="px-4 py-2.5 pl-10">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0", phaseExpanded && "rotate-90")} />
                      <span className="text-sm font-black uppercase tracking-wide" style={{ color: c?.text }}>{phase} — {PHASE_LABELS[phase] ?? phase}</span>
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">{lops.length} proyek</span>
                    </div>
                  </td>
                  {phaseExpanded
                    ? <td colSpan={4} style={phaseCell} />
                    : <>
                      <td colSpan={3} style={phaseCell} />
                      <td style={{ ...phaseCell, textAlign: "right" }} className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-sm font-black text-foreground tabular-nums">{formatRupiahFull(phaseTotal)}</span>
                      </td>
                    </>
                  }
                </tr>
                {phaseExpanded && lops.map((lop: any, idx: number) => (
                  <tr key={`${lop.lopid}-${idx}`} className="hover:bg-pink-50 transition-colors">
                    <td className="px-4 py-2 pl-16" style={{ minWidth: "280px" }}>
                      <div className="text-sm text-foreground font-bold leading-tight line-clamp-2" title={lop.judulProyek}>{lop.judulProyek}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {lop.kategoriKontrak
                        ? <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap ${kategoriColor(lop.kategoriKontrak)}`}>{lop.kategoriKontrak}</span>
                        : <span className="text-muted-foreground text-xs">–</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-foreground whitespace-nowrap">{lop.lopid}</td>
                    <td className="px-3 py-2 text-sm text-foreground font-bold truncate max-w-[200px]" title={lop.pelanggan}>{lop.pelanggan}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-black text-foreground whitespace-nowrap">{formatRupiahFull(getAnnualized(lop))}</td>
                  </tr>
                ))}
                {phaseExpanded && (
                  <tr className="bg-red-50 border-t border-red-200">
                    <td colSpan={4} className="px-4 py-2 pl-16"><span className="text-sm font-black text-red-800 uppercase tracking-wide">Total Nilai {phase}</span></td>
                    <td className="px-4 py-2 text-right tabular-nums font-black text-red-800 whitespace-nowrap">{formatRupiahFull(phaseTotal)}</td>
                  </tr>
                )}
              </tbody>
            );
          })}
          <tbody>
            <tr className="bg-slate-100 border-t-2 border-slate-300">
              <td colSpan={4} className="px-4 py-2.5 pl-10">
                <span className="text-sm font-black text-red-700 uppercase tracking-wide">Total Nilai Proyek — {am.namaAm}</span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-black text-red-700 whitespace-nowrap text-base">{formatRupiahFull(amTotal)}</td>
            </tr>
          </tbody>
        </table>
      );
    })}</>;
  }

  return (
    <div className="bg-card border border-border rounded-xl">
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setSectionExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/20 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-display font-semibold text-foreground">Sales Funnel per AM</h3>
          {!sectionExpanded && stats.totalLop > 0 && (
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full font-medium">{stats.totalLop.toLocaleString("id-ID")} LOP</span>
          )}
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", sectionExpanded && "rotate-180")} />
      </button>

      {sectionExpanded && (
        <div className="border-t border-border">
          {/* Filter Bar */}
          <div className="px-4 py-3 border-b border-border/60">
            <div className="flex items-end gap-2 flex-wrap">
              <SfSelect
                label="Snapshot"
                value={String(importId ?? "")}
                onChange={v => setImportId(Number(v))}
                options={snapshotOptions.length > 0 ? snapshotOptions : [{ value: "", label: "Belum ada data" }]}
                disabled={snapshotOptions.length === 0}
                className="flex-1 min-w-[140px]"
              />
              <SfSelect
                label="Tahun"
                value={filterYear}
                onChange={v => { setFilterYear(v); setFilterMonths(new Set()); setImportId(null); }}
                options={yearOptions}
                className="w-24 shrink-0"
              />
              <SfMultiSelect
                label="Bulan"
                options={["01","02","03","04","05","06","07","08","09","10","11","12"]}
                selected={filterMonths}
                onChange={v => { setFilterMonths(v); setImportId(null); }}
                labelFn={m => MONTHS_ID[parseInt(m)] || m}
                placeholder="Semua bulan"
                summaryLabel="bulan"
                className="flex-1 min-w-[120px]"
              />
              <SfMultiSelect
                label="AM"
                options={amOptions}
                selected={filterAm}
                onChange={setFilterAm}
                labelFn={amLabelFn}
                placeholder="Semua AM"
                summaryLabel="AM"
                className="flex-1 min-w-[120px]"
              />
              <SfMultiSelect
                label="Status Funnel"
                options={PHASES}
                selected={filterStatus}
                onChange={setFilterStatus}
                labelFn={p => `${p} – ${PHASE_LABELS[p]}`}
                placeholder="Semua status"
                summaryLabel="status"
                className="flex-1 min-w-[120px]"
              />
              <SfSelect
                label="Durasi Kontrak"
                value={filterDurasi}
                onChange={v => setFilterDurasi(v as typeof filterDurasi)}
                options={[
                  { value: "all", label: "Semua Durasi" },
                  { value: "single_year", label: "Nilai per Tahun" },
                  { value: "multi_year", label: "Multi Year (>12 bln)" },
                ]}
                className="w-44 shrink-0"
              />
              {/* Search */}
              <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Cari</label>
                <div className="relative h-9">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Proyek, pelanggan, LOP ID..."
                    className="h-9 w-full pl-8 pr-7 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 placeholder:text-muted-foreground/60"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Phase Summary Chips */}
          {!isLoading && stats.totalLop > 0 && (
            <div className="px-4 py-2.5 border-b border-border/60 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground shrink-0">
                {lopBadge} LOP · {formatRupiahFull(stats.totalNilai)}
                {filterDurasi !== "all" && <span className="text-teal-600 font-semibold ml-1">· CR {stats.cr.toFixed(1)}%</span>}
              </span>
              <span className="text-muted-foreground">·</span>
              {stats.byPhase.filter(p => p.count > 0).map(p => {
                const c = PHASE_COLORS[p.phase];
                return (
                  <span key={p.phase} className={cn("inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full", c?.pill || "bg-slate-100 text-slate-700")}>
                    {p.phase}: {p.count} LOP
                  </span>
                );
              })}
            </div>
          )}

          {/* Table toolbar */}
          <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">{groupedByAm.length} AM</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1.5 transition-colors whitespace-nowrap"
              >
                {allExpanded ? <Minimize2 className="w-3 h-3" /> : <Expand className="w-3 h-3" />}
                {allExpanded ? "Collapse Semua" : "Expand Semua AM"}
              </button>
            </div>
          </div>

          {/* Table — single overflow-x-auto wrapper; header + AM rows scroll together horizontally */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: "860px" }}>
              <table className="text-left text-xs w-full" style={{ ...TB_STYLE }}>
                <ColGroup />
                <thead>
                  <tr className="bg-red-700 text-white font-black uppercase tracking-wide text-xs">
                    <th className="px-4 py-2.5 text-left">Nama AM / Proyek</th>
                    <th className="px-3 py-2.5 text-left">Kategori</th>
                    <th className="px-3 py-2.5 text-left">LOP ID</th>
                    <th className="px-3 py-2.5 text-left">Pelanggan</th>
                    <th className="px-4 py-2.5 text-right">Nilai Proyek</th>
                  </tr>
                </thead>
              </table>
              <div className="space-y-px">
                {renderAmTables()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
