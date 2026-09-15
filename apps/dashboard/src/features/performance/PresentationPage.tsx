import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { matchesDivisi, matchesDivisiPerforma, DIVISI_OPTIONS, DIVISI_OPTIONS_WITH_ALL, divisiFilterLabel } from "@/shared/lib/divisi";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { formatRupiah, formatRupiahFull, formatPercent, getStatusColor, getAchPct, cn } from "@/shared/lib/utils";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  Line, ComposedChart, Legend, PieChart, Pie
} from "recharts";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { getPresentationSession, clearPresentationSession } from "@/shared/hooks/use-presentation-auth";
import { ChevronDown, ChevronLeft, ChevronRight, Camera, X, BarChart2, Filter, Activity, Check, Maximize2, Minimize2, Expand, Search, Columns2, LogOut, TrendingUp } from "lucide-react";
import PrognosaSlide, { SCENARIOS, ScenarioKey, prognosaDataDefault, TIPE_RANK_OPTIONS, TIPE_REVENUE_OPTIONS, TipeRankKey, TipeRevenueKey } from "./PrognosaSlide";
const SLIDES = [
  { label: "Visualisasi Performa", icon: BarChart2 },
  { label: "Prognosa AM", icon: TrendingUp },
  { label: "AM Sales Funnel", icon: Filter },
  { label: "Sales Activity", icon: Activity },
];

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const BASE_PATH = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const fmtRupiah = (n: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "Rp 0";
  const absV = Math.abs(v);
  const formatted = formatRupiahFull(absV).replace("Rp ", v < 0 ? "-Rp " : "Rp ");
  return formatted;
};
const FUNNEL_PHASES = ["F0","F1","F2","F3","F4","F5"];
const FUNNEL_PHASE_LABELS: Record<string,string> = { F0:"Lead",F1:"Prospect",F2:"Quote",F3:"Negosiasi",F4:"Closing",F5:"Won/Closed" };
const FUNNEL_PHASE_COLORS: Record<string,string> = { F0:"#93c5fd",F1:"#3b82f6",F2:"#818cf8",F3:"#6366f1",F4:"#8b5cf6",F5:"#10b981" };

function fmtNilaiCompact(n: number): string {
  if (!n && n !== 0) return "–";
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1e12) {
    formatted = `${(abs / 1e12).toFixed(1)}T`;
  } else if (abs >= 1e9) {
    formatted = `${(abs / 1e9).toFixed(1)}M`;
  } else if (abs >= 1e6) {
    formatted = `${Math.round(abs / 1e6)} jt`;
  } else {
    formatted = `Rp${abs.toLocaleString("id-ID")}`;
  }
  return n < 0 ? `-${formatted}` : formatted;
}
const MONTHS_LABEL = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const MONTHS_FULL  = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const TIPE_RANK = ["Ach CM","Ach YTD"];
const TIPE_REVENUE = ["Reguler","Sustain","Scaling","NGTMA"];

function periodeLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS_LABEL[parseInt(m) - 1]} ${y}`;
}
function shortSnap(createdAt: string, snapshotDate?: string | null) {
  const d = snapshotDate || createdAt;
  return format(new Date(d), "d MMM yyyy", { locale: idLocale });
}
function parseKomponen(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // Support both flat (single object) and grouped (array of objects) formats
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}
const KOMPONEN_TYPES = ["Reguler", "Sustain", "Scaling", "NGTMA"] as const;
function customerTotal(c: any): { target: number; real: number } {
  if (c.targetTotal != null || c.realTotal != null) return { target: c.targetTotal ?? 0, real: c.realTotal ?? 0 };
  return KOMPONEN_TYPES.reduce((acc, t) => ({
    target: acc.target + (c[t]?.target ?? 0),
    real: acc.real + (c[t]?.real ?? 0),
  }), { target: 0, real: 0 });
}
function sumKomponen(customers: any[], tipe: string): { target: number; real: number } {
  if (tipe === "Semua") return customers.reduce((acc, c) => {
    const tot = customerTotal(c);
    return { target: acc.target + tot.target, real: acc.real + tot.real };
  }, { target: 0, real: 0 });
  return { target: customers.reduce((s, c) => s + (c[tipe]?.target ?? 0), 0), real: customers.reduce((s, c) => s + (c[tipe]?.real ?? 0), 0) };
}
function hasTypedColumn(target: any, real: any): boolean {
  const t = target == null || target === "" ? null : Number(target);
  const r = real == null || real === "" ? null : Number(real);
  return (t != null && t > 0) || (r != null && r > 0);
}
function getTypedRevenue(row: any, tipe: string): { target: number; real: number } {
  const norm = (v: any) => (v == null || v === "" ? 0 : Number(v));
  if (tipe === "Semua") return { target: norm(row.targetRevenue), real: norm(row.realRevenue) };
  if (tipe === "Reguler" && hasTypedColumn(row.targetReguler, row.realReguler)) return { target: norm(row.targetReguler), real: norm(row.realReguler) };
  if (tipe === "Sustain" && hasTypedColumn(row.targetSustain, row.realSustain)) return { target: norm(row.targetSustain), real: norm(row.realSustain) };
  if (tipe === "Scaling" && hasTypedColumn(row.targetScaling, row.realScaling)) return { target: norm(row.targetScaling), real: norm(row.realScaling) };
  if (tipe === "NGTMA" && hasTypedColumn(row.targetNgtma, row.realNgtma)) return { target: norm(row.targetNgtma), real: norm(row.realNgtma) };
  return sumKomponen(parseKomponen(row.komponenDetail), tipe);
}

// ─── TrophyCard ────────────────────────────────────────────────────────────────
function TrophyCard({ title, subtitle, am, value, realValue, targetValue, colorScheme }: {
  title: string; subtitle: string; am: any; value: string;
  realValue?: string; targetValue?: string; colorScheme: "gold" | "blue";
}) {
  const scheme = colorScheme === "gold"
    ? {
        icon: "🥇",
        bg: "from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950/40 dark:via-yellow-950/25 dark:to-orange-950/40",
        border: "border-amber-300 dark:border-amber-700",
        strip: "bg-gradient-to-b from-amber-400 to-orange-400 dark:from-amber-500 dark:to-orange-500",
        accent: "text-amber-700 dark:text-amber-400",
        valueClr: "text-amber-600 dark:text-amber-400",
        badge: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700",
        statBg: "bg-amber-50/70 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800",
        statLabel: "text-amber-600 dark:text-amber-400",
      }
    : {
        icon: "🏅",
        bg: "from-blue-50 via-indigo-50 to-sky-50 dark:from-blue-950/40 dark:via-indigo-950/25 dark:to-sky-950/40",
        border: "border-blue-300 dark:border-blue-700",
        strip: "bg-gradient-to-b from-blue-400 to-indigo-500 dark:from-blue-500 dark:to-indigo-600",
        accent: "text-blue-700 dark:text-blue-400",
        valueClr: "text-blue-600 dark:text-blue-400",
        badge: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700",
        statBg: "bg-blue-50/70 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800",
        statLabel: "text-blue-600 dark:text-blue-400",
      };
  if (!am) return (
    <div className={`rounded-xl bg-gradient-to-br ${scheme.bg} border ${scheme.border} p-4 min-h-[100px] flex flex-col justify-center`}>
      <p className={cn("text-xs font-black uppercase tracking-widest mb-1", scheme.accent)}>{title}</p>
      <p className="text-muted-foreground/50 text-sm">Belum ada data</p>
    </div>
  );
  return (
    <div className={`rounded-xl bg-gradient-to-br ${scheme.bg} border ${scheme.border} min-w-0 flex overflow-hidden`}>
      {/* colored left accent strip */}
      <div className={`w-1.5 shrink-0 ${scheme.strip} rounded-l-xl`}/>
      <div className="flex-1 px-4 py-3.5 min-w-0">
        {/* header row */}
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <p className={cn("text-[13px] font-black uppercase tracking-wider leading-tight", scheme.accent)}>{title}</p>
            <span className={cn("inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wide", scheme.badge)}>
              {subtitle}
            </span>
          </div>
          <span className="text-3xl leading-none shrink-0 mt-0.5">{scheme.icon}</span>
        </div>
        {/* AM name */}
        <p className="font-black text-[15px] text-foreground uppercase tracking-wide truncate leading-tight mb-2" title={am.namaAm}>{am.namaAm}</p>
        {/* big percentage */}
        <p className={cn("text-5xl font-black tabular-nums leading-none mb-3", scheme.valueClr)}>{value}</p>
        {/* REAL / TARGET */}
        <div className="grid grid-cols-2 gap-2">
          <div className={cn("rounded-lg px-3 py-2 border", scheme.statBg)}>
            <p className={cn("text-[9px] font-black uppercase tracking-widest mb-0.5", scheme.statLabel)}>Real</p>
            <p className="text-[13px] font-black text-foreground truncate">{realValue ?? "—"}</p>
          </div>
          <div className={cn("rounded-lg px-3 py-2 border", scheme.statBg)}>
            <p className={cn("text-[9px] font-black uppercase tracking-widest mb-0.5", scheme.statLabel)}>Target</p>
            <p className="text-[13px] font-black text-foreground truncate">{targetValue ?? "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Performance Table Shared ColGroup (ensures header + body columns align) ───
// widths sum to 800px; both tables use table-layout:fixed so these are respected exactly
function PerfColGroup({showCm=true,showYtd=true}:{showCm?:boolean;showYtd?:boolean}) {
  return (
    <colgroup>
      <col style={{width:"28px"}}/>
      <col style={{width:"200px"}}/>
      <col style={{width:"68px"}}/>
      <col style={{width:"170px"}}/>
      <col style={{width:"170px"}}/>
      {showCm && <col style={{width:"78px"}}/>}
      {showYtd && <col style={{width:"78px"}}/>}
      <col style={{width:"78px"}}/>
    </colgroup>
  );
}

// ─── Custom Tooltip for Trend Chart ────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const monthFull = payload[0]?.payload?.monthFull as string | undefined;
  const divisiLabel = payload[0]?.payload?.divisiLabel as string | undefined;
  const titleMonth = monthFull ?? label;
  const titlePrefix = divisiLabel ? `Revenue ${divisiLabel} – ` : "Revenue – ";
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-lg text-xs space-y-1.5 min-w-[210px]">
      <p className="font-bold text-foreground mb-1 leading-snug">{titlePrefix}{titleMonth}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold tabular-nums">{p.dataKey === "ach" ? `${p.value}%` : formatRupiah(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── CheckboxDropdown ──────────────────────────────────────────────────────────
function CheckboxDropdown({ label, options, selected, onChange, placeholder, labelFn, headerLabel, summaryLabel, className }: {
  label: string; options: string[]; selected: Set<string>; onChange: (next: Set<string>) => void;
  placeholder?: string; labelFn?: (v: string) => string; headerLabel?: string; summaryLabel?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);
  const lFn = labelFn ?? ((v: string) => v);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const toggle = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(v => !v);
  };
  const displayLabel = selected.size === 0
    ? (placeholder || `Pilih ${label}`)
    : selected.size === options.length
      ? `Semua ${summaryLabel || label}`
      : selected.size === 1 ? lFn([...selected][0]) : `${selected.size} ${summaryLabel || label} dipilih`;
  return (
    <div className={cn("flex flex-col gap-1", className)} ref={triggerRef}>
      <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">{label}</label>
      <button
        onClick={toggle}
        className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 focus:ring-2 focus:ring-primary/20 focus:border-primary w-full whitespace-nowrap"
      >
        <span className="flex-1 text-left truncate font-medium text-foreground">{displayLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-popover border border-border rounded-xl shadow-lg min-w-[180px] max-h-72 overflow-y-auto p-1.5"
        >
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border mb-1">
            <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">{headerLabel || label}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => onChange(new Set(options))} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary font-semibold transition-colors">Semua</button>
              <button onClick={() => onChange(new Set())} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-secondary/80 text-muted-foreground font-semibold transition-colors">Kosongkan</button>
            </div>
          </div>
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary cursor-pointer text-xs">
              <input type="checkbox" className="rounded" checked={selected.has(opt)} onChange={() => {
                const next = new Set(selected);
                if (next.has(opt)) next.delete(opt); else next.add(opt);
                onChange(next);
              }} />
              {lFn(opt)}
            </label>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── SelectDropdown (single-select, matches CheckboxDropdown style) ─────────────
function SelectDropdown({ label, value, onChange, options, className, disabled }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const toggle = () => {
    if (!disabled) {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left });
      }
      setOpen(v => !v);
    }
  };
  const current = options.find(o => o.value === value);
  return (
    <div className={cn("flex flex-col gap-1", className)} ref={triggerRef}>
      {label && <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">{label}</label>}
      <button
        onClick={toggle}
        disabled={disabled}
        className={cn(
          "h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors",
          open && "border-primary/50 bg-secondary/70"
        )}
      >
        <span className="flex-1 text-left truncate font-medium text-foreground">{current?.label ?? value}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-popover border border-border rounded-xl shadow-lg min-w-[140px] max-h-60 overflow-y-auto py-1"
        >
          {options.map(opt => (
            <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn("w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2", opt.value === value && "font-semibold text-primary")}>
              <span className="w-3.5 shrink-0">{opt.value === value ? <Check className="w-3 h-3" /> : null}</span>
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Funnel Slide (full mirror of FunnelPage) ────────────────────────────────────

const FS_PHASES = ["F0","F1","F2","F3","F4","F5"];
const FS_PHASE_LABELS: Record<string,string> = { F0:"Lead",F1:"Prospect",F2:"Quote",F3:"Negosiasi",F4:"Closing",F5:"Won/Closed" };
const FS_PHASE_COLORS: Record<string,{ pill:string; bar:string; text:string }> = {
  F0:{pill:"bg-sky-100 text-sky-800",bar:"#38bdf8",text:"#0369a1"},
  F1:{pill:"bg-blue-100 text-blue-800",bar:"#3b82f6",text:"#1d4ed8"},
  F2:{pill:"bg-indigo-100 text-indigo-800",bar:"#6366f1",text:"#4338ca"},
  F3:{pill:"bg-violet-100 text-violet-800",bar:"#7c3aed",text:"#5b21b6"},
  F4:{pill:"bg-orange-100 text-orange-800",bar:"#f97316",text:"#c2410c"},
  F5:{pill:"bg-emerald-100 text-emerald-800",bar:"#10b981",text:"#065f46"},
};
const FS_MONTHS_ID = ["","Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];

function fmtRupiahFS(n: number): string {
  if (!n && n !== 0) return "–";
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1e12) {
    formatted = `${(abs / 1e12).toFixed(2)}T`;
  } else if (abs >= 1e9) {
    formatted = `${(abs / 1e9).toFixed(2)}M`;
  } else if (abs >= 1e6) {
    formatted = `${Math.round(abs / 1e6)} jt`;
  } else {
    formatted = abs.toLocaleString("id-ID");
  }
  return n < 0 ? `-Rp ${formatted}` : `Rp ${formatted}`;
}
function fmtCompactFS(n: number): string {
  if (!n) return "–";
  if (n>=1e12) return `${(n/1e12).toFixed(1)}T`;
  if (n>=1e9)  return `${(n/1e9).toFixed(1)}M`;
  if (n>=1e6)  return `${Math.round(n/1e6)} jt`;
  return String(n);
}
function periodLabelFS(p: string | null | undefined): string {
  if (!p) return "";
  if (/^\d{8}$/.test(p)) return `${FS_MONTHS_ID[parseInt(p.slice(4,6))]||p.slice(4,6)} ${p.slice(0,4)}`;
  if (/^\d{6}$/.test(p)) return `${FS_MONTHS_ID[parseInt(p.slice(4,6))]||p.slice(4,6)} ${p.slice(0,4)}`;
  const [y, m2] = p.split("-");
  return `${FS_MONTHS_ID[parseInt(m2)]||m2} ${y}`;
}

function FSSelectDropdown({ label, value, onChange, options, disabled, className }: {
  label?:string; value:string; onChange:(v:string)=>void;
  options:{value:string;label:string}[]; disabled?:boolean; className?:string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top:0, left:0, minW:0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{
      if(triggerRef.current&&!triggerRef.current.contains(e.target as Node)&&
         dropRef.current&&!dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);
  const toggle=()=>{
    if(disabled) return;
    if(triggerRef.current){const r=triggerRef.current.getBoundingClientRect();setPos({top:r.bottom+4,left:r.left,minW:r.width});}
    setOpen(o=>!o);
  };
  const current = options.find(o=>o.value===value);
  return (
    <div className={cn("flex flex-col gap-1",className)} ref={triggerRef}>
      {label&&<label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">{label}</label>}
      <button type="button" onClick={toggle} disabled={disabled}
        className={cn("h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left",open&&"border-primary/50 ring-2 ring-primary/20")}>
        <span className="flex-1 truncate font-medium text-foreground">{current?.label??value}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",open&&"rotate-180")}/>
      </button>
      {open&&createPortal(
        <div ref={dropRef} style={{position:"fixed",top:pos.top,left:pos.left,minWidth:pos.minW,zIndex:9999}}
          className="bg-card border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto py-1">
          {options.map(opt=>(
            <button key={opt.value} onClick={()=>{onChange(opt.value);setOpen(false);}}
              className={cn("w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2",
                opt.value===value?"font-semibold text-primary bg-primary/5":"text-foreground")}>
              {opt.value===value&&<span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"/>}
              {opt.value!==value&&<span className="w-1.5 shrink-0"/>}
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function FSCheckboxDropdown({ label, options, selected, onChange, placeholder, labelFn, summaryLabel, className }: {
  label:string; options:string[]; selected:Set<string>; onChange:(n:Set<string>)=>void;
  placeholder?:string; labelFn?:(v:string)=>string; summaryLabel?:string; className?:string;
}) {
  const [open,setOpen] = useState(false);
  const [pos,setPos] = useState({top:0,left:0});
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const getLabel=(v:string)=>labelFn?labelFn(v):v;
  useEffect(()=>{
    const h=(e:MouseEvent)=>{
      if(triggerRef.current&&!triggerRef.current.contains(e.target as Node)&&
         dropRef.current&&!dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);
  const toggleItem=(item:string)=>{const n=new Set(selected);if(n.has(item))n.delete(item);else n.add(item);onChange(n);};
  const toggleOpen=()=>{
    if(triggerRef.current){
      const r=triggerRef.current.getBoundingClientRect();
      const dropH=Math.min(options.length*40+72,256);
      const spaceBelow=window.innerHeight-r.bottom;
      const top=spaceBelow>=dropH?r.bottom+4:Math.max(4,r.top-dropH-4);
      setPos({top,left:r.left});
    }
    setOpen(o=>!o);
  };
  const unit=summaryLabel??"item";
  const displayText=selected.size===0?(placeholder??"Semua")
    :selected.size===options.length?`Semua ${unit}`
    :selected.size===1?getLabel([...selected][0])
    :`${selected.size} ${unit} dipilih`;
  return (
    <div className={cn("flex flex-col gap-1",className)} ref={triggerRef}>
      <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">{label}</label>
      <button type="button" onClick={toggleOpen} disabled={options.length===0}
        className={cn("h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left",open&&"border-primary/50 ring-2 ring-primary/20")}>
        <span className="flex-1 truncate font-medium text-foreground">{displayText}</span>
        {selected.size>0&&selected.size<options.length&&(
          <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">{selected.size}</span>
        )}
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",open&&"rotate-180")}/>
      </button>
      {open&&createPortal(
        <div ref={dropRef} style={{position:"fixed",top:pos.top,left:pos.left,zIndex:9999}}
          className="bg-card border border-border rounded-xl shadow-xl min-w-[200px] max-w-[260px] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
            <div className="flex gap-1.5">
              <button onClick={()=>onChange(new Set(options))} className="text-[11px] text-primary font-semibold hover:underline">Semua</button>
              <span className="text-muted-foreground text-[11px]">·</span>
              <button onClick={()=>onChange(new Set())} className="text-[11px] text-muted-foreground font-semibold hover:underline">Kosongkan</button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(opt=>(
              <button key={opt} onClick={()=>toggleItem(opt)}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center gap-2 transition-colors",
                  selected.has(opt)?"font-semibold text-primary bg-primary/5":"text-foreground")}>
                <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",selected.has(opt)?"bg-primary border-primary":"border-border")}>
                  {selected.has(opt)&&<span className="text-white text-[8px] font-black">✓</span>}
                </span>
                {getLabel(opt)}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const FS_MONTH_NUMS = ["01","02","03","04","05","06","07","08","09","10","11","12"];

function FSPeriodeTreeDropdown({ label, filterYears, filterMonths, availableYears, availableMonthsByYear, onChange, className }: {
  label?: string;
  filterYears: Set<string>;
  filterMonths: Set<string>;
  availableYears: string[];
  availableMonthsByYear?: Record<string, Set<string>> | null;
  onChange: (years: Set<string>, months: Set<string>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const primaryYear = [...filterYears].sort().reverse()[0] || "";
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set([primaryYear]));
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const h=(e:MouseEvent)=>{
      if(
        triggerRef.current&&!triggerRef.current.contains(e.target as Node)&&
        dropRef.current&&!dropRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);

  useEffect(()=>{
    const primary=[...filterYears].sort().reverse()[0];
    if(primary) setExpandedYears(prev=>new Set([...prev,primary]));
  },[filterYears]);

  const years = availableYears.length > 0 ? availableYears : [...filterYears].sort().reverse();

  const toggle = () => {
    if(triggerRef.current){
      const r=triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom+4, left: r.left });
    }
    setOpen(o=>!o);
  };

  const toggleExpand = (yr:string, e:React.MouseEvent) => {
    e.stopPropagation();
    setExpandedYears(prev=>{ const n=new Set(prev); n.has(yr)?n.delete(yr):n.add(yr); return n; });
  };

  const toggleYear = (yr:string) => {
    const n=new Set(filterYears);
    if(n.has(yr)){ if(n.size>1) n.delete(yr); }
    else n.add(yr);
    onChange(n, filterMonths);
  };

  const toggleMonth = (mo:string) => {
    const n=new Set(filterMonths); n.has(mo)?n.delete(mo):n.add(mo);
    onChange(filterYears, n);
  };

  const sortedSelected = [...filterYears].sort().reverse();
  const displayText = filterYears.size===0
    ? "Semua Periode"
    : filterYears.size===1
      ? (filterMonths.size===0
          ? `${primaryYear} (semua bulan)`
          : filterMonths.size===1
            ? `${FS_MONTHS_ID[parseInt([...filterMonths][0])]||[...filterMonths][0]} ${primaryYear}`
            : `${primaryYear} · ${filterMonths.size} bulan`)
      : filterYears.size===2
        ? `${sortedSelected.join("+")}${filterMonths.size>0?` · ${filterMonths.size} bln`:" (semua)"}`
        : `${filterYears.size} tahun${filterMonths.size>0?` · ${filterMonths.size} bln`:" (semua)"}`;

  const badgeCount = filterYears.size > 1 && filterMonths.size > 0
    ? `${filterYears.size}yr·${filterMonths.size}mo`
    : filterYears.size > 1 ? `${filterYears.size}yr` : filterMonths.size > 0 ? String(filterMonths.size) : null;

  return (
    <div className={cn("flex flex-col gap-1",className)} ref={triggerRef}>
      {label&&<label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">{label}</label>}
      <button type="button" onClick={toggle}
        className={cn("h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full transition-colors text-left",open&&"border-primary/50 ring-2 ring-primary/20")}>
        <span className="flex-1 truncate font-medium text-foreground">{displayText}</span>
        {badgeCount&&(
          <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">{badgeCount}</span>
        )}
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",open&&"rotate-180")}/>
      </button>
      {open&&createPortal(
        <div ref={dropRef} style={{ position:"fixed", top:pos.top, left:pos.left, zIndex:9999 }}
          className="bg-card border border-border rounded-xl shadow-xl w-56 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Periode</span>
            <button onClick={()=>onChange(new Set([years[0]||primaryYear]),new Set())} className="text-[11px] text-primary font-semibold hover:underline">Reset</button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {years.map(yr=>{
              const isSelected=filterYears.has(yr);
              const exp=expandedYears.has(yr);
              return (
                <div key={yr}>
                  <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-secondary/40 transition-colors">
                    <button type="button" onClick={e=>toggleExpand(yr,e)}
                      className="p-0.5 text-muted-foreground hover:text-foreground shrink-0">
                      <ChevronRight className={cn("w-3 h-3 transition-transform",exp&&"rotate-90")}/>
                    </button>
                    <label className="flex items-center gap-2 flex-1 cursor-pointer select-none">
                      <input type="checkbox" checked={isSelected}
                        onChange={()=>toggleYear(yr)}
                        className="w-3.5 h-3.5 accent-primary cursor-pointer"/>
                      <span className={cn("text-sm font-semibold",isSelected?"text-primary":"text-foreground")}>{yr}</span>
                    </label>
                  </div>
                  {exp&&(
                    <div className="ml-6 pb-1">
                      {FS_MONTH_NUMS.map((mo,idx)=>{
                        const availMonths = availableMonthsByYear?.[yr];
                        if (availMonths && !availMonths.has(mo)) return null;
                        const checked=filterMonths.has(mo);
                        return (
                          <label key={mo} className="flex items-center gap-2 px-2 py-1 hover:bg-secondary/30 cursor-pointer rounded select-none">
                            <input type="checkbox" checked={checked} onChange={()=>toggleMonth(mo)}
                              className="w-3.5 h-3.5 accent-primary cursor-pointer"/>
                            <span className={cn("text-sm",checked?"text-foreground font-medium":"text-muted-foreground")}>
                              {FS_MONTHS_ID[idx+1]}
                            </span>
                          </label>
                        );
                      })}
                      {availableMonthsByYear?.[yr] && availableMonthsByYear[yr].size === 0 && (
                        <p className="px-2 py-1 text-xs text-muted-foreground italic">Tidak ada data</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function FSGauge({ pct, targetHo, targetFullHo, real, mode, compact, divisi }: { pct:number; targetHo:number; targetFullHo:number; real:number; mode:"ho"|"fullho"; compact?:boolean; divisi?:"DPS"|"DSS" }) {
  const clamp=Math.min(Math.max(pct,0),100); // hanya untuk arc visual
  const displayPct=Math.max(pct,0); // nilai tampil bisa >100
  const r=54,cx=80,cy=70;
  const startAngle=-210,endAngle=30,totalDeg=endAngle-startAngle;
  const fillDeg=(clamp/100)*totalDeg;
  const toRad=(d:number)=>(d*Math.PI)/180;
  const arc=(start:number,end:number,radius:number)=>{
    const s=toRad(start),e=toRad(end);
    const x1=cx+radius*Math.cos(s),y1=cy+radius*Math.sin(s);
    const x2=cx+radius*Math.cos(e),y2=cy+radius*Math.sin(e);
    const large=end-start>180?1:0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };
  const dynamicColor=clamp>=100?"#10b981":clamp>=75?"#3b82f6":clamp>=50?"#f59e0b":"#CC0000";
  const color=divisi==="DPS"?"#3b82f6":divisi==="DSS"?"#10b981":dynamicColor;
  const surplusTextCls=divisi==="DPS"?"text-blue-600 dark:text-blue-400":divisi==="DSS"?"text-emerald-600 dark:text-emerald-400":"text-emerald-600 dark:text-emerald-400";
  const deficitTextCls="text-red-600 dark:text-red-400";
  const activeTarget=mode==="ho"?targetHo:targetFullHo;
  const hasTarget=activeTarget>0;
  const startX=cx+r*Math.cos(toRad(startAngle));
  const startY=cy+r*Math.sin(toRad(startAngle));
  const endX=cx+r*Math.cos(toRad(endAngle));
  const endY=cy+r*Math.sin(toRad(endAngle));
  if (compact) return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="130" height="95" viewBox="0 0 160 115">
        <path d={arc(startAngle,endAngle,r)} fill="none" stroke="#e5e7eb" strokeWidth="18" strokeLinecap="round"/>
        {hasTarget&&clamp>0&&<path d={arc(startAngle,startAngle+fillDeg,r)} fill="none" stroke={color} strokeWidth="18" strokeLinecap="round"/>}
        {hasTarget?(
          <>
            <text x={cx} y={cy-4} textAnchor="middle" fontSize="22" fontWeight="800" fill={color} fontFamily="ui-monospace,monospace">{typeof displayPct === "number" && !isNaN(displayPct) ? displayPct.toFixed(1) : "0"}%</text>
            <text x={cx} y={cy+12} textAnchor="middle" fontSize="9" fill="#6b7280">CAPAIAN</text>
          </>
        ):(
          <>
            <text x={cx} y={cy-4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#6b7280">Target</text>
            <text x={cx} y={cy+10} textAnchor="middle" fontSize="10" fill="#9ca3af">belum diset</text>
          </>
        )}
        <text x={startX} y={startY+13} textAnchor="middle" fontSize="8" fill="#9ca3af">0%</text>
        <text x={endX} y={endY+13} textAnchor="middle" fontSize="8" fill="#9ca3af">100%</text>
      </svg>
      {hasTarget&&(
        <div className="w-full space-y-0.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Real</span><span className="font-black tabular-nums" style={{color}}>{fmtRupiahFS(real)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{mode==="ho"?"Target HO":"FULL (HO+BA)"}</span><span className="tabular-nums text-foreground">{fmtRupiahFS(activeTarget)}</span></div>
          <div className="flex justify-between pt-0.5 border-t border-border">
            <span className={cn("font-bold",real>=activeTarget?"text-emerald-600":"text-foreground")}>{real>=activeTarget?"Lebih":"Kurang"}</span>
            <span className={cn("font-black tabular-nums",real>=activeTarget?"text-emerald-600":"text-foreground")}>{real>=activeTarget?"+":"-"}{fmtRupiahFS(Math.abs(activeTarget-real))}</span>
          </div>
        </div>
      )}
    </div>
  );
  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      <div className="shrink-0 mx-auto">
        <svg width="150" height="108" viewBox="0 0 160 115">
          <path d={arc(startAngle,endAngle,r)} fill="none" stroke="#e5e7eb" strokeWidth="18" strokeLinecap="round"/>
          {hasTarget&&clamp>0&&<path d={arc(startAngle,startAngle+fillDeg,r)} fill="none" stroke={color} strokeWidth="18" strokeLinecap="round"/>}
          {hasTarget?(
            <>
              <text x={cx} y={cy-4} textAnchor="middle" fontSize="22" fontWeight="800" fill={color} fontFamily="ui-monospace,monospace">{typeof displayPct === "number" && !isNaN(displayPct) ? displayPct.toFixed(1) : "0"}%</text>
              <text x={cx} y={cy+12} textAnchor="middle" fontSize="9" fill="#6b7280">CAPAIAN</text>
            </>
          ):(
            <>
              <text x={cx} y={cy-4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#6b7280">Target</text>
              <text x={cx} y={cy+10} textAnchor="middle" fontSize="10" fill="#9ca3af">belum diset</text>
            </>
          )}
          <text x={startX} y={startY+13} textAnchor="middle" fontSize="8" fill="#9ca3af">0%</text>
          <text x={endX} y={endY+13} textAnchor="middle" fontSize="8" fill="#9ca3af">100%</text>
        </svg>
      </div>
      <div className="flex-1 w-full min-w-0 overflow-hidden space-y-1.5" style={{fontSize:"clamp(9px,1.05vw,12px)"}}>
        <div className="flex justify-between items-baseline gap-1">
          <span className="text-muted-foreground whitespace-nowrap shrink-0">Real Pipeline</span>
          <span className="font-bold text-foreground tabular-nums truncate text-right ml-1">{fmtRupiahFS(real)}</span>
        </div>
        {hasTarget&&(
          <>
            <div className="flex justify-between items-baseline gap-1">
              <span className="text-muted-foreground whitespace-nowrap shrink-0">{mode==="ho"?"Target HO":"Target FULL (HO+BA)"}</span>
              <span className="tabular-nums text-foreground truncate text-right ml-1">{fmtRupiahFS(activeTarget)}</span>
            </div>
            <div className="pt-1.5 border-t border-border flex justify-between items-baseline gap-1">
              <span className={cn("font-bold whitespace-nowrap shrink-0",real>=activeTarget?surplusTextCls:deficitTextCls)}>
                {real>=activeTarget?"Kelebihan":"Kekurangan"}
              </span>
              <span className={cn("font-bold tabular-nums truncate text-right ml-1",real>=activeTarget?surplusTextCls:deficitTextCls)}>
                {real>=activeTarget?"+":"-"}{fmtRupiahFS(Math.abs(activeTarget-real))}
              </span>
            </div>
          </>
        )}
        {!hasTarget&&(
          <p className="text-muted-foreground">Target belum diset — import di menu Import Data</p>
        )}
      </div>
    </div>
  );
}

function kategoriColor(k: string): string {
  const kl = k.toLowerCase();
  if(kl.includes("new gtma")) return "bg-blue-100 border border-blue-300 text-blue-800";
  if(kl.includes("gtma")) return "bg-cyan-100 border border-cyan-300 text-cyan-800";
  if(kl.includes("own channel")||kl.includes("own ch")) return "bg-violet-100 border border-violet-300 text-violet-800";
  if(kl.includes("uncategorized")||kl.includes("uncat")) return "bg-slate-100 border border-slate-300 text-slate-600";
  if(kl.includes("new")) return "bg-emerald-100 border border-emerald-300 text-emerald-800";
  return "bg-amber-100 border border-amber-300 text-amber-800";
}

function FSFaseBarChart({ data, compact }: { data:any; compact?: boolean }) {
  if(!data) return null;
  const phaseMap: Record<string,{count:number;nilai:number}> = {};
  for(const p of FS_PHASES) phaseMap[p]={count:0,nilai:0};
  for(const s of (data.byStatus||[])) { if(phaseMap[s.status]){phaseMap[s.status].count=s.count;phaseMap[s.status].nilai=s.totalNilai;} }
  const maxCount=Math.max(...FS_PHASES.map(p=>phaseMap[p].count),1);
  return (
    <div className={compact?"space-y-1":"space-y-2"}>
      {FS_PHASES.map(phase=>{
        const d=phaseMap[phase]; const pct=(d.count/maxCount)*100; const c=FS_PHASE_COLORS[phase];
        const tooltip=`${phase}: ${d.count} proyek · ${fmtCompactFS(d.nilai)}`;
        return (
          <div key={phase} className="flex items-center gap-2 group" title={tooltip}>
            <div className={compact?"w-5 shrink-0":"w-7 shrink-0"}>
              <span className={compact?"text-[10px] font-black":"text-sm font-black"} style={{color:c.text,fontFamily:"Inter,sans-serif"}}>{phase}</span>
            </div>
            <div className={`flex-1 bg-secondary rounded overflow-hidden relative ${compact?"h-4":"h-5"}`}>
              <div className="h-full rounded transition-all duration-500" style={{width:`${Math.max(pct,2)}%`,backgroundColor:c.bar}}/>
              <div className="absolute inset-0 flex items-center pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] font-black text-white drop-shadow-sm whitespace-nowrap">{d.count} proyek · {fmtCompactFS(d.nilai)}</span>
              </div>
            </div>
            <span className={compact?"text-[10px] font-black w-14 shrink-0 text-right":"text-sm font-black w-16 shrink-0 text-right"} style={{color:c.text,fontFamily:"Inter,sans-serif"}}>
              {d.count} <span className="font-semibold text-muted-foreground text-[10px]">LOP</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FSMiniSparkline({ color, fill }: { color: string; fill: string }) {
  const pts = [28,22,30,18,26,14,20,8,16,4];
  const w=88,h=38,pad=2;
  const xs=pts.map((_,i)=>pad+(i/(pts.length-1))*(w-pad*2));
  const ys=pts.map(v=>pad+(v/32)*(h-pad*2));
  const line=xs.map((x,i)=>`${i===0?"M":"L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area=`${line} L${xs[xs.length-1].toFixed(1)},${(h-pad).toFixed(1)} L${xs[0].toFixed(1)},${(h-pad).toFixed(1)} Z`;
  const gid=`fsg-${color.replace(/[^a-z]/g,"")}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.45"/>
          <stop offset="100%" stopColor={fill} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`}/>
      <path d={line} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

type CRDivisiStat = { f5: number; denom: number; cr: number | null };
function FSKpiGrid({ data }: { data:any }) {
  if(!data) return null;
  const kpis = [
    {label:"Total LOP",value:data.totalLop?.toLocaleString("id-ID"),sub:(data.unidentifiedLops||0)>0?`${data.unidentifiedLops} tdk teridentifikasi`:"proyek aktif",color:"text-foreground",spark:{color:"#10b981",fill:"#10b981"}},
    {label:"Total Nilai Pipeline",value:fmtCompactFS(data.totalNilai),sub:"nilai seluruh LOP",color:"text-blue-600",spark:{color:"#3b82f6",fill:"#3b82f6"}},
    {label:"Aktif AM",value:data.amCount != null ? String(data.amCount) : "-",sub:"account manager teridentifikasi",color:"text-violet-600",spark:{color:"#8b5cf6",fill:"#8b5cf6"}},
    {label:"Jumlah Pelanggan",value:data.pelangganCount?.toLocaleString("id-ID"),sub:"unique customer",color:"text-amber-600",spark:{color:"#f59e0b",fill:"#f59e0b"}},
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {kpis.map(k=>(
        <div key={k.label} className="bg-secondary/50 border border-border rounded-xl p-4 flex items-center gap-3 overflow-hidden">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">{k.label}</div>
            <div className={cn("text-3xl font-black tabular-nums leading-tight tracking-tight",k.color)}>{k.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{k.sub}</div>
          </div>
          <div className="shrink-0 opacity-90">
            <FSMiniSparkline color={k.spark.color} fill={k.spark.fill}/>
          </div>
        </div>
      ))}
    </div>
  );
}

function FSCRGauge({ f5, denom, cr, divisi }: { f5:number; denom:number; cr:number|null; divisi:"DPS"|"DSS" }) {
  const pct = cr !== null ? cr * 100 : 0;
  const clamp = Math.min(Math.max(pct, 0), 100);
  const r=54,cx=80,cy=70;
  const startAngle=-210,endAngle=30,totalDeg=endAngle-startAngle;
  const fillDeg=(clamp/100)*totalDeg;
  const thresholdDeg=(70/100)*totalDeg;
  const toRad=(d:number)=>(d*Math.PI)/180;
  const arc=(start:number,end:number,radius:number)=>{
    const s=toRad(start),e=toRad(end);
    const x1=cx+radius*Math.cos(s),y1=cy+radius*Math.sin(s);
    const x2=cx+radius*Math.cos(e),y2=cy+radius*Math.sin(e);
    const large=end-start>180?1:0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };
  const isGood = cr !== null && cr >= 0.7;
  const color = cr===null ? "#9ca3af" : isGood ? "#10b981" : "#CC0000";
  const startX=cx+r*Math.cos(toRad(startAngle));
  const startY=cy+r*Math.sin(toRad(startAngle));
  const endX=cx+r*Math.cos(toRad(endAngle));
  const endY=cy+r*Math.sin(toRad(endAngle));
  const thAngle=startAngle+thresholdDeg;
  const thInnerX=cx+(r-14)*Math.cos(toRad(thAngle));
  const thInnerY=cy+(r-14)*Math.sin(toRad(thAngle));
  const thOuterX=cx+(r+5)*Math.cos(toRad(thAngle));
  const thOuterY=cy+(r+5)*Math.sin(toRad(thAngle));
  const divColor = divisi==="DPS" ? "#3b82f6" : "#10b981";
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">
        <svg width="145" height="105" viewBox="0 0 160 115">
          <path d={arc(startAngle,endAngle,r)} fill="none" stroke="#e5e7eb" strokeWidth="18" strokeLinecap="round"/>
          {cr!==null&&clamp>0&&<path d={arc(startAngle,startAngle+fillDeg,r)} fill="none" stroke={color} strokeWidth="18" strokeLinecap="round"/>}
          <line x1={thInnerX} y1={thInnerY} x2={thOuterX} y2={thOuterY} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"/>
          {cr!==null?(
            <>
              <text x={cx} y={cy-4} textAnchor="middle" fontSize="22" fontWeight="800" fill={color} fontFamily="ui-monospace,monospace">{typeof cr === "number" && !isNaN(cr) ? (cr*100).toFixed(1) : "0"}%</text>
              <text x={cx} y={cy+11} textAnchor="middle" fontSize="8.5" fill="#6b7280">CONV. RATE</text>
            </>
          ):(
            <text x={cx} y={cy+3} textAnchor="middle" fontSize="10" fill="#9ca3af">No data</text>
          )}
          <text x={startX} y={startY+13} textAnchor="middle" fontSize="8" fill="#9ca3af">0%</text>
          <text x={endX} y={endY+13} textAnchor="middle" fontSize="8" fill="#9ca3af">100%</text>
          <text x={cx+(r+9)*Math.cos(toRad(thAngle))} y={cy+(r+9)*Math.sin(toRad(thAngle))-8} textAnchor="middle" fontSize="7" fill="#f59e0b" fontWeight="700">70%</text>
        </svg>
      </div>
      <div className="flex-1 min-w-0 space-y-1" style={{fontSize:"clamp(9px,1.05vw,12px)"}}>
        <div className="flex justify-between items-baseline gap-1">
          <span className="text-muted-foreground whitespace-nowrap shrink-0">F5 (Closed Won)</span>
          <span className="font-bold tabular-nums truncate text-right ml-1" style={{color:divColor}}>{fmtRupiahFS(f5)}</span>
        </div>
        <div className="flex justify-between items-baseline gap-1">
          <span className="text-muted-foreground whitespace-nowrap shrink-0">F3 + F4 + F5</span>
          <span className="tabular-nums text-foreground">{fmtRupiahFS(denom)}</span>
        </div>
        <div className="flex justify-between items-baseline gap-1 pt-0.5 border-t border-border">
          <span className="text-muted-foreground whitespace-nowrap shrink-0">Threshold</span>
          <span className="font-bold text-amber-500">≥ 70%</span>
        </div>
        <div className="flex justify-between items-baseline gap-1">
          <span className={cn("font-bold whitespace-nowrap shrink-0",isGood?"text-emerald-600":"text-red-600")}>{isGood?"Tercapai":"Belum Tercapai"}</span>
          <span className={cn("font-black tabular-nums",isGood?"text-emerald-600":"text-red-600")}>{cr!==null?`${typeof cr==="number"&&!isNaN(cr)?(cr*100).toFixed(1):0}%`:"—0"}</span>
        </div>
      </div>
    </div>
  );
}

function FunnelSlide({ onTitleChange }: { onTitleChange?: (t: string) => void }) {
  // Default: All years (empty Set) — sesuai PIVOT F MyTENS yg "Years (report_date) All"
  const [filterYears,setFilterYears] = useState<Set<string>>(new Set());
  const [filterMonths,setFilterMonths] = useState<Set<string>>(new Set());
  const filterYear = useMemo(()=>[...filterYears].sort().reverse()[0]||"2026",[filterYears]);
  const [importId,setImportId] = useState<number|null>(null);
  const [filterMode,setFilterMode] = useState<"ho"|"fullho">("fullho");
  const [filterStatus,setFilterStatus] = useState<Set<string>>(new Set());
  // Default: GTMA & Own Channel saja — sesuai filter PIVOT F Excel MyTENS
  const [filterKontrak,setFilterKontrak] = useState<Set<string>>(new Set(["GTMA","Own Channel"]));
  const [filterDurasi,setFilterDurasi] = useState<"all"|"single_year"|"multi_year">("all");
  const [filterTahunAnggaran,setFilterTahunAnggaran] = useState<Set<string>>(new Set());
  const [filterAm,setFilterAm] = useState<Set<string>>(new Set());
  const [search,setSearch] = useState("");
  const [expandedAm,setExpandedAm] = useState<Record<string,boolean>>({});
  const [expandedPhase,setExpandedPhase] = useState<Record<string,boolean>>({});
  const [allExpanded,setAllExpanded] = useState(false);
  const [targetHoOverride,setTargetHoOverride] = useState("");
  const funnelSearchRef = useRef<HTMLInputElement>(null);
  const funnelTableRef = useRef<HTMLDivElement>(null);
  const [targetFullHoOverride,setTargetFullHoOverride] = useState("");

  const { data: snapshots = [] } = useQuery<any[]>({
    queryKey:["funnel-snapshots-pres"],
    queryFn:async()=>{const r=await fetch(`${BASE_PATH}/api/public/funnel/snapshots`);if(!r.ok)return[];return r.json();},
    staleTime:60_000,
  });

  // yearOptions: from import snapshot periods (must be before useEffect that uses it)
  const yearOptions = useMemo(()=>{
    const snapsArr = Array.isArray(snapshots) ? snapshots : [];
    const years=[...new Set(snapsArr.map((s:any)=>s.period.slice(0,4)))].sort().reverse() as string[];
    if(years.length===0) return [{value:"2026",label:"2026"}];
    return years.map(y=>({value:y,label:y}));
  },[snapshots]);

  const snapshotOptions = useMemo(()=>
    (Array.isArray(snapshots) ? snapshots : []).filter((s:any)=>{
      if(!s.period.startsWith(filterYear)) return false;
      if(filterMonths.size>0&&!filterMonths.has(s.period.slice(5,7))) return false;
      return true;
    }).map((s:any)=>({value:String(s.id),label:s.snapshotDate?format(new Date(s.snapshotDate),"d MMM yyyy",{locale:idLocale})+` — ${periodLabelFS(s.period)}`:`${periodLabelFS(s.period)} (${s.rowsImported?.toLocaleString()} LOP)`}))

  ,[snapshots,filterYear,filterMonths]);

  // Default: filterYears empty = ALL tahun (sesuai PIVOT F Excel default ALL)
  useEffect(()=>{ if(snapshotOptions.length>0 && importId===null) setImportId(Number(snapshotOptions[0].value)); },[snapshotOptions, importId]);
  const funnelParams = useMemo(()=>{
    const p=new URLSearchParams();
    if(importId) p.set("import_id",String(importId));
    if(filterTahunAnggaran.size > 0){
      // TA filter aktif → fetch API berdasarkan Tahun Anggaran
      const taYears=[...filterTahunAnggaran].sort().reverse();
      if(taYears.length===1) p.set("tahun",taYears[0]);
      else p.set("tahun_list",taYears.join(","));
    } else {
      // Report Date mode → gunakan rd_year (filter by reportDate.year, ignore TA)
      if(filterYears.size===1) p.set("rd_year",filterYear);
      // multi-year: fetch semua, filter client-side
    }
    return p.toString();
  },[importId,filterYear,filterYears,filterTahunAnggaran]);

  const {data,isLoading} = useQuery<any>({
    queryKey:["funnel-data-pres",funnelParams],
    queryFn:async()=>{const r=await fetch(`${BASE_PATH}/api/public/funnel?${funnelParams}`);if(!r.ok)return null;return r.json();},
    enabled:importId!==null||(Array.isArray(snapshots)&&(snapshots.length===0||snapshotOptions.length===0)),
    staleTime:0,
  });

  // tahunAnggaranOptions: for the table-level Tahun Anggaran dropdown — uses real LOP data from API
  const tahunAnggaranOptions = useMemo(()=>{
    const taYears = Array.isArray(data?.availableTahunAnggaran) ? (data.availableTahunAnggaran as number[]) : [];
    if(taYears.length>0) return taYears.map(y=>({value:String(y),label:String(y)}));
    return yearOptions; // fallback to snapshot years
  },[data,yearOptions]);
  // string array for FSCheckboxDropdown
  const tahunAnggaranStringOptions = useMemo(()=>tahunAnggaranOptions.map(o=>o.value),[tahunAnggaranOptions]);

  // Saat filterTahunAnggaran berubah → reset period picker ke kosong (default ALL)
  useEffect(()=>{
    setFilterYears(new Set());
    setFilterMonths(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[filterTahunAnggaran]);

  // availableMonthsByYear: bulan per reportDate.year dari LOP yang lolos filter aktif.
  // TA mode: hanya LOP dengan TA yang dipilih. Report Date mode: semua LOP dari API.
  const availableMonthsByYear = useMemo(()=>{
    if(!data?.lops) return null;
    const result: Record<string,Set<string>> = {};
    (data.lops as any[]).forEach((l:any)=>{
      if(filterTahunAnggaran.size > 0){
        const ta = l.tahunAnggaran ? String(l.tahunAnggaran) : null;
        if(!ta || !filterTahunAnggaran.has(ta)) return; // TA mode: skip non-matching
      }
      const rdYear = l.reportDate ? String(l.reportDate).slice(0,4) : null;
      const mo = l.reportDate ? String(l.reportDate).slice(5,7) : null;
      if(rdYear && mo){
        if(!result[rdYear]) result[rdYear]=new Set();
        result[rdYear].add(mo);
      }
    });
    return Object.keys(result).length > 0 ? result : null;
  },[data,filterTahunAnggaran]);

  // merged year list for Periode dropdown — ketika TA filter aktif hanya tampilkan tahun yang punya data
  const periodeAvailableYears = useMemo(()=>{
    if(availableMonthsByYear){
      const taYears = Object.keys(availableMonthsByYear).sort().reverse();
      if(taYears.length>0) return taYears;
    }
    const fromSnap = yearOptions.map(o=>o.value);
    const fromData = tahunAnggaranStringOptions;
    return [...new Set([...fromSnap,...fromData])].sort().reverse();
  },[yearOptions,tahunAnggaranStringOptions,availableMonthsByYear]);

  // ── Period filtering on frontend ─────────────────────────────────────────────
  // TA mode aktif  → filter by tahunAnggaran, period picker = opsional mempersempit bulan/tahun reportDate.
  // Report Date mode (default) → filter by reportDate.year ∈ filterYears (API sudah pre-filter rd_year).
  // Month filter selalu berlaku via reportDate.month setelah LOP lolos year filter.
  const periodFilteredLops = useMemo(()=>{
    if(!data) return [];
    return (data.lops||[]).filter((l:any)=>{
      const rdYear = l.reportDate ? String(l.reportDate).slice(0,4) : null;
      const ta = l.tahunAnggaran ? String(l.tahunAnggaran) : null;
      if(filterTahunAnggaran.size > 0){
        // TA mode: filter by tahunAnggaran; period picker mempersempit ke tahun/bulan reportDate tertentu
        if(!ta || !filterTahunAnggaran.has(ta)) return false;
        // Jika user memilih tahun tertentu di period picker, saring lebih lanjut by reportDate.year
        if(filterYears.size > 0 && rdYear && !filterYears.has(rdYear)) return false;
      } else {
        // Report Date mode: filter by reportDate.year jika ada tahun yang dipilih
        // filterYears={} = tidak ada restriksi tahun (tampil semua)
        if(filterYears.size > 0 && rdYear && !filterYears.has(rdYear)) return false;
      }
      // Month filter: berlaku pada reportDate.month
      if(filterMonths.size > 0 && l.reportDate){
        const mo = String(l.reportDate).slice(5,7);
        if(!filterMonths.has(mo)) return false;
      }
      return true;
    });
  },[data,filterYears,filterMonths,filterTahunAnggaran]);

  const periodStats = useMemo(()=>{
    const lops=periodFilteredLops;
    const byStatusMap: Record<string,{status:string;count:number;totalNilai:number}>={};
    for(const l of lops){
      const s=l.statusF||"Unknown";
      if(!byStatusMap[s]) byStatusMap[s]={status:s,count:0,totalNilai:0};
      byStatusMap[s].count++;
      byStatusMap[s].totalNilai+=(l.nilaiProyek||0);
    }
    return {
      totalLop:lops.length,
      totalNilai:lops.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0),
      pelangganCount:new Set(lops.map((l:any)=>l.pelanggan).filter(Boolean)).size,
      realFullHo:lops.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0),
      byStatus:Object.values(byStatusMap),
    };
  },[periodFilteredLops]);

  const crStats = useMemo(()=>{
    const compute = (divisi: string): CRDivisiStat => {
      const lops = periodFilteredLops.filter((l:any)=>l.divisi===divisi);
      const f5   = lops.filter((l:any)=>l.statusF==="F5").reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const f3   = lops.filter((l:any)=>l.statusF==="F3").reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const f4   = lops.filter((l:any)=>l.statusF==="F4").reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const denom = f3+f4+f5;
      return { f5, denom, cr: denom>0 ? f5/denom : null };
    };
    return { dps: compute("DPS"), dss: compute("DSS") };
  },[periodFilteredLops]);

  const amOptions = useMemo(()=>{
    const map=new Map<string,string>();
    for(const l of periodFilteredLops){if(l.nikAm&&l.namaAm&&l.namaAm.trim()!=="")map.set(l.nikAm,l.namaAm);}
    return Array.from(map.keys()).sort((a,b)=>(map.get(a)||"").localeCompare(map.get(b)||""));
  },[periodFilteredLops]);
  const amLabelFn = useMemo(()=>{
    const map=new Map<string,string>();
    for(const l of periodFilteredLops){if(l.nikAm&&l.namaAm)map.set(l.nikAm,l.namaAm);}
    return (nik:string)=>map.get(nik)||nik;
  },[periodFilteredLops]);
  const kontrakOptions = useMemo(()=>{
    // Hanya tampilkan kategori yang relevan untuk PIVOT F — jangan tampilkan Uncategorized, Reseller, dll
    const ALLOWED = new Set(["GTMA","Own Channel","New GTMA"]);
    const inData = new Set(periodFilteredLops.map((l:any)=>l.kategoriKontrak).filter(Boolean) as string[]);
    return [...ALLOWED].filter(k => inData.has(k)).sort();
  },[periodFilteredLops]);

  // Bersihkan filterKontrak dari kategori yang tidak ada di kontrakOptions (e.g. Uncategorized)
  useEffect(()=>{
    if(kontrakOptions.length===0) return;
    const allowed=new Set(kontrakOptions);
    const cleaned=new Set([...filterKontrak].filter(k=>allowed.has(k)));
    if(cleaned.size!==filterKontrak.size) setFilterKontrak(cleaned);
  },[kontrakOptions]);// eslint-disable-line react-hooks/exhaustive-deps

  const filteredLops = useMemo(()=>{
    const q=search.toLowerCase();
    const allApiLops:any[] = data?.lops||[];
    // When searching: bypass all filters — search across ALL lops for current tahun anggaran
    if(q) {
      return allApiLops.filter((l:any)=>{
        const hay=`${l.judulProyek} ${l.pelanggan} ${l.lopid} ${l.namaAm} ${l.kategoriKontrak??""} ${l.divisi??""} ${l.segmen??""} ${l.nikAm??""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const base=periodFilteredLops.filter((l:any)=>{
      if(filterAm.size>0&&(!l.nikAm||!filterAm.has(l.nikAm))) return false;
      if(filterStatus.size>0&&(!l.statusF||!filterStatus.has(l.statusF))) return false;
      if(filterKontrak.size>0&&(!l.kategoriKontrak||!filterKontrak.has(l.kategoriKontrak))) return false;
      if(filterDurasi==="multi_year"&&!(l.monthSubs!=null&&l.monthSubs>12)) return false;
      return true;
    });
    if(filterDurasi==="all") return base;
    // single_year & multi_year: annualize nilai proyek per tahun
    return base.map((l:any)=>{
      const m=l.monthSubs;
      if(!m||m<12) return l; // < 12 bulan dianggap 1 tahun → nilai penuh
      return {...l, nilaiProyek: Math.round(l.nilaiProyek*12/m)};
    });
  },[data,periodFilteredLops,filterAm,filterStatus,filterKontrak,filterDurasi,search]);

  // Stats dihitung dari filteredLops (SEMUA filter aktif — termasuk filterKontrak, filterAm, dll)
  const filteredStats = useMemo(()=>{
    const byStatusMap: Record<string,{status:string;count:number;totalNilai:number}>={};
    for(const l of filteredLops){
      const s=(l as any).statusF||"Unknown";
      if(!byStatusMap[s]) byStatusMap[s]={status:s,count:0,totalNilai:0};
      byStatusMap[s].count++;
      byStatusMap[s].totalNilai+=((l as any).nilaiProyek||0);
    }
    return {byStatus:Object.values(byStatusMap)};
  },[filteredLops]);

  const groupedByAm = useMemo(()=>{
    const amMap=new Map<string,{namaAm:string;nikAm:string;divisi:string;phases:Map<string,any[]>}>();
    const divisiAllMap=new Map<string,Set<string>>();
    for(const l of filteredLops){
      const key=l.nikAm||l.namaAm||"Unknown";
      if(!amMap.has(key)) amMap.set(key,{namaAm:l.namaAm||key,nikAm:l.nikAm||"",divisi:l.divisi||"",phases:new Map()});
      const e=amMap.get(key)!;
      if(!e.divisi && l.divisi) e.divisi = l.divisi;
      if(l.divisi){if(!divisiAllMap.has(key))divisiAllMap.set(key,new Set());divisiAllMap.get(key)!.add(l.divisi);}
      const phase=l.statusF||"Unknown";
      if(!e.phases.has(phase)) e.phases.set(phase,[]);
      e.phases.get(phase)!.push(l);
    }
    return Array.from(amMap.values()).map(a=>({...a,divisiAll:[...((divisiAllMap.get(a.nikAm||a.namaAm)||new Set()))]})).sort((a,b)=>{
      const totA=Array.from(a.phases.values()).flat().reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const totB=Array.from(b.phases.values()).flat().reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      return totB-totA;
    });
  },[filteredLops]);

  useEffect(()=>{
    onTitleChange?.(filterMode==="ho"?"HO":"FULL (HO+BA)");
  },[filterMode,onTitleChange]);

  // ── Split mode state + computed ─────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<"all"|"split">("all");
  const [splitTableDiv, setSplitTableDiv] = useState<"DPS"|"DSS">("DPS");

  // Resolve divisi dari LOPs dalam phases jika AM-level divisi kosong
  function resolveAmDivisi(am: {divisi:string;phases:Map<string,any[]>}): string {
    if (am.divisi) return am.divisi;
    const counts: Record<string,number> = {};
    for (const lops of am.phases.values())
      for (const l of lops as any[]) if (l.divisi) counts[l.divisi]=(counts[l.divisi]||0)+1;
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "";
  }

  // Build per-divisi groups by filtering LOPs by their own divisi field.
  // Cross-divisi AMs (e.g. HANDIKA: 27 DPS + 44 DSS) appear correctly in each panel.
  function buildGroupedForDivisiFS(lops: any[]) {
    const amMap = new Map<string,{namaAm:string;nikAm:string;divisi:string;phases:Map<string,any[]>}>();
    const divisiAllMap = new Map<string,Set<string>>();
    for (const l of lops) {
      const key = l.nikAm || l.namaAm || "Unknown";
      if (!amMap.has(key)) amMap.set(key, {namaAm:l.namaAm||key,nikAm:l.nikAm||"",divisi:l.divisi||"",phases:new Map()});
      const e = amMap.get(key)!;
      if(!e.divisi && l.divisi) e.divisi = l.divisi;
      if(l.divisi){if(!divisiAllMap.has(key))divisiAllMap.set(key,new Set());divisiAllMap.get(key)!.add(l.divisi);}
      const phase = l.statusF || "Unknown";
      if (!e.phases.has(phase)) e.phases.set(phase, []);
      e.phases.get(phase)!.push(l);
    }
    return Array.from(amMap.values()).map(a=>({...a,divisiAll:[...((divisiAllMap.get(a.nikAm||a.namaAm)||new Set()))]})).sort((a,b) => {
      const totA = Array.from(a.phases.values()).flat().reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const totB = Array.from(b.phases.values()).flat().reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      return totB - totA;
    });
  }
  const dpsGrouped = useMemo(() => buildGroupedForDivisiFS(filteredLops.filter((l:any) => l.divisi === "DPS")), [filteredLops]);
  const dssGrouped = useMemo(() => buildGroupedForDivisiFS(filteredLops.filter((l:any) => l.divisi === "DSS")), [filteredLops]);

  function computeDivisiStatsFromGroup(grp: typeof dpsGrouped) {
    const allLops: any[] = [];
    for (const am of grp) for (const lops of am.phases.values()) allLops.push(...(lops as any[]));
    const byStatusMap: Record<string,{status:string;count:number;totalNilai:number}> = {};
    for (const l of allLops) {
      const s = l.statusF||"Unknown";
      if (!byStatusMap[s]) byStatusMap[s]={status:s,count:0,totalNilai:0};
      byStatusMap[s].count++;
      byStatusMap[s].totalNilai += l.nilaiProyek||0;
    }
    return {
      totalLop: allLops.length,
      totalNilai: allLops.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0),
      pelangganCount: new Set(allLops.map((l:any)=>l.pelanggan).filter(Boolean)).size,
      byStatus: Object.values(byStatusMap),
    };
  }
  const dpsStats = useMemo(()=>computeDivisiStatsFromGroup(dpsGrouped),[dpsGrouped]);
  const dssStats = useMemo(()=>computeDivisiStatsFromGroup(dssGrouped),[dssGrouped]);

  const lastAutoExpandIdFS = useRef<number|null>(undefined as any);
  useEffect(()=>{
    if(groupedByAm.length===0) return;
    if(importId===lastAutoExpandIdFS.current) return;
    lastAutoExpandIdFS.current=importId;
    setExpandedAm({}); setExpandedPhase({}); setAllExpanded(false);
  },[groupedByAm,importId]);

  // Thead ref untuk sticky AM/phase row positioning dalam unified table scroll container
  const fsFunnelTheadRef = useRef<HTMLTableSectionElement>(null);
  const [fsFunnelTheadH, setFsFunnelTheadH] = useState(40);
  useEffect(()=>{
    const el = fsFunnelTheadRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFsFunnelTheadH(el.offsetHeight));
    ro.observe(el);
    setFsFunnelTheadH(el.offsetHeight);
    return () => ro.disconnect();
  },[]);

  // AM name table ref — callback ref attached to ALL expanded AM name tables so height is always measured
  const [fsFunnelAmRowH, setFsFunnelAmRowH] = useState(44);
  const fsFunnelAmRowObserver = useRef<ResizeObserver|null>(null);
  const fsFunnelAmTableCallbackRef = useCallback((el: HTMLTableElement|null)=>{
    if(fsFunnelAmRowObserver.current){fsFunnelAmRowObserver.current.disconnect();fsFunnelAmRowObserver.current=null;}
    if(!el) return;
    setFsFunnelAmRowH(el.offsetHeight);
    const ro=new ResizeObserver(()=>setFsFunnelAmRowH(el.offsetHeight));
    ro.observe(el);
    fsFunnelAmRowObserver.current=ro;
  },[]);

  function handleToggleAll(){
    const next=!allExpanded;
    setAllExpanded(next);
    if(next){
      const ak:Record<string,boolean>={},pk:Record<string,boolean>={};
      for(const am of groupedByAm){
        ak[am.nikAm||am.namaAm]=true;
        for(const[ph] of am.phases) pk[`${am.nikAm||am.namaAm}|${ph}`]=true;
      }
      setExpandedAm(ak); setExpandedPhase(pk);
    } else { setExpandedAm({}); setExpandedPhase({}); }
  }

  function toggleAmRow(key:string){
    setExpandedAm(p=>({...p,[key]:!p[key]}));
  }
  function handleAmExpandIcon(amKey:string, phases:string[]){
    const isNowExpanding=!expandedAm[amKey];
    setExpandedAm(p=>({...p,[amKey]:isNowExpanding}));
    if(isNowExpanding){
      const pk:Record<string,boolean>={};
      for(const ph of phases) pk[`${amKey}|${ph}`]=true;
      setExpandedPhase(p=>({...p,...pk}));
    } else {
      setExpandedPhase(p=>{
        const n={...p};
        for(const ph of phases) delete n[`${amKey}|${ph}`];
        return n;
      });
    }
  }
  function togglePhaseRow(key:string){setExpandedPhase(p=>({...p,[key]:!p[key]}));}

  // ── Keyboard shortcuts (active only when FunnelSlide is mounted = slide 1 is active) ──
  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      const t=e.target as HTMLElement;
      const inInput=t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable;
      if(inInput) return;
      if(e.key==="e"||e.key==="E"){ e.preventDefault(); handleToggleAll(); }
      if(e.key==="Escape"){ setAllExpanded(false); setExpandedAm({}); setExpandedPhase({}); setSearch(""); }
      if(e.key==="/"){ e.preventDefault(); funnelSearchRef.current?.focus(); }
      if(e.key==="t"||e.key==="T"){ e.preventDefault(); funnelTableRef.current?.focus(); }
    }
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[]);

  const effectiveTargetHo=targetHoOverride?parseFloat(targetHoOverride)*1e9:(data?.targetHo||0);
  const effectiveTargetFullHo=targetFullHoOverride?parseFloat(targetFullHoOverride)*1e9:(data?.targetFullHo||0);
  const activeTarget=filterMode==="ho"?effectiveTargetHo:effectiveTargetFullHo;
  const pct=activeTarget?(periodStats.realFullHo/activeTarget)*100:0;

  // ── Per-divisi targets for DPS | DSS split gauges ─────────────────────────
  const tbd=(data as any)?.targetByDivisi??{};
  const dpsTgtHo=tbd["DPS"]?.targetHo||0;
  const dpsTgtFullHo=tbd["DPS"]?.targetFullHo||0;
  const dssTgtHo=tbd["DSS"]?.targetHo||0;
  const dssTgtFullHo=tbd["DSS"]?.targetFullHo||0;
  const dpsTgt=filterMode==="ho"?dpsTgtHo:dpsTgtFullHo;
  const dssTgt=filterMode==="ho"?dssTgtHo:dssTgtFullHo;
  const dpsPct=dpsTgt?(dpsStats.totalNilai/dpsTgt)*100:0;
  const dssPct=dssTgt?(dssStats.totalNilai/dssTgt)*100:0;

  const hasActiveFilter=filterAm.size>0||filterStatus.size>0||filterKontrak.size>0||filterDurasi!=="all"||filterMonths.size>0||filterTahunAnggaran.size>0;
  const lopBadge=filteredLops.length!==(data?.totalLop||0)?`${filteredLops.length} / ${data?.totalLop||0}`:filteredLops.length.toLocaleString("id-ID");


  // ── reusable tbody renderer for presentation split panels ──────────────────
  function renderAmTbodyContentFS(ams: typeof groupedByAm, emptyMsg?: string, divisiCtx?: "DPS" | "DSS") {
    if (isLoading) return <tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">Memuat data...</td></tr>;
    if (ams.length===0) return <tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">{emptyMsg??"Belum ada data"}</td></tr>;
    return <>{ams.map((am,amIdx)=>{
      const amKey=am.nikAm||am.namaAm;
      const amExpanded=!!expandedAm[amKey];
      const allAmLopsTbody=Array.from(am.phases.values()).flat();
      const amTotal=allAmLopsTbody.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const amLopCount=allAmLopsTbody.length;
      const amPelangganTbody=new Set(allAmLopsTbody.map((l:any)=>l.pelanggan).filter(Boolean)).size;
      const orderedPhases=[...FS_PHASES.filter(p=>am.phases.has(p)),...Array.from(am.phases.keys()).filter(p=>!FS_PHASES.includes(p))];
      const ring=amExpanded?"#94a3b8":undefined;
      const ringStyle=(extra?:React.CSSProperties):React.CSSProperties=>ring?{borderLeft:`2px solid ${ring}`,borderRight:`2px solid ${ring}`,...extra}:{};
      return (
        <React.Fragment key={amKey}>
          <tr className="cursor-pointer select-none transition-colors"
            style={{
              ...(ring?{borderTop:`2px solid ${ring}`,borderLeft:`2px solid ${ring}`,borderRight:`2px solid ${ring}`,borderBottom:amExpanded?"none":`2px solid ${ring}`}:{borderTop:"2px solid transparent"}),
            }}
            onClick={()=>toggleAmRow(amKey)}>
            <td className="px-4 py-3"
              style={{
                backgroundColor: amExpanded ? "hsl(var(--card))" : undefined,
                ...(amExpanded ? {position:"sticky" as const, top:fsFunnelTheadH, zIndex:15, boxShadow:"0 2px 8px rgba(0,0,0,0.13)"} : {})
              }}>
              <div className="flex items-center gap-2">
                <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0",amExpanded&&"rotate-90")}/>
                <span className="font-black text-foreground text-sm uppercase tracking-wide">{am.namaAm}</span>
                {((am as any).divisiAll?.length>0?(am as any).divisiAll:[resolveAmDivisi(am)].filter(Boolean)).map((d:string)=><span key={d} className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",d==="DPS"?"bg-blue-100 text-blue-700":d==="DSS"?"bg-emerald-100 text-emerald-700":"bg-slate-100 text-slate-600")}>{d}</span>)}
                <button type="button" onClick={e=>{e.stopPropagation();handleAmExpandIcon(amKey,orderedPhases);}}
                  className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
                  title={amExpanded?"Collapse semua proyek":"Expand semua proyek"}>
                  {amExpanded?<Minimize2 className="w-3 h-3"/>:<Expand className="w-3 h-3"/>}
                </button>
              </div>
            </td>
            {(()=>{
              const stickyCell:React.CSSProperties=amExpanded?{backgroundColor:"hsl(var(--card))",position:"sticky",top:fsFunnelTheadH,zIndex:15}:{};
              const f5Val=(am.phases.get("F5")as any[]||[]).reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
              const f345Val=(["F3","F4","F5"].flatMap(p=>(am.phases.get(p)as any[])||[]) as any[]).reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
              const cr=f345Val>0?f5Val/f345Val:null;
              const amTargetInfo=data?.amTargets?.[am.nikAm];
              const amTargetVal=divisiCtx==="DPS"?(amTargetInfo?.targetValueDps??amTargetInfo?.targetValue??0):divisiCtx==="DSS"?(amTargetInfo?.targetValueDss??amTargetInfo?.targetValue??0):(amTargetInfo?.targetValue??0);
              const pctRaw=amTargetVal>0?(amTotal/amTargetVal)*100:0;
              const pctBar=Math.min(pctRaw,100);
              const barColor=pctRaw>=100?"#10b981":pctRaw>=70?"#f97316":"#3b82f6";
              return(<>
                <td className="px-3 py-3 text-left whitespace-nowrap" style={stickyCell}>
                  <span className="text-sm font-black tabular-nums text-foreground">{amLopCount} <span className="font-normal text-xs text-muted-foreground">lop</span></span>
                </td>
                <td className="px-3 py-3 text-left whitespace-nowrap" style={stickyCell}>
                  <span className={cn("text-sm font-black tabular-nums",amPelangganTbody>0?"text-foreground":"text-muted-foreground")}>
                    {amPelangganTbody>0?<>{amPelangganTbody} <span className="font-normal text-xs text-muted-foreground">plg</span></>:"—"}
                  </span>
                </td>
                <td className="px-3 py-3 text-center overflow-hidden" style={stickyCell}>
                  {amTargetVal>0?<span className="text-sm font-black tabular-nums text-foreground">{fmtRupiah(amTargetVal)}</span>:<span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="px-3 py-3" style={stickyCell}>
                  <span className="font-black tabular-nums text-sm block text-foreground">{fmtRupiah(amTotal)}</span>
                  {amTargetVal>0&&(
                    <div className="mt-1.5">
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{width:`${pctBar}%`,background:barColor}}/>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-sm font-black tabular-nums" style={{color:barColor}}>{typeof pctRaw === "number" && !isNaN(pctRaw) ? pctRaw.toFixed(0) : "0"}%</span>
                        <span className="text-xs font-bold text-muted-foreground">capaian</span>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right relative" style={stickyCell}>
                  {typeof cr==="number"&&!isNaN(cr)?(<div className="relative inline-block group"><span className={cn("font-bold text-sm tabular-nums cursor-help underline decoration-dotted decoration-1 underline-offset-2",cr>=0.7?"text-emerald-600":"text-red-600")}>{(cr*100).toFixed(1)}%</span><div className="absolute right-0 top-full mt-1 z-[200] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150" style={{minWidth:"220px"}}><div className="bg-popover border border-border rounded-lg shadow-xl p-3 text-left"><div className="text-[10px] font-black text-slate-900 uppercase tracking-wide mb-2">Perhitungan Conversion Rate</div><div className="space-y-1.5"><div className="flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">F5 (Closed/Won)</span><span className="text-xs font-bold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(f5Val)}</span></div><div className="flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">F3 + F4 + F5</span><span className="text-xs font-bold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(f345Val)}</span></div><div className="border-t border-border pt-1.5 flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">CR = F5 ÷ (F3+F4+F5)</span><span className={cn("text-xs font-black tabular-nums whitespace-nowrap",cr>=0.7?"text-emerald-600":"text-red-600")}>= {(cr*100).toFixed(1)}%</span></div></div></div></div></div>):<span className="text-muted-foreground text-xs">—</span>}
                </td>
              </>);
            })()}
          </tr>
          {amExpanded&&orderedPhases.map(phase=>{
            const lops=am.phases.get(phase)||[];
            const phaseKey=`${amKey}|${phase}`;
            const phaseExpanded=!!expandedPhase[phaseKey];
            const phaseTotal=lops.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
            const c=FS_PHASE_COLORS[phase];
            const phaseBg=phaseExpanded?"rgb(253,242,248)":"rgba(253,242,248,0.75)";
            return (
              <React.Fragment key={phaseKey}>
                <tr className="cursor-pointer select-none hover:brightness-95 transition-all"
                  style={{
                    borderLeft:`4px solid ${c?.bar||"#94a3b8"}`,
                    ...ringStyle({}),
                  }}
                  onClick={()=>togglePhaseRow(phaseKey)}>
                  <td className="px-4 py-2.5 pl-10" style={{background:phaseBg}}>
                    <div className="flex items-center gap-2">
                      <ChevronRight className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0",phaseExpanded&&"rotate-90")}/>
                      <span className="text-sm font-black uppercase tracking-wide" style={{color:c?.text}}>DAFTAR PROYEK {phase}</span>
                      <span className="text-xs font-black text-slate-900 px-1.5 py-0.5 rounded-full" style={{background:"#f2f2f2"}}>{lops.length} proyek</span>
                    </div>
                  </td>
                  {phaseExpanded
                    ? <td colSpan={5} className="px-3 py-2.5" style={{background:phaseBg}}/>
                    : <><td colSpan={4} className="px-3 py-2.5" style={{background:phaseBg}}/>
                        <td className="px-3 py-2.5 text-right overflow-hidden" style={{background:phaseBg}} title={fmtRupiah(phaseTotal)}>
                          <span className="text-sm font-black text-foreground tabular-nums">{fmtRupiah(phaseTotal)}</span>
                        </td></>}
                </tr>
                {phaseExpanded&&(
                  <tr style={ringStyle({})}>
                    <td colSpan={6} className="p-0 border-b border-slate-200">
                      <table className="w-full text-left text-sm" style={{tableLayout:"fixed",borderCollapse:"collapse"}}>
                        <colgroup>
                          <col style={{width:"26%"}}/>
                          <col style={{width:"10%"}}/>
                          <col style={{width:"7%"}}/>
                          <col style={{width:"12%"}}/>
                          <col style={{width:"19%"}}/>
                          <col style={{width:"26%"}}/>
                        </colgroup>
                        <thead>
                          <tr className="bg-slate-200 border-y border-slate-400">
                            <td className="px-4 py-2 pl-16 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Nama Proyek</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Kategori</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Durasi</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">LOP ID</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Pelanggan & Divisi</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider text-right overflow-hidden">Nilai</td>
                          </tr>
                        </thead>
                        <tbody>
                          {lops.map((lop:any,idx:number)=>(
                            <tr key={`${lop.lopid}-${idx}`} className="hover:bg-pink-50 transition-colors border-b border-slate-100">
                              <td className="px-4 py-2.5 pl-16 overflow-hidden"><div className="text-sm text-foreground font-bold leading-tight line-clamp-2" title={lop.judulProyek}>{lop.judulProyek}</div></td>
                              <td className="px-3 py-2.5 overflow-hidden">{lop.kategoriKontrak?<span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap ${kategoriColor(lop.kategoriKontrak)}`}>{lop.kategoriKontrak}</span>:<span className="text-muted-foreground text-xs">–</span>}</td>
                              <td className="px-3 py-2.5 overflow-hidden"><span className="text-sm font-bold text-teal-700 dark:text-teal-400 whitespace-nowrap">{fsDurasi(lop.monthSubs)}</span></td>
                              <td className="px-3 py-2.5 overflow-hidden"><span className="font-mono text-xs font-semibold text-slate-600 truncate block">{lop.lopid}</span></td>
                              <td className="px-3 py-2.5 overflow-hidden">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="text-sm text-foreground font-semibold truncate" title={lop.pelanggan}>{lop.pelanggan}</span>
                                  {lop.divisi?<span className={`inline-flex items-center self-start px-1.5 py-0.5 rounded text-[10px] font-black uppercase border ${lop.divisi.toUpperCase()==="DPS"?"bg-blue-50 text-blue-700 border-blue-200":lop.divisi.toUpperCase()==="DSS"?"bg-purple-50 text-purple-700 border-purple-200":"bg-slate-100 text-slate-600 border-slate-300"}`}>{lop.divisi}</span>:null}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-xs font-bold text-foreground overflow-hidden">{fmtRupiah(lop.nilaiProyek||0)}</td>
                            </tr>
                          ))}
                          <tr className="bg-red-50 border-t border-red-200">
                            <td colSpan={5} className="px-4 py-2 pl-16 overflow-hidden"><span className="text-sm font-black text-red-800 uppercase tracking-wide">Total Nilai {phase}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums text-sm font-black text-red-800 overflow-hidden">{fmtRupiah(phaseTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {amExpanded&&(
            <tr className="bg-slate-100 border-t-2 border-slate-300" style={ring?{borderLeft:`2px solid ${ring}`,borderRight:`2px solid ${ring}`,borderBottom:`2px solid ${ring}`}:{}}>
              <td colSpan={5} className="px-4 py-2.5 pl-10"><span className="text-sm font-black text-red-700 uppercase tracking-wide">Total Nilai Proyek — {am.namaAm}</span></td>
              <td className="px-3 py-2.5 text-right tabular-nums font-black text-red-700 overflow-hidden text-sm">{fmtRupiah(amTotal)}</td>
            </tr>
          )}
        </React.Fragment>
      );
    })}</>;
  }

  // ── Multi-table renderer: tiap fase = 1 tabel dengan <thead> 2 baris ─────────
  // Nama AM + DAFTAR PROYEK Fx sticky bersama satu unit — no gap
  const FS_TB_STYLE:React.CSSProperties={tableLayout:"fixed",borderCollapse:"separate",borderSpacing:0,width:"100%"};
  function FSColGroup(){return(<colgroup><col style={{width:"25%"}}/><col style={{width:"80px"}}/><col style={{width:"75px"}}/><col style={{width:"210px"}}/><col style={{width:"200px"}}/><col style={{width:"130px"}}/></colgroup>);}
  function fsDurasi(m:any):string{if(!m||m<=0)return"–";if(m%12===0)return`${m/12} TAHUN`;return`${m} BULAN`;}

  function renderAmTablesFS(ams: typeof groupedByAm, emptyMsg?: string): React.ReactNode {
    if(isLoading) return(<table className="text-left text-sm" style={FS_TB_STYLE}><FSColGroup/><tbody><tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">Memuat data...</td></tr></tbody></table>);
    if(ams.length===0) return(<table className="text-left text-sm" style={FS_TB_STYLE}><FSColGroup/><tbody><tr><td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">{emptyMsg??"Belum ada data"}</td></tr></tbody></table>);
    const multiExpanded = Object.values(expandedAm).filter(Boolean).length > 1;
    return<>{ams.map((am,amIdx)=>{
      const amKey=am.nikAm||am.namaAm;
      const amExpanded=!!expandedAm[amKey];
      const allAmLopsFS=Array.from(am.phases.values()).flat();
      const amTotal=allAmLopsFS.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const amLopCount=allAmLopsFS.length;
      const amPelangganFS=new Set(allAmLopsFS.map((l:any)=>l.pelanggan).filter(Boolean)).size;
      const orderedPhases=[...FS_PHASES.filter(p=>am.phases.has(p)),...Array.from(am.phases.keys()).filter(p=>!FS_PHASES.includes(p))];
      const ring=amExpanded?"#94a3b8":undefined;
      const bgCard="hsl(var(--card))";
      const divBadges=((am as any).divisiAll?.length>0?(am as any).divisiAll:[resolveAmDivisi(am)].filter(Boolean)).map((d:string)=><span key={d} className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",d==="DPS"?"bg-blue-100 text-blue-700":d==="DSS"?"bg-emerald-100 text-emerald-700":"bg-slate-100 text-slate-600")}>{d}</span>);

      // Shared AM stats
      const f5Val=(am.phases.get("F5")as any[]||[]).reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const f345Val=(["F3","F4","F5"].flatMap(p=>(am.phases.get(p)as any[])||[]) as any[]).reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
      const crAm=f345Val>0?f5Val/f345Val:null;
      const amTgt=data?.amTargets?.[am.nikAm]?.targetValue??0;
      const amTgtYr=data?.amTargetYear??new Date().getFullYear();
      const pctRawAm=amTgt>0?(amTotal/amTgt)*100:0;
      const pctBarAm=Math.min(pctRawAm,100);
      const barColorAm=pctRawAm>=100?"#10b981":pctRawAm>=70?"#f97316":"#3b82f6";

      if(!amExpanded){return(
        <table key={amKey} className="text-left text-sm" style={FS_TB_STYLE}><FSColGroup/>
          <tbody>
            <tr className="cursor-pointer select-none bg-card hover:bg-secondary/30 transition-colors" style={{borderTop:"2px solid transparent"}} onClick={()=>toggleAmRow(amKey)}>
              <td className="px-4 py-3"><div className="flex items-center gap-2"><ChevronRight className="w-4 h-4 text-muted-foreground shrink-0"/><span className="text-foreground text-sm uppercase tracking-wide font-extrabold">{am.namaAm}</span>{divBadges}<button type="button" onClick={e=>{e.stopPropagation();handleAmExpandIcon(amKey,orderedPhases);}} className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0" title="Expand semua proyek"><Expand className="w-3 h-3"/></button></div></td>
              <td className="px-3 py-3 text-left whitespace-nowrap"><span className="text-sm font-black tabular-nums">{amLopCount} <span className="font-normal text-xs text-muted-foreground">lop</span></span></td>
              <td className="px-3 py-3 text-left whitespace-nowrap"><span className={cn("text-sm font-black tabular-nums",amPelangganFS>0?"text-foreground":"text-muted-foreground")}>{amPelangganFS>0?<>{amPelangganFS} <span className="font-normal text-xs text-muted-foreground">plg</span></>:"—"}</span></td>
              <td className="px-3 py-3 text-center overflow-hidden">{amTgt>0?<span className="text-sm font-black tabular-nums text-foreground">{fmtRupiah(amTgt)}</span>:<span className="text-muted-foreground text-xs">—</span>}</td>
              <td className="px-3 py-3">
                <span className="font-black tabular-nums text-sm block">{fmtRupiah(amTotal)}</span>
                {amTgt>0&&(<div className="mt-1.5"><div className="h-2.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{width:`${pctBarAm}%`,background:barColorAm}}/></div><div className="flex items-center gap-1 mt-0.5"><span className="text-sm font-black tabular-nums" style={{color:barColorAm}}>{typeof pctRawAm === "number" && !isNaN(pctRawAm) ? pctRawAm.toFixed(0) : "0"}%</span><span className="text-xs font-bold text-muted-foreground">capaian</span></div></div>)}
              </td>
              <td className="px-4 py-3 text-right relative">{typeof crAm==="number"&&!isNaN(crAm)?(<div className="relative inline-block group"><span className={cn("font-bold text-sm tabular-nums cursor-help underline decoration-dotted decoration-1 underline-offset-2",crAm>=0.7?"text-emerald-600":"text-red-600")}>{(crAm*100).toFixed(1)}%</span><div className="absolute right-0 top-full mt-1 z-[200] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150" style={{minWidth:"220px"}}><div className="bg-popover border border-border rounded-lg shadow-xl p-3 text-left"><div className="text-[10px] font-black text-slate-900 uppercase tracking-wide mb-2">Perhitungan Conversion Rate</div><div className="space-y-1.5"><div className="flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">F5 (Closed/Won)</span><span className="text-xs font-bold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(f5Val)}</span></div><div className="flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">F3 + F4 + F5</span><span className="text-xs font-bold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(f345Val)}</span></div><div className="border-t border-border pt-1.5 flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">CR = F5 ÷ (F3+F4+F5)</span><span className={cn("text-xs font-black tabular-nums whitespace-nowrap",crAm>=0.7?"text-emerald-600":"text-red-600")}>= {(crAm*100).toFixed(1)}%</span></div></div></div></div></div>):<span className="text-muted-foreground text-xs">—</span>}</td>
            </tr>
          </tbody>
        </table>
      );}

      const bg={backgroundColor:bgCard};
      return(<div key={amKey}>
        {/* Sticky AM name row — own table so it sticks independently across all phase tables */}
        <table ref={fsFunnelAmTableCallbackRef} className="text-left text-sm" style={{...FS_TB_STYLE,position:"sticky",top:fsFunnelTheadH,zIndex:16,boxShadow:"0 2px 8px rgba(0,0,0,0.13)"}}><FSColGroup/>
          <tbody>
            <tr className="cursor-pointer select-none hover:brightness-95 transition-colors"
              style={{borderTop:`2px solid ${ring}`,borderLeft:`2px solid ${ring}`,borderRight:`2px solid ${ring}`,borderBottom:"none"}}
              onClick={()=>toggleAmRow(amKey)}>
              <td className="px-4 py-2.5 font-normal text-left" style={bg}>
                <div className="flex items-center gap-2"><ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 rotate-90"/><span className="text-foreground text-sm uppercase tracking-wide font-bold">{am.namaAm}</span>{divBadges}<button type="button" onClick={e=>{e.stopPropagation();handleAmExpandIcon(amKey,orderedPhases);}} className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0" title="Collapse semua proyek"><Minimize2 className="w-3 h-3"/></button></div>
              </td>
              <td className="px-3 py-2.5 text-left whitespace-nowrap" style={bg}><span className="text-sm font-black tabular-nums">{amLopCount} <span className="font-normal text-xs text-muted-foreground">lop</span></span></td>
              <td className="px-3 py-2.5 text-left whitespace-nowrap" style={bg}><span className={cn("text-sm font-black tabular-nums",amPelangganFS>0?"text-foreground":"text-muted-foreground")}>{amPelangganFS>0?<>{amPelangganFS} <span className="font-normal text-xs text-muted-foreground">plg</span></>:"—"}</span></td>
              <td className="px-3 py-2.5 text-center overflow-hidden" style={bg}>{amTgt>0?<span className="text-sm font-black tabular-nums text-foreground">{fmtRupiah(amTgt)}</span>:<span className="text-muted-foreground text-xs">—</span>}</td>
              <td className="px-3 py-2.5" style={bg}>
                <span className="font-black tabular-nums text-sm block">{fmtRupiah(amTotal)}</span>
                {amTgt>0&&(<div className="mt-1.5"><div className="h-2.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{width:`${pctBarAm}%`,background:barColorAm}}/></div><div className="flex items-center gap-1 mt-0.5"><span className="text-sm font-black tabular-nums" style={{color:barColorAm}}>{typeof pctRawAm === "number" && !isNaN(pctRawAm) ? pctRawAm.toFixed(0) : "0"}%</span><span className="text-xs font-bold text-muted-foreground">capaian</span></div></div>)}
              </td>
              <td className="px-4 py-2.5 text-right relative" style={bg}>{typeof crAm==="number"&&!isNaN(crAm)?(<div className="relative inline-block group"><span className={cn("font-bold text-sm tabular-nums cursor-help underline decoration-dotted decoration-1 underline-offset-2",crAm>=0.7?"text-emerald-600":"text-red-600")}>{(crAm*100).toFixed(1)}%</span><div className="absolute right-0 top-full mt-1 z-[200] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150" style={{minWidth:"220px"}}><div className="bg-popover border border-border rounded-lg shadow-xl p-3 text-left"><div className="text-[10px] font-black text-slate-900 uppercase tracking-wide mb-2">Perhitungan Conversion Rate</div><div className="space-y-1.5"><div className="flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">F5 (Closed/Won)</span><span className="text-xs font-bold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(f5Val)}</span></div><div className="flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">F3 + F4 + F5</span><span className="text-xs font-bold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(f345Val)}</span></div><div className="border-t border-border pt-1.5 flex items-center justify-between gap-4"><span className="text-xs font-medium text-slate-700 whitespace-nowrap">CR = F5 ÷ (F3+F4+F5)</span><span className={cn("text-xs font-black tabular-nums whitespace-nowrap",crAm>=0.7?"text-emerald-600":"text-red-600")}>= {(crAm*100).toFixed(1)}%</span></div></div></div></div></div>):<span className="text-muted-foreground text-xs">—</span>}</td>
            </tr>
          </tbody>
        </table>
        {orderedPhases.map((phase,phaseIdx)=>{
          const lops=am.phases.get(phase)||[];
          const phaseKey=`${amKey}|${phase}`;
          const phaseExpanded=!!expandedPhase[phaseKey];
          const phaseTotal=lops.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0);
          const c=FS_PHASE_COLORS[phase];
          const phaseBg=phaseExpanded?"rgb(253,242,248)":"rgba(253,242,248,0.75)";
          return(
            <table key={phaseKey} className="text-left text-sm" style={FS_TB_STYLE}><FSColGroup/>
              <thead style={multiExpanded ? undefined : {position:"sticky",top:fsFunnelTheadH+fsFunnelAmRowH,zIndex:15}}>
                {/* Phase header row — sticks below the AM name row */}
                <tr className="cursor-pointer select-none hover:brightness-95 transition-all"
                  style={{borderLeft:`4px solid ${c?.bar||"#94a3b8"}`,borderRight:`2px solid ${ring}`,boxShadow:"0 2px 6px rgba(0,0,0,0.09)",borderTop:phaseIdx>0?`1px solid hsl(var(--border))`:"none"}}
                  onClick={()=>togglePhaseRow(phaseKey)}>
                  <th className="px-4 py-2.5 pl-10 font-normal text-left" style={{background:phaseBg}}>
                    <div className="flex items-center gap-2"><ChevronRight className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0",phaseExpanded&&"rotate-90")}/><span className="text-sm font-black uppercase tracking-wide" style={{color:c?.text}}>DAFTAR PROYEK {phase}</span><span className="text-xs font-black text-slate-900 px-1.5 py-0.5 rounded-full" style={{background:"#f2f2f2"}}>{lops.length} proyek</span></div>
                  </th>
                  {phaseExpanded
                    ?<th colSpan={5} className="px-3 py-2.5 font-normal" style={{background:phaseBg}}/>
                    :<><th colSpan={4} className="px-3 py-2.5 font-normal" style={{background:phaseBg}}/><th className="px-3 py-2.5 text-right overflow-hidden font-normal" style={{background:phaseBg}}><span className="text-sm font-black text-foreground tabular-nums">{fmtRupiah(phaseTotal)}</span></th></>
                  }
                </tr>
              </thead>
              <tbody>
                {phaseExpanded&&(
                  <tr style={{borderLeft:`2px solid ${ring}`,borderRight:`2px solid ${ring}`}}>
                    <td colSpan={6} className="p-0 border-b border-slate-200">
                      <table className="w-full text-left text-sm" style={{tableLayout:"fixed",borderCollapse:"collapse"}}>
                        <colgroup>
                          <col style={{width:"26%"}}/>
                          <col style={{width:"10%"}}/>
                          <col style={{width:"7%"}}/>
                          <col style={{width:"12%"}}/>
                          <col style={{width:"19%"}}/>
                          <col style={{width:"26%"}}/>
                        </colgroup>
                        <thead>
                          <tr className="bg-slate-200 border-y border-slate-400">
                            <td className="px-4 py-2 pl-16 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Nama Proyek</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Kategori</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Durasi</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">LOP ID</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Pelanggan & Divisi</td>
                            <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider text-right overflow-hidden">Nilai</td>
                          </tr>
                        </thead>
                        <tbody>
                          {lops.map((lop:any,idx:number)=>(
                            <tr key={`${lop.lopid}-${idx}`} className="hover:bg-pink-50 transition-colors border-b border-slate-100">
                              <td className="px-4 py-2.5 pl-16 overflow-hidden"><div className="text-sm text-foreground font-bold leading-tight line-clamp-2" title={lop.judulProyek}>{lop.judulProyek}</div></td>
                              <td className="px-3 py-2.5 overflow-hidden">{lop.kategoriKontrak?<span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap ${kategoriColor(lop.kategoriKontrak)}`}>{lop.kategoriKontrak}</span>:<span className="text-muted-foreground text-xs">–</span>}</td>
                              <td className="px-3 py-2.5 overflow-hidden"><span className="text-sm font-bold text-teal-700 dark:text-teal-400 whitespace-nowrap">{fsDurasi(lop.monthSubs)}</span></td>
                              <td className="px-3 py-2.5 overflow-hidden"><span className="font-mono text-xs font-semibold text-slate-600 truncate block">{lop.lopid}</span></td>
                              <td className="px-3 py-2.5 overflow-hidden">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="text-sm text-foreground font-semibold truncate" title={lop.pelanggan}>{lop.pelanggan}</span>
                                  {lop.divisi?<span className={`inline-flex items-center self-start px-1.5 py-0.5 rounded text-[10px] font-black uppercase border ${lop.divisi.toUpperCase()==="DPS"?"bg-blue-50 text-blue-700 border-blue-200":lop.divisi.toUpperCase()==="DSS"?"bg-purple-50 text-purple-700 border-purple-200":"bg-slate-100 text-slate-600 border-slate-300"}`}>{lop.divisi}</span>:null}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-xs font-bold text-foreground overflow-hidden">{fmtRupiah(lop.nilaiProyek||0)}</td>
                            </tr>
                          ))}
                          <tr className="bg-red-50 border-t border-red-200">
                            <td colSpan={5} className="px-4 py-2 pl-16 overflow-hidden"><span className="text-sm font-black text-red-800 uppercase tracking-wide">Total Nilai {phase}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums text-sm font-black text-red-800 overflow-hidden">{fmtRupiah(phaseTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          );
        })}
        <table className="text-left text-sm" style={FS_TB_STYLE}><FSColGroup/>
          <tbody>
            <tr className="bg-slate-100 border-t-2 border-slate-300" style={ring?{borderLeft:`2px solid ${ring}`,borderRight:`2px solid ${ring}`,borderBottom:`2px solid ${ring}`}:{}}>
              <td colSpan={5} className="px-4 py-2.5 pl-10"><span className="text-sm font-black text-red-700 uppercase tracking-wide">Total Nilai Proyek — {am.namaAm}</span></td>
              <td className="px-3 py-2.5 text-right tabular-nums font-black text-red-700 overflow-hidden text-sm">{fmtRupiah(amTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>);
    })}</>;
  }

  const navbarFilterBar = (
    <div className="flex items-end gap-2 flex-nowrap overflow-x-auto">
      <div className="flex flex-col gap-1 shrink-0">
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Mode View</label>
        <button onClick={()=>setViewMode(v=>v==="split"?"all":"split")}
          className={cn("h-9 flex items-center gap-1.5 px-3 text-sm border rounded-lg transition-colors whitespace-nowrap font-semibold",
            viewMode==="split"?"bg-red-700 text-white border-red-700":"text-muted-foreground border-border hover:text-foreground")}>
          <Columns2 className="w-3.5 h-3.5"/>
          {viewMode==="split"?"Semua":"Par Divisi"}
        </button>
      </div>
      <div className="w-px h-9 bg-border/60 self-end shrink-0"/>
      <FSSelectDropdown label="Snapshot" value={String(importId||"")} onChange={v=>setImportId(Number(v))}
        options={snapshotOptions.length>0?snapshotOptions:[{value:"",label:"Belum ada data"}]}
        disabled={snapshotOptions.length===0} className="w-36 shrink-0"/>
      <div className="w-px h-9 bg-border/60 self-end shrink-0"/>
      <FSSelectDropdown label="Target" value={filterMode} onChange={v=>setFilterMode(v as "ho"|"fullho")}
        options={[{value:"ho",label:"HO"},{value:"fullho",label:"FULL (HO+BA)"}]}
        className="w-28 shrink-0"/>
      {kontrakOptions.length>0&&(
        <FSCheckboxDropdown label="Kategori Kontrak" options={kontrakOptions} selected={filterKontrak} onChange={setFilterKontrak}
          placeholder="Semua kontrak" summaryLabel="kontrak" className="w-36 shrink-0"/>
      )}
      <FSCheckboxDropdown label="Status Funnel" options={FS_PHASES} selected={filterStatus} onChange={setFilterStatus}
        placeholder="Semua status" labelFn={p=>`${p} – ${FS_PHASE_LABELS[p]}`} summaryLabel="status" className="w-36 shrink-0"/>
    </div>
  );

  const funnelNavbarPortalEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.getElementById("funnel-navbar-portal");
    if (el) funnelNavbarPortalEl.current = el;
  }, []);

  return (
    <>
      {/* Portal filter bar into navbar */}
      {funnelNavbarPortalEl.current && createPortal(navbarFilterBar, funnelNavbarPortalEl.current)}

      <div className="p-4 space-y-4">
      {/* ── Active filter chips — always visible below navbar ── */}
      <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] bg-card border border-border rounded-xl px-4 py-2.5">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">Filter aktif:</span>
        {/* Periode — always shows */}
        <span className="inline-flex shrink-0 items-center gap-1 bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1 rounded-full border border-primary/20">
          Periode: {filterYears.size===1
            ? (filterMonths.size===0
                ? `${filterYear} (semua bulan)`
                : filterMonths.size===1
                  ? `${FS_MONTHS_ID[parseInt([...filterMonths][0])]} ${filterYear}`
                  : `${filterMonths.size} bulan`)
            : filterYears.size===2
              ? `${[...filterYears].sort().reverse().join("+")}${filterMonths.size>0?` · ${filterMonths.size} bln`:" (semua)"}`
              : `${filterYears.size} tahun${filterMonths.size>0?` · ${filterMonths.size} bln`:" (semua)"}`}
          {filterMonths.size > 0 && <button onClick={() => setFilterMonths(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>}
        </span>
        {/* Target mode — always shows */}
        <span className="inline-flex shrink-0 items-center gap-1 bg-secondary text-muted-foreground text-xs font-semibold px-2.5 py-1 rounded-full border border-border">
          Target: {filterMode === "ho" ? "HO" : "FULL (HO+BA)"}
        </span>
        {filterKontrak.size > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-violet-200 dark:border-violet-800">
            Kontrak: {filterKontrak.size === 1 ? [...filterKontrak][0] : `${filterKontrak.size} terpilih`}
            <button onClick={() => setFilterKontrak(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>
          </span>
        )}
        {filterStatus.size > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800">
            Status: {filterStatus.size === 1 ? [...filterStatus][0] : `${filterStatus.size} status`}
            <button onClick={() => setFilterStatus(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>
          </span>
        )}
        {filterAm.size > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
            AM: {filterAm.size === 1 ? [...filterAm][0] : `${filterAm.size} AM`}
            <button onClick={() => setFilterAm(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>
          </span>
        )}
        {filterDurasi !== "all" && (
          <span className="inline-flex shrink-0 items-center gap-1 bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-teal-200 dark:border-teal-800">
            Durasi: {filterDurasi === "single_year" ? "Nilai per Tahun" : "Multi Year"}
            <button onClick={() => setFilterDurasi("all")} className="hover:opacity-70"><X className="w-3 h-3"/></button>
          </span>
        )}
        {filterTahunAnggaran.size > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-sky-200 dark:border-sky-800">
            T. Anggaran: {filterTahunAnggaran.size === 1 ? [...filterTahunAnggaran][0] : `${filterTahunAnggaran.size} tahun`}
            <button onClick={() => setFilterTahunAnggaran(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>
          </span>
        )}
        {(filterStatus.size > 0 || filterKontrak.size > 0 || filterDurasi !== "all" || filterMonths.size > 0 || filterAm.size > 0) && (
          <button onClick={() => { setFilterStatus(new Set()); setFilterKontrak(new Set()); setFilterDurasi("all"); setFilterMonths(new Set()); setFilterAm(new Set()); }}
            className="shrink-0 flex items-center gap-1 px-3 py-1 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            <X className="w-3 h-3"/> Reset filter
          </button>
        )}
      </div>

      {/* ── All mode: overview cards ───────────────────────────────────────── */}
      {viewMode!=="split"&&(isLoading?(
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl h-44 animate-pulse"/>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0,1].map(i=><div key={i} className="bg-card border border-border rounded-xl h-52 animate-pulse"/>)}
          </div>
          <div className="bg-card border border-border rounded-xl h-28 animate-pulse"/>
        </div>
      ):(
        <div className="space-y-4">
          {/* LOP per Fase + DPS/DSS — satu baris sejajar */}
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr_2fr] gap-4">
            {/* LOP per Fase */}
            <div className="bg-card border border-border rounded-xl p-4 shadow-sm min-w-0 flex flex-col">
              <h3 className="text-base font-display font-bold text-foreground mb-3">LOP per Fase</h3>
              <FSFaseBarChart data={data?{...data,byStatus:filteredStats.byStatus}:undefined}/>
              {data&&(()=>{
                const pm:Record<string,{count:number;nilai:number}>={};
                for(const p of FS_PHASES) pm[p]={count:0,nilai:0};
                for(const s of (filteredStats.byStatus||[])){if(pm[s.status]){pm[s.status].count=s.count;pm[s.status].nilai=s.totalNilai;}}
                return (
                  <div className="flex-1 flex flex-col mt-3 pt-3 border-t border-border/60">
                    <div className="flex-1 flex gap-1.5">
                      {FS_PHASES.map(phase=>{
                        const d=pm[phase];const c=FS_PHASE_COLORS[phase];
                        return (
                          <div key={phase} className="flex-1 min-w-0 bg-secondary/60 rounded-lg px-2.5 py-2.5 border border-border/50 flex flex-col justify-between">
                            <span className="text-xs font-black leading-none" style={{color:c.text,fontFamily:"Inter,sans-serif"}}>{phase}</span>
                            <span className="text-[17px] font-black tabular-nums leading-tight text-foreground truncate" style={{fontFamily:"Inter,sans-serif"}}>{fmtCompactFS(d.nilai)||"—"}</span>
                            <span className="text-[11px] font-bold text-muted-foreground tabular-nums leading-none">{d.count} LOP</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* DPS | DSS gauges */}
            {(["DPS","DSS"] as const).map(div=>{
              const tgtHo  =div==="DPS"?dpsTgtHo:dssTgtHo;
              const tgtFull=div==="DPS"?dpsTgtFullHo:dssTgtFullHo;
              const real   =div==="DPS"?dpsStats.totalNilai:dssStats.totalNilai;
              const divPct =div==="DPS"?dpsPct:dssPct;
              const crDiv  =crStats?.[div==="DPS"?"dps":"dss"];
              return (
                <div key={div} className="bg-card border border-border rounded-xl p-4 shadow-sm min-w-0">
                  <h3 className="text-base font-display font-bold text-foreground mb-2 flex items-center gap-2">
                    Capaian Real vs Target
                    <span className={cn("text-xs font-black px-2.5 py-0.5 rounded",
                      div==="DPS"?"bg-blue-100 text-blue-700":"bg-emerald-100 text-emerald-700"
                    )}>{div}</span>
                  </h3>
                  <FSGauge pct={divPct} targetHo={tgtHo} targetFullHo={tgtFull} real={real} mode={filterMode} divisi={div}/>
                  {crDiv&&(
                    <>
                      <div className="border-t border-border my-3"/>
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        Conversion Rate
                        <span className={cn("text-xs font-black px-2 py-0.5 rounded",
                          div==="DPS"?"bg-blue-100 text-blue-700":"bg-emerald-100 text-emerald-700"
                        )}>{div}</span>
                      </h4>
                      <FSCRGauge f5={crDiv.f5} denom={crDiv.denom} cr={crDiv.cr} divisi={div}/>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* KPI Ringkasan menggunakan filteredLops (period + kategori_kontrak + dll) */}
          <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <h3 className="text-sm font-display font-semibold text-foreground mb-3">Ringkasan</h3>
            <FSKpiGrid data={data?{
              ...data,
              totalLop:filteredLops.length,
              totalNilai:filteredLops.reduce((s:number,l:any)=>s+(l.nilaiProyek||0),0),
              pelangganCount:new Set(filteredLops.map((l:any)=>l.pelanggan).filter(Boolean)).size,
            }:undefined}/>
          </div>
        </div>
      ))}

      {/* ── All mode: detail table ─────────────────────────────────────────── */}
      {viewMode!=="split"&&<div className="bg-card border border-border rounded-xl shadow-sm">
        {/* Sticky toolbar — single scrollable row on mobile */}
        <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm border-b border-border">
          <div className="flex items-end gap-2 px-4 py-2.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <h3 className="text-base font-display font-bold text-foreground whitespace-nowrap shrink-0 pb-1">Detail Funnel per AM</h3>
            <div className="w-px h-8 bg-border/60 shrink-0"/>
            <FSCheckboxDropdown label="Filter AM" options={amOptions} selected={filterAm} onChange={setFilterAm}
              placeholder="Semua AM" labelFn={amLabelFn} summaryLabel="AM" className="w-40 shrink-0"/>
            <FSSelectDropdown label="Durasi Kontrak" value={filterDurasi} onChange={v=>setFilterDurasi(v as typeof filterDurasi)}
              options={[{value:"all",label:"Semua Durasi"},{value:"single_year",label:"Nilai per Tahun"},{value:"multi_year",label:"Multi Year (>12 bln)"}]}
              className="w-44 shrink-0"/>
            <div className="w-px h-8 bg-border/60 shrink-0"/>
            <FSPeriodeTreeDropdown label="Filter Report Date"
              filterYears={filterYears} filterMonths={filterMonths}
              availableYears={periodeAvailableYears}
              availableMonthsByYear={availableMonthsByYear}
              onChange={(ys,ms)=>{setFilterYears(ys);setFilterMonths(ms);setImportId(null);}}
              className="w-48 shrink-0"/>
            <FSCheckboxDropdown label="Tahun Anggaran" options={tahunAnggaranStringOptions} selected={filterTahunAnggaran} onChange={setFilterTahunAnggaran}
              placeholder="Pilih Tahun Anggaran" summaryLabel="T. Anggaran" className="w-48 shrink-0"/>
            <div className="flex flex-col gap-0.5 shrink-0">
              <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Pencarian Data LOP</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"/>
                <input ref={funnelSearchRef} type="text" placeholder="Cari AM, LOP ID, proyek, pelanggan, kategori…" value={search} onChange={e=>setSearch(e.target.value)}
                  className="pl-8 pr-7 py-1.5 text-sm bg-background border border-border rounded-lg w-72 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"/>
                {search&&<button onClick={()=>setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5"/></button>}
              </div>
            </div>
            {filterAm.size>0&&(<button onClick={()=>setFilterAm(new Set())} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 px-2 py-1.5 border border-border rounded-lg hover:border-destructive/30 transition-colors shrink-0 whitespace-nowrap"><X className="w-3 h-3"/> Reset AM</button>)}
            <button onClick={handleToggleAll} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap shrink-0">
              {allExpanded?<Minimize2 className="w-3.5 h-3.5"/>:<Expand className="w-3.5 h-3.5"/>}
              {allExpanded?"Collapse Semua":"Expand Semua AM"}
            </button>
          </div>
        </div>
        {/* Multi-table scroll container: tiap fase = tabel sendiri, thead-nya sticky bersama */}
        <div className="px-3 pb-3">
          <div ref={funnelTableRef} tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();e.currentTarget.scrollBy({top:80,behavior:"smooth"});}if(e.key==="ArrowUp"){e.preventDefault();e.currentTarget.scrollBy({top:-80,behavior:"smooth"});}}} className="border border-border rounded overflow-y-auto overflow-x-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" style={{maxHeight:"calc(100svh - 210px)"}}>
            {/* Header kolom — sticky di atas, pisah dari tabel AM agar tidak saling tarik */}
            <table ref={fsFunnelTheadRef} className="text-left text-sm" style={{...FS_TB_STYLE,position:"sticky",top:0,zIndex:20}}>
              <FSColGroup/>
              <thead>
                <tr className="text-white font-black uppercase tracking-wide text-xs">
                  <th className="px-4 py-3 text-left" style={{background:"#B91C1C"}}>Account Manager</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap" style={{background:"#B91C1C"}}>LOP</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap" style={{background:"#B91C1C"}}>Pelanggan</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap" style={{background:"#B91C1C"}}>Target 2026</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap" style={{background:"#B91C1C"}}>Nilai Proyek</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap" style={{background:"#B91C1C"}}>Conversion Rate</th>
                </tr>
              </thead>
            </table>
            {/* Per-AM + per-fase mini tables */}
            {renderAmTablesFS(groupedByAm, search?"Tidak ada data yang cocok dengan filter":"Belum ada data funnel")}
          </div>
        </div>
      </div>}

      {/* ── Split mode: DPS | DSS per-divisi panels ──────────────────────────── */}
      {viewMode==="split"&&(
        <div className="flex flex-col gap-4">
        {/* Row 1: Stats + Chart + Gauge (terpisah dari tabel) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(["DPS","DSS"] as const).map(div=>{
            const st=div==="DPS"?dpsStats:dssStats;
            const isDps=div==="DPS";
            const divLabel=isDps?"Private Service":"State Service";
            const accent=isDps?"#3b82f6":"#10b981";
            const textAccent=isDps?"text-blue-600":"text-emerald-600";
            const bgAccent=isDps?"bg-blue-50/40":"bg-emerald-50/40";
            const borderTop=isDps?"border-t-[3px] border-blue-500":"border-t-[3px] border-emerald-500";
            return (
              <div key={div} className={`bg-card border border-border rounded-xl shadow-sm overflow-hidden ${borderTop}`}>
                {/* Panel Header */}
                <div className={`px-4 py-3 border-b border-border ${bgAccent} flex items-center justify-between gap-3 flex-wrap`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-3.5 h-3.5 rounded-full shadow-sm shrink-0" style={{background:accent}}/>
                    <div className="min-w-0">
                      <div className="text-2xl font-black uppercase tracking-widest text-foreground leading-none">{div}</div>
                      <div className="text-sm font-black text-foreground/80 leading-tight mt-0.5">{divLabel}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Total LOP</div>
                      <div className={`text-3xl font-black tabular-nums leading-tight ${textAccent}`}>{st.totalLop}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Total Nilai</div>
                      <div className={`text-sm font-black tabular-nums ${textAccent}`}>{formatRupiah(st.totalNilai)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Pelanggan</div>
                      <div className="text-sm font-black tabular-nums text-foreground">{st.pelangganCount}</div>
                    </div>
                  </div>
                </div>
                {/* Bar chart + Gauge capaian */}
                <div className="flex gap-0">
                  <div className="flex-1 min-w-0 px-4 py-2.5 border-r border-border">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">LOP per Fase</div>
                    <FSFaseBarChart data={data?{...data,byStatus:st.byStatus}:undefined} compact/>
                  </div>
                  <div className="shrink-0 flex flex-col items-center justify-center px-3 py-2">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide text-center mb-0.5">
                      Capaian {filterMode==="ho"?"HO":"FULL (HO+BA)"}
                    </div>
                    <FSGauge
                      compact
                      pct={div==="DPS"?(dpsTgt?dpsStats.totalNilai/dpsTgt*100:0):(dssTgt?dssStats.totalNilai/dssTgt*100:0)}
                      targetHo={div==="DPS"?dpsTgtHo:dssTgtHo}
                      targetFullHo={div==="DPS"?dpsTgtFullHo:dssTgtFullHo}
                      real={st.totalNilai}
                      mode={filterMode}
                      divisi={div}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Row 2: Tabel AM — full width, toggle DPS/DSS */}
        {(()=>{
          const div=splitTableDiv;
          const st=div==="DPS"?dpsStats:dssStats;
          const grp=div==="DPS"?dpsGrouped:dssGrouped;
          const isDps=div==="DPS";
          const headerBg=isDps?"bg-blue-700":"bg-emerald-700";
          const borderTop=isDps?"border-t-[3px] border-blue-500":"border-t-[3px] border-emerald-500";
          return (
            <div className={`bg-card border border-border rounded-xl shadow-sm flex flex-col ${borderTop}`}>
              {/* Table Toolbar */}
              <div className="px-3 py-2 border-b border-border bg-secondary/20 flex items-center justify-between gap-2 shrink-0 flex-wrap">
                <div className="flex items-center gap-3">
                  {/* Toggle DPS / DSS */}
                  <div className="flex rounded-lg overflow-hidden border border-border text-xs font-bold">
                    <button
                      onClick={()=>setSplitTableDiv("DPS")}
                      className={cn("px-3 py-1.5 transition-colors",
                        div==="DPS"?"bg-blue-600 text-white":"bg-background text-muted-foreground hover:text-foreground"
                      )}
                    >DPS</button>
                    <button
                      onClick={()=>setSplitTableDiv("DSS")}
                      className={cn("px-3 py-1.5 border-l border-border transition-colors",
                        div==="DSS"?"bg-emerald-600 text-white":"bg-background text-muted-foreground hover:text-foreground"
                      )}
                    >DSS</button>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">{grp.length} AM · {st.totalLop} LOP</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none"/>
                    <input type="text" placeholder="Cari AM, LOP, pelanggan…" value={search} onChange={e=>setSearch(e.target.value)}
                      className="pl-6 pr-5 py-1 text-xs bg-background border border-border rounded-md w-52 focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"/>
                    {search&&<button onClick={()=>setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3"/></button>}
                  </div>
                  <button onClick={handleToggleAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1 transition-colors whitespace-nowrap">
                    {allExpanded?<Minimize2 className="w-3 h-3"/>:<Expand className="w-3 h-3"/>}
                    {allExpanded?"Collapse":"Expand"}
                  </button>
                </div>
              </div>
              {/* AM Tree Table — full width, horizontal scroll */}
              <div className="p-3">
              <div className="border border-border rounded">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse" style={{minWidth:"600px"}}>
                  <thead>
                    <tr className={`${headerBg} text-white font-black uppercase tracking-wide text-xs`}>
                      <th className="px-4 py-2.5 min-w-[240px] text-left">Account Manager</th>
                      <th className="px-3 py-2.5 whitespace-nowrap text-left">LOP</th>
                      <th className="px-3 py-2.5 whitespace-nowrap text-left">Pelanggan</th>
                      <th className="px-3 py-2.5 min-w-[210px] text-center">Target 2026</th>
                      <th className="px-3 py-2.5 min-w-[200px] text-left">Nilai Proyek</th>
                      <th className="px-4 py-2.5 min-w-[130px] text-right whitespace-nowrap">Conversion Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {renderAmTbodyContentFS(grp,`Tidak ada AM ${div}`,div)}
                  </tbody>
                </table>
              </div>
              </div>
              </div>
            </div>
          );
        })()}
        </div>
      )}

    </div>
    </>
  );
}

// ─── Activity Slide ──────────────────────────────────────────────────────────────

const ACT_MONTHS_FULL = ["","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const ACT_MONTHS_SHORT = ["","Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
const ACT_DAYS_ID = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
const ACT_TYPE_STYLE: Record<string,{bg:string;text:string}> = {
  "Kunjungan":    {bg:"#e3f2fd",text:"#1565C0"},
  "Administrasi": {bg:"#f3e5f5",text:"#6a1b9a"},
  "Follow-up":    {bg:"#e8f5e9",text:"#2e7d32"},
  "Penawaran":    {bg:"#fff3e0",text:"#e65100"},
  "Koordinasi":   {bg:"#fce4ec",text:"#880e4f"},
  "Negosiasi":    {bg:"#e0f7fa",text:"#00695c"},
};
function actTypeSty(t:string|null){return t&&ACT_TYPE_STYLE[t]?ACT_TYPE_STYLE[t]:{bg:"#f1f5f9",text:"#475569"};}
function actLabelSty(l:string|null){
  if(!l) return {cls:"bg-slate-100 text-slate-500",short:"–"};
  const ll=l.toLowerCase();
  if(ll.includes("tanpa")) return {cls:"bg-slate-100 text-slate-500",short:"Tanpa Pelanggan"};
  if(ll.includes("proyek")) return {cls:"bg-teal-50 text-teal-700",short:"Dg Proyek"};
  return {cls:"bg-blue-50 text-blue-700",short:"Dg Pelanggan"};
}
function actFmtDate(d:string|null):{short:string;day:string}{
  if(!d) return {short:"—",day:""};
  try{
    const dt=new Date(d);
    const dd=String(dt.getDate()).padStart(2,"0");
    const mm=String(dt.getMonth()+1).padStart(2,"0");
    return {short:`${dd}/${mm}`,day:`${ACT_DAYS_ID[dt.getDay()]}, ${ACT_MONTHS_SHORT[dt.getMonth()+1]} ${dt.getFullYear()}`};
  }catch{return {short:d.slice(5,10).replace("-","/"),day:""};}
}

// Column grid for ActivitySlide table
const ACT_GRID_COLS = "32px 1fr 240px 100px 72px 64px 110px";

function ActivityPeriodeDropdown({filterYear,setFilterYear,filterMonths,setFilterMonths}:{
  filterYear:string; setFilterYear:(y:string)=>void;
  filterMonths:Set<string>; setFilterMonths:(m:Set<string>)=>void;
}) {
  const YEARS = ["2026","2025","2024"];
  const [open,setOpen] = useState(false);
  const [pos,setPos] = useState({top:0,left:0});
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{
      if(triggerRef.current&&!triggerRef.current.contains(e.target as Node)&&
         dropRef.current&&!dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);
  const allSelected = filterMonths.size===0;
  const displayLabel = allSelected
    ? `${filterYear} (semua bulan)`
    : filterMonths.size===1
      ? `${ACT_MONTHS_FULL[parseInt([...filterMonths][0])]} ${filterYear}`
      : `${filterYear} · ${filterMonths.size} bulan`;
  const toggleYearCheckbox=(y:string)=>{
    if(y!==filterYear){setFilterYear(y);setFilterMonths(new Set());return;}
    if(allSelected) setFilterMonths(new Set([String(new Date().getMonth()+1).padStart(2,"0")]));
    else setFilterMonths(new Set());
  };
  const toggleMonth=(m:string)=>{
    const normalized = m.padStart(2, "0"); // ensure "9" -> "09" for consistency
    if(allSelected){setFilterMonths(new Set([normalized]));return;}
    const n=new Set([...filterMonths].map(v=>v.padStart(2,"0")));
    if(n.has(normalized)) n.delete(normalized); else n.add(normalized);
    if(n.size===0||n.size===12) setFilterMonths(new Set());
    else setFilterMonths(n);
  };
  const toggleOpen=()=>{
    if(triggerRef.current){const r=triggerRef.current.getBoundingClientRect();setPos({top:r.bottom+4,left:r.left});}
    setOpen(o=>!o);
  };
  return (
    <div className="flex flex-col gap-1 shrink-0 w-44" ref={triggerRef}>
      <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Periode</label>
      <button type="button" onClick={toggleOpen}
        className={cn("h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full transition-colors text-left",open&&"border-primary/50 ring-2 ring-primary/20")}>
        <span className="flex-1 truncate font-medium text-foreground">{displayLabel}</span>
        {!allSelected&&<span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">{filterMonths.size}</span>}
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",open&&"rotate-180")}/>
      </button>
      {open&&createPortal(
        <div ref={dropRef} style={{position:"fixed",top:pos.top,left:pos.left,zIndex:9999}}
          className="bg-card border border-border rounded-xl shadow-xl w-52 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">PERIODE</span>
            <div className="flex gap-1.5">
              <button onClick={()=>setFilterMonths(new Set())} className="text-[11px] text-primary font-semibold hover:underline">Semua</button>
              <span className="text-muted-foreground text-[11px]">·</span>
              <button onClick={()=>{setFilterYear(String(new Date().getFullYear()));setFilterMonths(new Set([String(new Date().getMonth()+1).padStart(2,"0")]));}} className="text-[11px] text-muted-foreground font-semibold hover:underline">Reset</button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {YEARS.map(y=>{
              const isActive=y===filterYear;
              const yearAllSel=isActive&&allSelected;
              const yearPartial=isActive&&!allSelected;
              return (
                <React.Fragment key={y}>
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-secondary transition-colors cursor-pointer">
                    <span onClick={()=>toggleYearCheckbox(y)}
                      className={cn("w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                        yearAllSel?"bg-primary border-primary":yearPartial?"border-primary bg-primary/10":"border-border")}>
                      {yearAllSel&&<span className="text-white text-[9px] font-black">✓</span>}
                      {yearPartial&&<span className="text-primary text-[9px] font-black leading-none">–</span>}
                    </span>
                    <span className={cn("flex-1 text-sm font-semibold",isActive?"text-primary":"text-foreground")}
                      onClick={()=>{if(!isActive){setFilterYear(y);setFilterMonths(new Set());}else toggleYearCheckbox(y);}}>
                      {y}
                    </span>
                  </div>
                  {isActive&&ACT_MONTHS_FULL.slice(1).map((mName,idx)=>{
                    const mNum=String(idx+1).padStart(2,"0");
                    const checked=!allSelected&&[...filterMonths].map(v=>v.padStart(2,"0")).includes(mNum);
                    return (
                      <button key={mNum} onClick={()=>toggleMonth(mNum)}
                        className={cn("w-full text-left pl-9 pr-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2 transition-colors",
                          checked?"font-medium text-primary bg-primary/5":"text-foreground")}>
                        <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",
                          checked?"bg-primary border-primary":"border-border")}>
                          {checked&&<span className="text-white text-[8px] font-black">✓</span>}
                        </span>
                        {mName}
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ActivitySlide() {
  const now = new Date();
  const [filterYear,  setFilterYear]  = useState(String(now.getFullYear()));
  const [filterMonths, setFilterMonths] = useState<Set<string>>(new Set()); // shows all months by default
  const [filterDivisi, setFilterDivisi] = useState("LESA");
  const [filterSnapId, setFilterSnapId] = useState<string>("all");
  const [filterKategori, setFilterKategori] = useState<Set<string>>(new Set());
  const snapInitialized = useRef(false);
  const [expandedAm, setExpandedAm] = useState<Record<string,boolean>>({});
  const [actSearch, setActSearch] = useState("");
  const [actExpandAll, setActExpandAll] = useState<boolean|null>(null);
  const [actSortBy, setActSortBy] = useState<"default"|"highest"|"lowest">("default");
  const actSearchRef = useRef<HTMLInputElement>(null);
  // Only auto-set months once per snapshot — reset when snapshot changes
  const monthAutoSetForSnap = useRef<string>("");

  // Sync horizontal scroll between sticky header and scrollable body
  const actHeaderScrollRef = useRef<HTMLDivElement>(null);
  const actBodyScrollRef = useRef<HTMLDivElement>(null);
  const actTableRef = useRef<HTMLDivElement>(null);
  const onActBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (actHeaderScrollRef.current) actHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }, []);
  const onActHeaderScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (actBodyScrollRef.current) actBodyScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }, []);

  // Sticky height measurement for per-AM sticky rows
  const actToolbarRef = useRef<HTMLDivElement>(null);
  const [actToolbarH, setActToolbarH] = useState(93);
  const [actAmSumRowH, setActAmSumRowH] = useState(70);
  useEffect(()=>{
    const el=actToolbarRef.current;
    if(!el) return;
    const obs=new ResizeObserver(([e])=>setActToolbarH(e.contentRect.height));
    obs.observe(el);
    return ()=>obs.disconnect();
  },[]);
  const actAmSumRowCallbackRef = useCallback((el: HTMLDivElement|null)=>{
    if(!el) return;
    const obs=new ResizeObserver(([e])=>setActAmSumRowH(e.contentRect.height));
    obs.observe(el);
  },[]);

  // ── Keyboard shortcuts (active only when ActivitySlide is mounted = slide 2 is active) ──
  useEffect(()=>{
    function onKey(e:KeyboardEvent){
      const t=e.target as HTMLElement;
      const inInput=t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable;
      if(inInput) return;
      if(e.key==="e"||e.key==="E"){ e.preventDefault(); setActExpandAll(p=>p===true?false:true); }
      if(e.key==="Escape"){ setActExpandAll(false); setExpandedAm({}); setActSearch(""); }
      if(e.key==="/"){ e.preventDefault(); actSearchRef.current?.focus(); }
      if(e.key==="t"||e.key==="T"){ e.preventDefault(); actTableRef.current?.focus(); }
    }
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[]);

  const divisiOptions = DIVISI_OPTIONS;

  // Read snapshot from URL param ?snapshot=160
  const urlSnapId = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("snapshot");
  }, []);

  // ─── Snapshots ──────────────────────────────────────────────────────────
  const {data:actSnaps=[]} = useQuery<any[]>({
    queryKey:["activity-snapshots-slide"],
    queryFn:async()=>{
      const r=await fetch(`${BASE_PATH}/api/public/activity/snapshots`);
      if(!r.ok) return [];
      return r.json();
    },
    staleTime:60_000,
  });

  const snapOptions = useMemo(()=>[
    ...(Array.isArray(actSnaps)?actSnaps:[]).map((s:any)=>{
      let lbl = s.period ? periodLabelFS(s.period) : `Import #${s.id}`;
      if(s.snapshotDate){
        try{
          const d=new Date(s.snapshotDate);
          lbl=`${d.getDate()} ${ACT_MONTHS_SHORT[d.getMonth()+1]} ${d.getFullYear()}${s.period?` — ${periodLabelFS(s.period)}`:""}`;
        }catch{/**/}
      }
      return {value:String(s.id),label:lbl};
    }),
  ],[actSnaps]);

  // Auto-select snapshot: prefer URL param, fallback to latest snapshot
  useEffect(()=>{
    if(!Array.isArray(actSnaps)||actSnaps.length===0) return;
    if(!snapInitialized.current){
      snapInitialized.current=true;
      // If URL has ?snapshot=NNN, use it if it exists in snapshots
      if(urlSnapId){
        const found=actSnaps.some((s:any)=>String(s.id)===urlSnapId);
        setFilterSnapId(found?urlSnapId:String(actSnaps[0].id));
      } else {
        setFilterSnapId(String(actSnaps[0].id));
      }
    }
  },[actSnaps, urlSnapId]);

  // ─── Query ──────────────────────────────────────────────────────────────
  const queryUrl = useMemo(()=>{
    const p=new URLSearchParams({year:filterYear,divisi:filterDivisi});
    if(filterMonths.size>0) p.set("months",[...filterMonths].join(","));
    if(filterSnapId!=="all") p.set("import_id",filterSnapId);
    return `/api/public/activity?${p}`;
  },[filterYear,filterMonths,filterDivisi,filterSnapId]);

  const {data,isLoading} = useQuery<any>({
    queryKey:["activity-slide",queryUrl],
    queryFn:async()=>{const r=await fetch(`${BASE_PATH}${queryUrl}`);if(!r.ok)return null;return r.json();},
    staleTime:0,
    refetchOnWindowFocus:true,
  });

  // Auto-select latest month from snapshot data — runs ONCE per snapshot
  useEffect(()=>{
    if(!data) return;
    const avail = data.availableMonths;
    if(!Array.isArray(avail)||avail.length===0) return;
    // Skip if already auto-set for this snapshot
    if(monthAutoSetForSnap.current === filterSnapId) return;
    monthAutoSetForSnap.current = filterSnapId;
    const latest = avail[0]; // "YYYY-MM", sorted reverse (latest first)
    const yr = latest.slice(0,4);
    const mo = latest.slice(5,7);
    setFilterYear(yr);
    setFilterMonths(new Set([mo]));
  },[data, filterSnapId]);

  const {data:actSettingsData} = useQuery<any>({
    queryKey:["settings-kpi-slide"],
    queryFn:async()=>{const r=await fetch(`${BASE_PATH}/api/public/settings`).catch(()=>null);if(!r||!r.ok)return null;return r.json();},
    staleTime:0,
    refetchOnWindowFocus:true,
  });
  // Prioritas: (1) kpiDefault dari activity API response (sama-sama baca DB, satu fetch)
  //            (2) kpiActivityDefault dari settings API (fallback jika activity belum loaded)
  //            (3) hardcoded 30 (last resort)
  const actSettingsKpi:number = (data as any)?.kpiDefault ?? actSettingsData?.kpiActivityDefault ?? 30;


  const amList = useMemo(()=>{
    if(!data) return [];
    const byAmMap=Object.fromEntries((data.byAm||[]).map((a:any)=>[a.fullname,a]));
    return (data.masterAms||[])
      // Include AMs that have activities (multi-divisi support) OR master divisi matches
      .filter((m:any)=>byAmMap[m.nama]!==undefined || matchesDivisi(m.divisi, filterDivisi))
      .filter((m:any)=>{
        if(!actSearch) return true;
        const q=actSearch.toLowerCase();
        if(m.nama.toLowerCase().includes(q)||m.nik?.toLowerCase().includes(q)) return true;
        const ex=byAmMap[m.nama];
        if(!ex) return false;
        return ex.activities.some((act:any)=>
          act.activityType?.toLowerCase().includes(q)||
          act.label?.toLowerCase().includes(q)||
          act.caName?.toLowerCase().includes(q)||
          act.activityNotes?.toLowerCase().includes(q)||
          act.picName?.toLowerCase().includes(q)
        );
      })
      .map((m:any)=>{
        const ex=byAmMap[m.nama];
        const perAmOverride=ex?.perAmKpiTarget;
        // kpiTarget = nilai settingan saja, tidak dikalikan jumlah bulan
        const baseKpiTarget=perAmOverride??actSettingsKpi;
        const baseActs=(ex?.activities||[]);
        const activityDivisis=Array.from(new Set(baseActs.map((a:any)=>a.divisi).filter(Boolean)));
        const base=ex
          ?{...ex,activities:baseActs,kpiTarget:baseKpiTarget,activityDivisis}
          :{nik:m.nik,fullname:m.nama,divisi:m.divisi,kpiCount:0,totalCount:0,kpiTarget:baseKpiTarget,activities:[],activityDivisis:matchesDivisi(m.divisi,filterDivisi)?[m.divisi]:[]};
        const visibleActs=filterKategori.size===0?base.activities:base.activities.filter((a:any)=>filterKategori.has(a.label));
        return {...base,visibleActivities:visibleActs};
      });
  },[data,filterDivisi,actSearch,filterKategori,actSettingsKpi]);

  const stats = useMemo(()=>{
    // visibleActivities sudah difilter oleh filterKategori
    const visAll=amList.reduce((s:number,a:any)=>s+(a.visibleActivities||[]).length,0);
    const totalDgPelanggan=amList.reduce((s:number,a:any)=>s+(a.visibleActivities||[]).filter((x:any)=>(x.label||"").toLowerCase()==="dengan pelanggan").length,0);
    const totalDgProyek=amList.reduce((s:number,a:any)=>s+(a.visibleActivities||[]).filter((x:any)=>(x.label||"").toLowerCase()==="pelanggan dengan proyek").length,0);
    const totalTanpa=amList.reduce((s:number,a:any)=>s+(a.visibleActivities||[]).filter((x:any)=>(x.label||"").toLowerCase()==="tanpa pelanggan").length,0);
    const totalKpi=totalDgPelanggan+totalDgProyek;
    const reach=amList.filter((a:any)=>{
      const kpiActs=(a.visibleActivities||[]).filter((x:any)=>(x.label||"").toLowerCase()!=="tanpa pelanggan").length;
      return kpiActs>=(a.kpiTarget||0);
    }).length;
    return {totalKpi,totalAll:visAll,totalDgPelanggan,totalDgProyek,totalTanpa,reach,below:amList.length-reach};
  },[amList]);

  const periodLabel = useMemo(()=>{
    const months=[...filterMonths].sort((a,b)=>parseInt(a)-parseInt(b));
    if(months.length===0) return `Tahun ${filterYear}`;
    if(months.length===1) return `${ACT_MONTHS_FULL[parseInt(months[0])]} ${filterYear}`;
    return `${months.map(m=>ACT_MONTHS_SHORT[parseInt(m)]).join(", ")} ${filterYear}`;
  },[filterMonths,filterYear]);

  const allLabels = useMemo(()=>data?.distinctLabels||[],[data]);

  // Auto-select all labels on first data load
  const allLabelsInitialized = useRef(false);
  useEffect(()=>{
    if(allLabels.length>0&&!allLabelsInitialized.current){
      allLabelsInitialized.current=true;
      setFilterKategori(new Set(allLabels));
    }
  },[allLabels]);

  // ─── Filter bar ─────────────────────────────────────────────────────────
  const isActPeriodFiltered = filterMonths.size > 0;
  const isActDivisiFiltered = filterDivisi !== "LESA";
  const isActKategoriFiltered = filterKategori.size > 0 && filterKategori.size < allLabels.length;
  const actHasActiveFilter = isActPeriodFiltered || isActDivisiFiltered || isActKategoriFiltered;

  const resetActFilters = () => {
    const now2 = new Date();
    setFilterMonths(new Set([String(now2.getMonth() + 1)]));
    setFilterYear(String(now2.getFullYear()));
    setFilterDivisi("LESA");
    const kpiLabels2 = allLabels.filter((l: string) => !l.toLowerCase().includes("tanpa"));
    setFilterKategori(new Set(kpiLabels2));
  };

  // ─── Filter bar portal ─────────────────────────────────────────────────────
  const navbarPortalEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.getElementById("activity-navbar-portal");
    if (el) navbarPortalEl.current = el;
  }, []);

  // ─── Filter bar — portal into navbar ────────────────────────────────────
  const filterBar = (
    <div className="flex items-center gap-3 flex-wrap">
      <FSSelectDropdown label="Snapshot" value={filterSnapId} onChange={setFilterSnapId}
        options={snapOptions} className="w-44 shrink-0"/>
      <ActivityPeriodeDropdown
        filterYear={filterYear} setFilterYear={setFilterYear}
        filterMonths={filterMonths} setFilterMonths={setFilterMonths}/>
      <FSCheckboxDropdown label="Kategori" options={allLabels} selected={filterKategori} onChange={setFilterKategori}
        summaryLabel="kategori" className="w-44 shrink-0" placeholder="Semua"/>
      <FSSelectDropdown label="Divisi" value={filterDivisi} onChange={setFilterDivisi}
        options={divisiOptions} className="w-28 shrink-0"/>
    </div>
  );

  return (
    <>
      {/* Portal filter bar into navbar */}
      {navbarPortalEl.current && createPortal(filterBar, navbarPortalEl.current)}

      <div className="p-4 space-y-4">
      {/* Active filter chips — always visible below navbar */}
      <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] bg-card border border-border rounded-xl px-4 py-2.5">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">Filter aktif:</span>
        {/* Periode — always shows */}
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border",
          isActPeriodFiltered ? "bg-primary/10 text-primary border-primary/20" : "bg-secondary text-muted-foreground border-border")}>
          Periode: {filterMonths.size === 0
            ? `${filterYear} (semua bulan)`
            : filterMonths.size === 1
              ? `${ACT_MONTHS_FULL[parseInt([...filterMonths][0])]} ${filterYear}`
              : `${filterMonths.size} bulan`}
          {isActPeriodFiltered && <button onClick={() => setFilterMonths(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>}
        </span>
        {/* Divisi — always shows */}
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border",
          isActDivisiFiltered ? "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 border-blue-200 dark:border-blue-800" : "bg-secondary text-muted-foreground border-border")}>
          Divisi: {filterDivisi}
          {isActDivisiFiltered && <button onClick={() => setFilterDivisi("LESA")} className="hover:opacity-70"><X className="w-3 h-3"/></button>}
        </span>
        {/* Kategori — always shows */}
        <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border",
          isActKategoriFiltered ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800" : "bg-secondary text-muted-foreground border-border")}>
          Kategori: {filterKategori.size === 0 ? "Semua" : filterKategori.size === allLabels.length ? `Semua (${allLabels.length})` : filterKategori.size === 1 ? [...filterKategori][0] : `${filterKategori.size} kategori`}
          {isActKategoriFiltered && <button onClick={() => setFilterKategori(new Set())} className="hover:opacity-70"><X className="w-3 h-3"/></button>}
        </span>
        {actHasActiveFilter && (
          <button onClick={resetActFilters}
            className="shrink-0 flex items-center gap-1 px-3 py-1 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
            <X className="w-3 h-3"/> Reset filter
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Memuat data aktivitas...</div>
      ) : !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Belum ada data aktivitas</div>
      ) : (
        <>
          {/* ─── Overview Cards (3 only) ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Card 1: Total Semua Aktivitas */}
            <div className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 bg-primary/10 text-primary">🎯</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-foreground uppercase tracking-wide mb-1">Total Semua Aktivitas</div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-3xl font-black tabular-nums leading-tight text-foreground">{stats.totalAll}</div>
                  <span className="text-sm font-bold text-foreground/70 leading-snug">
                    {stats.totalDgPelanggan} dg pelanggan{" · "}{stats.totalDgProyek} dg proyek{" · "}{stats.totalTanpa} tanpa
                  </span>
                </div>
              </div>
            </div>
            {/* Card 2: AM Capai KPI */}
            <div className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30">✅</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-foreground uppercase tracking-wide mb-1">AM Capai KPI</div>
                <div className="text-3xl font-black tabular-nums leading-tight text-foreground">{stats.reach}</div>
                <div className="text-sm font-bold text-foreground mt-1">target <strong className="text-primary">≥{amList[0]?.kpiTarget??actSettingsKpi} aktivitas</strong> / bulan</div>
              </div>
            </div>
            {/* Card 3: AM Di Bawah KPI */}
            <div className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 bg-red-50 text-red-500 dark:bg-red-950/30">⚠️</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-foreground uppercase tracking-wide mb-1">AM Di Bawah KPI</div>
                <div className="text-3xl font-black tabular-nums leading-tight text-foreground">{stats.below}</div>
                <div className="text-sm font-bold text-primary mt-1">{stats.below===0?"Semua AM mencapai target 🎉":`${stats.below} AM perlu perhatian lebih`}</div>
              </div>
            </div>
          </div>

          {/* ─── Info note ─── */}
          <div className="flex items-start gap-2.5 text-sm font-medium text-foreground/80 bg-secondary/60 border border-border/60 rounded-xl px-4 py-3.5">
            <span className="mt-0.5 shrink-0 text-base">📌</span>
            <span>
              Progress KPI dihitung dari aktivitas kategori <strong className="text-primary font-bold">Dengan Pelanggan</strong> dan <strong className="text-primary font-bold">Pelanggan dengan Proyek</strong> saja. Kategori <strong className="text-primary font-bold">Tanpa Pelanggan</strong> tidak terhitung dalam capaian KPI.
            </span>
          </div>

          {/* ─── Table ─── */}
          <div ref={actTableRef} tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();e.currentTarget.scrollBy({top:80,behavior:"smooth"});}if(e.key==="ArrowUp"){e.preventDefault();e.currentTarget.scrollBy({top:-80,behavior:"smooth"});}}} className="overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-xl" style={{maxHeight:"calc(100svh - 245px)"}}>
          <div className="mx-2">
          <div className="bg-card border border-border rounded-xl shadow-sm">

            {/* ── Sticky: Toolbar + Table Header ── */}
            <div ref={actToolbarRef} className="sticky top-0 z-10 rounded-t-xl overflow-hidden bg-card border-b border-border">
              {/* Toolbar */}
              <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-bold text-foreground">Monitoring KPI Aktivitas</span>
                  <span className="bg-secondary border border-border text-foreground text-xs font-bold px-2 py-0.5 rounded-full shrink-0">{amList.length} AM</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="h-8 flex items-center gap-2 bg-background border border-border rounded-lg px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors min-w-[220px]">
                    <Search className="w-3 h-3 text-muted-foreground shrink-0"/>
                    <input ref={actSearchRef} type="text" placeholder="Cari AM, tipe, label, pelanggan, catatan…" value={actSearch} onChange={e=>setActSearch(e.target.value)}
                      className="border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 bg-transparent flex-1 min-w-0"/>
                  </div>
                  <button onClick={()=>setActExpandAll(prev=>prev===true?false:true)}
                    className="h-8 px-3 rounded-lg text-xs font-semibold border border-border bg-secondary hover:border-primary/40 hover:text-primary text-foreground transition-colors flex items-center gap-1.5">
                    {actExpandAll===true
                      ?<><Minimize2 className="w-3 h-3"/> Collapse</>
                      :<><Expand className="w-3 h-3"/> Expand</>
                    }
                  </button>
                  <div className="h-8 flex items-center gap-2 bg-background border border-border rounded-lg px-2.5 shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Urutkan:</span>
                    <button onClick={() => setActSortBy(actSortBy === "highest" ? "lowest" : actSortBy === "lowest" ? "default" : "highest")}
                      className={cn(
                        "h-6 px-2.5 rounded text-[11px] font-bold transition-colors",
                        actSortBy === "highest" ? "bg-emerald-500 text-white" : actSortBy === "lowest" ? "bg-red-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
                      )}>
                      {actSortBy === "highest" ? "↑ Tertinggi" : actSortBy === "lowest" ? "↓ Terendah" : "Default"}
                    </button>
                  </div>
                </div>
              </div>
              {/* Table header row — syncs horizontally with body */}
              <div
                ref={actHeaderScrollRef}
                onScroll={onActHeaderScroll}
                className="overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                <div style={{minWidth:"780px"}}>
                  <div className="grid text-sm font-semibold uppercase tracking-wide text-white font-display"
                    style={{background:"#B91C1C",gridTemplateColumns:ACT_GRID_COLS,padding:"10px 16px"}}>
                    <div/><div className="pl-1">Nama AM</div><div>Progress KPI</div>
                    <div className="text-center">Aktivitas</div><div className="text-center">Target</div><div className="text-center">Sisa</div><div>Status</div>
                  </div>
                </div>
              </div>
            </div>{/* end sticky */}

            {/* ── Scrollable body ── */}
            <div ref={actBodyScrollRef}>
            <div style={{minWidth:"780px"}}>
            {/* (header is now in sticky section above) */}

            {amList.length===0?(
              <div className="text-center py-12 text-sm text-muted-foreground">Tidak ada data untuk filter yang dipilih.</div>
            ):(actSortBy === "highest"
              ? [...amList].sort((a,b) => (b.kpiCount||0) - (a.kpiCount||0))
              : actSortBy === "lowest"
                ? [...amList].sort((a,b) => (a.kpiCount||0) - (b.kpiCount||0))
                : amList
            ).map((am:any,amIdx:number)=>{
              const kpiCount=am.kpiCount||0;
              const visibleActs=am.visibleActivities||[];
              const visibleKpi=visibleActs.filter((a:any)=>a.isKpi).length;
              const visibleNonKpi=visibleActs.length-visibleKpi;
              const nonKpiCount=(am.activities||[]).length-kpiCount;
              const pct=Math.min(Math.round(kpiCount/am.kpiTarget*100),100);
              const sisa=Math.max(am.kpiTarget-kpiCount,0);
              const hasActs=(am.activities||[]).length>0;
              const isExpanded=actExpandAll!==null?actExpandAll:(expandedAm[am.fullname]||false);
              const progressGrad=pct>=100?"from-emerald-500 to-emerald-400":pct>=70?"from-amber-500 to-amber-400":"from-red-600 to-red-500";
              const pctClr=pct>=100?"text-emerald-600 dark:text-emerald-400":pct>=70?"text-amber-600 dark:text-amber-400":"text-red-600 dark:text-red-400";
              return (
                <div key={am.nik+am.fullname}
                  className={cn("border-b border-border/50 last:border-b-0 transition-all",isExpanded&&"relative z-[5] border-b-0")}
                  style={isExpanded?{outline:"2px solid #B91C1C",outlineOffset:"-1px",borderRadius:6,marginBottom:6}:{}}>
                  {/* ── Combined sticky wrapper: AM row + sub-header together ── */}
                  <div
                    ref={isExpanded?actAmSumRowCallbackRef:undefined}
                    style={isExpanded?{position:"sticky" as const,top:actToolbarH,zIndex:12,boxShadow:"0 2px 8px rgba(0,0,0,0.09)"}:{}}
                  >
                  <div
                    onClick={()=>{setActExpandAll(null);setExpandedAm(p=>({...p,[am.fullname]:!p[am.fullname]}));}}
                    className={cn("grid items-center px-4 py-3 cursor-pointer transition-colors group",
                      isExpanded?"bg-card border-b border-primary/20":"hover:bg-secondary/40")}
                    style={{gridTemplateColumns:ACT_GRID_COLS}}
                  >
                    {/* Expand icon */}
                    <div className={cn("w-6 h-6 rounded-lg border flex items-center justify-center text-xs font-bold shrink-0 transition-all",
                      isExpanded?"bg-primary border-primary text-white":"bg-secondary border-border text-muted-foreground group-hover:border-primary/40 group-hover:text-primary/70")}>
                      {isExpanded?"−":"+"}
                    </div>

                    {/* Name + divisi */}
                    <div className="overflow-hidden pl-1">
                      <div className="text-sm font-bold text-foreground truncate">{am.fullname}</div>
                      <div className="text-xs font-semibold text-foreground/70 mt-0.5 flex items-center gap-1 flex-wrap">
                        {(am.activityDivisis as string[])?.length
                          ? (am.activityDivisis as string[]).map((d:string)=>(
                              <span key={d} className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",
                                d==="DPS"?"bg-blue-100 text-blue-700"
                                :d==="DSS"?"bg-emerald-100 text-emerald-700"
                                :"bg-slate-100 text-slate-600"
                              )}>{d}</span>
                            ))
                          : am.divisi ? (
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",
                                am.divisi==="DPS"?"bg-blue-100 text-blue-700"
                                :am.divisi==="DSS"?"bg-emerald-100 text-emerald-700"
                                :"bg-slate-100 text-slate-600"
                              )}>{am.divisi}</span>
                            ) : null
                        }
                        {!hasActs&&<span className="text-foreground/40 font-normal italic text-[11px]">· tidak ada data</span>}
                        {hasActs&&<span className="text-foreground/60 font-semibold">· {visibleActs.length}{visibleActs.length!==am.activities.length?`/${am.activities.length}`:""} aktivitas</span>}
                      </div>
                    </div>

                    {/* Progress bar — bigger */}
                    <div className="pr-2">
                      <div className="h-4 bg-secondary rounded-full overflow-hidden mb-2">
                        <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700",progressGrad)}
                          style={{width:pct===0?"0%":`${Math.max(pct,3)}%`}}/>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn("text-base font-black font-display",pctClr)}>{pct}%</span>
                        <span className={cn("text-sm font-bold font-display",pct===0?"text-foreground/50":"text-foreground")}>
                          {kpiCount}/{am.kpiTarget} aktivitas KPI
                        </span>
                      </div>
                    </div>

                    <div className="text-base font-black font-display text-foreground text-center">{visibleActs.length}</div>
                    <div className="text-base font-bold font-display text-foreground/70 text-center">{am.kpiTarget}</div>
                    <div className={cn("text-base font-bold font-display text-center",sisa===0?"text-emerald-600 dark:text-emerald-400":"text-foreground")}>{sisa===0?"✓":sisa}</div>
                    <div>
                      {pct>=100
                        ?<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">✓ Tercapai</span>
                        :pct>=70
                        ?<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">Mendekati</span>
                        :<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400">Di Bawah KPI</span>
                      }
                    </div>
                  </div>
                  {/* Sub-header inside the same sticky wrapper — never covered by AM row */}
                  {isExpanded&&hasActs&&(
                    <div className="grid text-xs font-black uppercase tracking-wide text-foreground/75 bg-secondary border-b border-border"
                      style={{gridTemplateColumns:"28px 96px 1fr 140px 120px 60px",padding:"10px 14px 10px 52px"}}>
                      <div>#</div><div>Tanggal</div><div>Pelanggan &amp; Catatan</div>
                      <div>Tipe Aktivitas</div><div>Kategori</div><div>KPI</div>
                    </div>
                  )}
                  </div>{/* end sticky wrapper */}

                  {/* Expanded detail — activity rows only */}
                  {isExpanded&&(
                    <div className="border-t border-border/30 bg-secondary/20">
                      {!hasActs?(
                        <div className="flex items-center gap-3 px-6 py-4 text-sm text-foreground/70">
                          <span className="text-amber-500">⚠</span>
                          AM ini tidak memiliki data aktivitas pada periode yang dipilih meski sudah dicari di data mentah.
                        </div>
                      ):(
                        <>
                          {/* Activity rows */}
                          {visibleActs.map((act:any,i:number)=>{
                            const {short,day}=actFmtDate(act.activityEndDate);
                            const ts=actTypeSty(act.activityType);
                            const ls=actLabelSty(act.label);
                            return (
                              <div key={act.id} className="grid items-start border-b border-border/20 last:border-b-0 hover:bg-secondary/30 transition-colors"
                                style={{gridTemplateColumns:"28px 96px 1fr 140px 120px 60px",padding:"9px 14px 9px 52px"}}>
                                <div className="text-xs font-bold text-foreground/50 font-mono pt-0.5">{i+1}</div>
                                <div>
                                  <div className="text-sm font-bold text-foreground font-mono">{short}</div>
                                  <div className="text-[11px] font-medium text-foreground/60 mt-px">{day}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-foreground">{act.caName||"–"}</div>
                                  {act.activityNotes&&<div className="text-xs font-medium text-foreground/60 mt-0.5 line-clamp-2">{act.activityNotes}</div>}
                                </div>
                                <div className="pt-0.5">
                                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold" style={{background:ts.bg,color:ts.text}}>{act.activityType||"–"}</span>
                                </div>
                                <div className="pt-0.5">
                                  <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-semibold",ls.cls)}>{ls.short}</span>
                                </div>
                                <div className="pt-0.5">
                                  {act.isKpi
                                    ?<span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded">✓ Ya</span>
                                    :<span className="text-xs font-bold text-foreground/50 bg-secondary px-2 py-0.5 rounded">✗ Tidak</span>
                                  }
                                </div>
                              </div>
                            );
                          })}

                          {/* Summary footer */}
                          <div className="flex items-center gap-5 px-6 py-3 border-t-2 border-primary/20 bg-primary/5">
                            <span className="text-[10px] font-bold text-foreground/40 uppercase tracking-wide">Ringkasan:</span>
                            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">✓ {visibleKpi} aktivitas KPI</span>
                            {visibleNonKpi>0&&<span className="text-sm font-bold text-foreground/60">✗ {visibleNonKpi} non-KPI</span>}
                            <span className="ml-auto text-sm font-black text-foreground">{visibleActs.length}/{am.activities.length} ditampilkan</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            </div>{/* end body minWidth wrapper */}
            </div>{/* end body overflow-x-auto */}
          </div>{/* end .bg-card */}
          </div>{/* end mx-2 */}
          </div>{/* end actTableRef scroll */}
        </>
      )}
    </div>
    </>
  );
}

// ─── Main Embed Page ────────────────────────────────────────────────────────────
export default function EmbedPerforma() {
  const [imports, setImports] = useState<any[]>([]);
  const [snapshotId, setSnapshotId] = useState<number | null>(null);
  const [allPerfs, setAllPerfs] = useState<any[]>([]);
  const [filterPeriodes, setFilterPeriodes] = useState<Set<string>>(new Set());
  const [filterDivisi, setFilterDivisi] = useState("LESA");
  const [filterNamaAms, setFilterNamaAms] = useState<Set<string>>(new Set());
  const [filterTipeRank, setFilterTipeRank] = useState("Ach CM");
  const [filterTipeRevenue, setFilterTipeRevenue] = useState("Reguler");
  const [decimalPrecision, setDecimalPrecision] = useState<1 | 2>(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [custViewMode, setCustViewMode] = useState<"perBulan" | "agregasi">("agregasi");
  const [loading, setLoading] = useState(true);
  // Read ?type= from URL to determine initial slide (performance|funnel|activity)
  const initialSlide = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("type");
    if (t === "funnel") return 2;
    if (t === "activity") return 3;
    if (t === "prognosa") return 1;
    return 0;
  }, []);

  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scenario, setScenario] = useState<ScenarioKey>("all");
  const [selectedPeriodes, setSelectedPeriodes] = useState<Set<string>>(new Set());
  const [tipeRank, setTipeRank] = useState<TipeRankKey>("Ach CM");
  const [tipeRevenue, setTipeRevenue] = useState<TipeRevenueKey>("Reguler");
  const [selectedDivisi, setSelectedDivisi] = useState<Set<string>>(new Set());
  const [selectedAmNames, setSelectedAmNames] = useState<Set<string>>(new Set());
  const [prognosaAmFilterValue, setPrognosaAmFilterValue] = useState<string | null>(null);
  const [amSearchQuery, setAmSearchQuery] = useState("");

  // Compute available Divisi and AM name options from prognosa data
  // Compute available Divisi and AM name options from prognosa data
  const progDivisiOptions = useMemo(() => {
    const d = new Set<string>();
    for (const r of prognosaDataDefault) {
      const div = r.DIVISI_CC || r.DIVISI_AM;
      if (div) d.add(div);
    }
    return [...d].sort();
  }, []);

  const progAmNameOptions = useMemo(() => {
    const d = new Set<string>();
    for (const r of prognosaDataDefault) {
      if (r.WITEL_AM === "SURAMADU") d.add(r.NAMA_AM);
    }
    return [...d].sort();
  }, []);

  const allPeriodes = useMemo(() => {
    const p = new Set<string>();
    for (const r of prognosaDataDefault) { p.add(String(r.PERIODE)); }
    return [...p].sort();
  }, []);

  const prognosaFilterBar = (
    <div className="hidden sm:flex items-end gap-2 flex-nowrap overflow-x-auto">
      {/* Skenario */}
      <div className="flex flex-col gap-1 shrink-0" style={{ width: 130 }}>
        <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Skenario</label>
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
              <span className="flex-1 text-left truncate font-medium text-foreground">{SCENARIOS.find(s => s.id === scenario)?.label ?? "Semua"}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 140 }}>
            <div className="bg-popover border border-border rounded-xl shadow-lg p-1">
              {SCENARIOS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setScenario(s.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors",
                    scenario === s.id
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  {s.shortLabel}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {/* Snapshot */}
      <div className="flex flex-col gap-1 shrink-0">
        <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">📷 Snapshot</label>
        <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap disabled:opacity-40 transition-colors focus:ring-2 focus:ring-primary/20 focus:border-primary">
          <span className="flex-1 text-left truncate font-medium text-foreground">26 Agt 2026</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </div>
      {/* Periode */}
      <div className="flex flex-col gap-1 shrink-0">
        <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Periode</label>
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
              <span className="flex-1 text-left truncate font-medium text-foreground">{selectedPeriodes.size === 0 ? "Semua" : `${selectedPeriodes.size} Periode dipilih`}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
            <div className="bg-popover border border-border rounded-xl shadow-lg min-w-[180px] max-h-72 overflow-y-auto p-1.5">
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-border mb-1">
                <span className="font-semibold text-sm text-foreground uppercase tracking-wider">Periode</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedPeriodes(new Set())}
                    className="text-xs px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary font-semibold transition-colors"
                  >
                    Semua
                  </button>
                  <button
                    onClick={() => setSelectedPeriodes(new Set(allPeriodes))}
                    className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80 text-red-500 font-semibold transition-colors border border-red-200 hover:border-red-400"
                  >
                    Kosongkan
                  </button>
                </div>
              </div>
              {allPeriodes.map(p => {
                const monthIdx = parseInt(p.slice(4)) - 1;
                const label = `${["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][monthIdx]} ${p.slice(0, 4)}`;
                const isSelected = selectedPeriodes.size === 0
                  ? true  // semua checked saat "Semua" aktif
                  : selectedPeriodes.has(p);  // checked jika dipilih
                return (
                  <label key={p} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedPeriodes(prev => {
                          const prevSet = prev.size === 0 ? new Set(allPeriodes) : prev;
                          const next = new Set(prevSet);
                          if (next.has(p)) {
                            next.delete(p);
                          } else {
                            next.add(p);
                          }
                          // Jika semua dipilih, reset ke mode "Semua" (empty = all)
                          if (next.size === allPeriodes.length) return new Set();
                          return next;
                        });
                      }}
                      style={{ accentColor: "hsl(0, 84%, 60%)" }}
                      className="rounded cursor-pointer w-3.5 h-3.5"
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {/* Account Manager — single choice with search */}
      <div className="flex flex-col gap-1 shrink-0" style={{ width: 180 }}>
        <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Account Manager</label>
        <Popover>
          <PopoverTrigger asChild>
            <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
              <span className="flex-1 text-left truncate font-medium text-foreground">
                {prognosaAmFilterValue ? progAmNameOptions.find(n => n === prognosaAmFilterValue) ?? prognosaAmFilterValue : "Semua AM"}
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-muted-foreground"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 220 }}>
            <div className="bg-popover border border-border rounded-xl shadow-lg p-1.5">
              <input
                type="text"
                placeholder="Cari AM..."
                value={amSearchQuery}
                onChange={e => setAmSearchQuery(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-background mb-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground"
              />
              <div className="max-h-48 overflow-y-auto">
                <button
                  onClick={() => setPrognosaAmFilterValue(null)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2",
                    prognosaAmFilterValue === null
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  {prognosaAmFilterValue === null && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  {prognosaAmFilterValue !== null && <span className="w-1.5 shrink-0" />}
                  Semua AM
                </button>
                {progAmNameOptions
                  .filter(n => amSearchQuery === "" || n.toLowerCase().includes(amSearchQuery.toLowerCase()))
                  .map(n => (
                    <button
                      key={n}
                      onClick={() => setPrognosaAmFilterValue(n)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2",
                        prognosaAmFilterValue === n
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      {prognosaAmFilterValue === n && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground shrink-0" />}
                      {prognosaAmFilterValue !== n && <span className="w-1.5 shrink-0" />}
                      {n}
                    </button>
                  ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [funnelSubtitle, setFunnelSubtitle] = useState("HO / FULL HO");
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const perfSearchRef = useRef<HTMLInputElement>(null);
  const perfTableRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(() => {
    clearPresentationSession();
    window.location.href = "/presentation/login";
  }, []);

  // Ukur tinggi toolbar tabel Performa AM secara dinamis
  const perfToolbarRef = useRef<HTMLDivElement>(null);
  const [perfToolbarH, setPerfToolbarH] = useState(52);
  useEffect(() => {
    const el = perfToolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPerfToolbarH(el.offsetHeight));
    ro.observe(el);
    setPerfToolbarH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // Thead callback ref — measures sticky thead height so AM row sticks flush below it
  const [perfPresentTableHeaderH, setPerfPresentTableHeaderH] = useState(43);
  const perfTheadCallbackRef = useCallback((el: HTMLTableSectionElement|null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setPerfPresentTableHeaderH(el.getBoundingClientRect().height));
    ro.observe(el);
    setPerfPresentTableHeaderH(el.getBoundingClientRect().height);
  }, []);
  // Sticky AM table height — callback ref on expanded AM sticky table for accurate measurement
  const [perfPresentAmRowH, setPerfPresentAmRowH] = useState(38);
  const perfPresentAmRowCallbackRef = useCallback((el: HTMLTableElement|null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setPerfPresentAmRowH(el.getBoundingClientRect().height));
    ro.observe(el);
    setPerfPresentAmRowH(el.getBoundingClientRect().height);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // ── Global keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      // Slide navigation — always active
      if (e.key === "ArrowRight") { setCurrentSlide(s => Math.min(s + 1, SLIDES.length - 1)); return; }
      if (e.key === "ArrowLeft")  { setCurrentSlide(s => Math.max(s - 1, 0)); return; }

      if (inInput) return; // rest of shortcuts skip when typing

      // Jump to slide by number
      if (e.key === "1") { e.preventDefault(); setCurrentSlide(0); return; }
      if (e.key === "2") { e.preventDefault(); setCurrentSlide(1); return; }
      if (e.key === "3") { e.preventDefault(); setCurrentSlide(2); return; }
      if (e.key === "4") { e.preventDefault(); setCurrentSlide(3); return; }

      // Fullscreen
      if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); return; }

      // Help overlay
      if (e.key === "?") { e.preventDefault(); setShortcutHelpOpen(p => !p); return; }

      // Close help / close dropdowns
      if (e.key === "Escape") { setShortcutHelpOpen(false); }

      // Slide 0 (Performa) specific shortcuts
      if (currentSlide === 0) {
        if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          setExpandedRows(prev => {
            const niks = filteredAmDataRef.current.map(r => r.nik);
            return prev.size >= niks.length ? new Set() : new Set(niks);
          });
        }
        if (e.key === "Escape") { setExpandedRows(new Set()); setSearchQuery(""); }
        if (e.key === "/") { e.preventDefault(); perfSearchRef.current?.focus(); }
        if (e.key === "t" || e.key === "T") { e.preventDefault(); perfTableRef.current?.focus(); }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentSlide, toggleFullscreen]);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/public/import-history`)
      .then(r => r.json())
      .then((data: any[]) => {
        setImports(data);
        const snapId = data.length > 0 ? data[0].id : null;
        setSnapshotId(snapId);
        // Fetch performance data in the same effect to avoid React 18 timing issues
        if (!snapId) {
          setAllPerfs([]);
          setLoading(false);
          return;
        }
        return fetch(`${API_BASE}/api/public/performance?importId=${snapId}`).then(r => r.json());
      })
      .then((data: any[] | undefined) => {
        if (!data) return;
        setAllPerfs(data);
        window.__perfDebug = { rows: data.length, dps: data.filter((p: any) => p.divisiCc === 'DPS').length, des: data.filter((p: any) => p.divisi === 'DES').length };
        console.log("[DEBUG perf fetch]", data.length, "rows", data.filter((p: any) => p.divisiCc === 'DPS').length, "DPS via divisiCc", data.filter((p: any) => p.divisi === 'DES').length, "DES via divisi");
        const ps = [...new Set(data.map((p: any) => `${p.tahun}-${String(p.bulan).padStart(2, "0")}`))] as string[];
        ps.sort();
        const psWithData = ps.filter(period => {
          const [y, m] = period.split("-");
          return data.some((p: any) =>
            String(p.tahun) === y && String(p.bulan).padStart(2, "0") === m &&
            (p.realRevenue ?? 0) > 0
          );
        });
        setFilterPeriodes(new Set(psWithData.length > 0 ? psWithData : ps));
        setFilterDivisi("LESA");
        setFilterNamaAms(new Set());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!snapshotId) { setAllPerfs([]); return; }
    setLoading(true);
    fetch(`${API_BASE}/api/public/performance?importId=${snapshotId}`)
      .then(r => r.json())
      .then((data: any[]) => {
        setAllPerfs(data);
        window.__perfDebug = { rows: data.length, dps: data.filter((p: any) => p.divisiCc === 'DPS').length, des: data.filter((p: any) => p.divisi === 'DES').length };
        console.log("[DEBUG perf fetch]", data.length, "rows", data.filter((p: any) => p.divisiCc === 'DPS').length, "DPS via divisiCc", data.filter((p: any) => p.divisi === 'DES').length, "DES via divisi");
        const ps = [...new Set(data.map((p: any) => `${p.tahun}-${String(p.bulan).padStart(2, "0")}`))] as string[];
        ps.sort();
        const psWithData = ps.filter(period => {
          const [y, m] = period.split("-");
          return data.some((p: any) =>
            String(p.tahun) === y && String(p.bulan).padStart(2, "0") === m &&
            (p.realRevenue ?? 0) > 0
          );
        });
        setFilterPeriodes(new Set(psWithData.length > 0 ? psWithData : ps));
        setFilterDivisi("LESA");
        setFilterNamaAms(new Set());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [snapshotId]);

  const availablePeriodes = useMemo(() => {
    return [...new Set(
      allPerfs
        .map((p: any) => `${p.tahun}-${String(p.bulan).padStart(2, "0")}`)
    )].sort();
  }, [allPerfs]);

  // Latest selected period (for CM)
  const cmPeriode = useMemo(() => {
    const sorted = [...filterPeriodes].sort().reverse();
    return sorted[0] ?? null;
  }, [filterPeriodes]);
  const cmMonth = useMemo(() => cmPeriode ? parseInt(cmPeriode.split("-")[1]) : null, [cmPeriode]);
  const cmYear = useMemo(() => cmPeriode ? cmPeriode.split("-")[0] : null, [cmPeriode]);

  const ytdPeriodeLabel = useMemo(() => {
    if (filterPeriodes.size <= 1) return cmPeriode ? periodeLabel(cmPeriode) : "—";
    const sorted = [...filterPeriodes].sort();
    const fY = sorted[0].split("-")[0], lY = sorted[sorted.length-1].split("-")[0];
    const fM = MONTHS_LABEL[parseInt(sorted[0].split("-")[1])-1];
    const lM = MONTHS_LABEL[parseInt(sorted[sorted.length-1].split("-")[1])-1];
    const range = fY === lY ? `${fM}–${lM} ${lY}` : `${fM} ${fY}–${lM} ${lY}`;
    return `${filterPeriodes.size} Periode (${range})`;
  }, [filterPeriodes, cmPeriode]);

  // Active filter booleans for slide 0 filter chips
  const isPeriodeFiltered = filterPeriodes.size > 0 && filterPeriodes.size < availablePeriodes.length;
  const isDivisiFiltered = filterDivisi !== "LESA";
  const isAmFiltered = filterNamaAms.size > 0;
  const isRankFiltered = filterTipeRank !== "Ach CM";
  const showCmCol  = filterTipeRank !== "Ach YTD";
  const showYtdCol = filterTipeRank !== "Ach CM";
  const isRevenueFiltered = filterTipeRevenue !== "Reguler";
  const hasPerformActiveFilter = isPeriodeFiltered || isDivisiFiltered || isAmFiltered || isRankFiltered || isRevenueFiltered;
  const resetPerformFilters = useCallback(() => {
    setFilterPeriodes(new Set());
    setFilterDivisi("LESA");
    setFilterNamaAms(new Set());
    setFilterTipeRank("Ach CM");
    setFilterTipeRevenue("Reguler");
  }, []);

  // amTableData
  const amTableData = useMemo(() => {
    if (!allPerfs.length || !cmPeriode) { console.log("[DEBUG amTableData] early return: allPerfs.length=", allPerfs.length, "cmPeriode=", cmPeriode); return []; }
    console.log("[DEBUG amTableData] filterDivisi=", filterDivisi, "cmPeriode=", cmPeriode, "cmMonth=", cmMonth, "total rows=", allPerfs.length);
    let rows = allPerfs as any[];
    if (filterPeriodes.size > 0) {
      rows = rows.filter((p: any) => filterPeriodes.has(`${p.tahun}-${String(p.bulan).padStart(2, "0")}`));
    }
    // Group by NIK. AMs with multi-divisi (e.g. DPS+DSS) get multiple cmRows — we combine them.
    const amMap = new Map<string, { cmRows: any[]; filteredRows: any[] }>();
    for (const r of rows) {
      if (!amMap.has(r.nik)) amMap.set(r.nik, { cmRows: [], filteredRows: [] });
      const e = amMap.get(r.nik)!;
      e.filteredRows.push(r);
      if (r.bulan === cmMonth) e.cmRows.push(r);
    }
    let result = [...amMap.entries()].map(([nik, entry]) => {
      const cmRows = entry.cmRows;
      if (cmRows.length === 0) return null;
      // When divisi filter is active, restrict CM rows to matching divisi only
      const activeCmRows = (filterDivisi === "LESA")
        ? cmRows
        : cmRows.filter((cr: any) => matchesDivisiPerforma(cr.divisi_cc, filterDivisi));
      // Combine CM target/real — only from activeCmRows (respects divisi filter)
      let cmTarget = 0, cmReal = 0;
      for (const cr of (activeCmRows.length > 0 ? activeCmRows : cmRows)) {
        const s = getTypedRevenue(cr, filterTipeRevenue);
        cmTarget += s.target; cmReal += s.real;
      }
      // For YTD, filter rows by divisi if active
      const activeFilteredRows = (filterDivisi === "LESA")
        ? entry.filteredRows
        : entry.filteredRows.filter((r: any) => matchesDivisiPerforma(r.divisi_cc, filterDivisi));
      let ytdTarget = 0, ytdReal = 0;
      for (const r of activeFilteredRows) {
        const s = getTypedRevenue(r, filterTipeRevenue);
        ytdTarget += s.target; ytdReal += s.real;
      }
      const effectiveCmAch = cmTarget > 0 ? cmReal / cmTarget : 0;
      const effectiveYtdAch = ytdTarget > 0 ? ytdReal / ytdTarget : 0;
      // Primary divisi: use activeCmRows for dominant portfolio
      const primaryCmRow = (activeCmRows.length > 0 ? activeCmRows : cmRows).reduce((best: any, r: any) => {
        const s = getTypedRevenue(r, filterTipeRevenue);
        const bS = getTypedRevenue(best, filterTipeRevenue);
        return s.target > bS.target ? r : best;
      }, (activeCmRows.length > 0 ? activeCmRows : cmRows)[0]);
      const divisiAll = [...new Set(cmRows.map((r: any) => r.divisi_cc as string))];
      // Build customers — only from rows matching divisi filter
      // For flat format (komponen_detail = single object without Reguler/Sustain/etc), inject revenue from parent AM row
      const custRaw = activeFilteredRows.flatMap((cr: any) => {
        const periodeStr = `${cr.tahun}-${String(cr.bulan).padStart(2, "0")}`;
        const rawKomponen = parseKomponen(cr.komponenDetail);
        // Flat format: each komponen_detail is a single object with customer metadata (nip, pelanggan, proporsi)
        // but NO Reguler/Sustain/Scaling/NGTMA revenue fields
        const isFlat = rawKomponen.length === 1 &&
          rawKomponen[0]?.pelanggan != null &&
          rawKomponen[0]?.Reguler == null &&
          rawKomponen[0]?.Sustain == null;
        const toNum = (v: any) => (v == null || v === "" ? 0 : Number(v));
        return rawKomponen.map((c: any) => {
          if (isFlat) {
            return {
              ...c,
              _divisi: cr.divisi_cc,
              _periode: periodeStr,
              Reguler: { target: toNum(cr.targetReguler), real: toNum(cr.realReguler) },
              Sustain: { target: toNum(cr.targetSustain), real: toNum(cr.realSustain) },
              Scaling: { target: toNum(cr.targetScaling), real: toNum(cr.realScaling) },
              NGTMA: { target: toNum(cr.targetNgtma), real: toNum(cr.realNgtma) },
            };
          }
          return { ...c, _divisi: cr.divisi_cc, _periode: periodeStr };
        });
      });
      const custMap = new Map<string, { c: any; periods: Set<string>; proporsiSum: number; proporsiCount: number }>();
      for (const c of custRaw) {
        const key = `${c.nip || c.pelanggan}__${c._divisi || ""}`;
        if (!custMap.has(key)) {
          custMap.set(key, { c: { ...c }, periods: new Set([c._periode]), proporsiSum: c.proporsi ?? 0, proporsiCount: 1 });
        } else {
          const entry = custMap.get(key)!;
          entry.periods.add(c._periode);
          // Merge revenue only if this customer appeared in this period already
          // (flat format: same customer across periods — don't double-count)
          const alreadyHadPeriod = entry.periods.size > 1;
          if (!alreadyHadPeriod) {
            for (const tipe of ["Reguler", "Sustain", "Scaling", "NGTMA"] as const) {
              if (c[tipe] || entry.c[tipe]) {
                entry.c[tipe] = {
                  target: (entry.c[tipe]?.target ?? 0) + (c[tipe]?.target ?? 0),
                  real:   (entry.c[tipe]?.real   ?? 0) + (c[tipe]?.real   ?? 0),
                };
              }
            }
            entry.c.targetTotal = (entry.c.targetTotal ?? 0) + (c.targetTotal ?? 0);
            entry.c.realTotal   = (entry.c.realTotal   ?? 0) + (c.realTotal   ?? 0);
          }
          // Average proporsi across all periods
          entry.proporsiSum += c.proporsi ?? 0;
          entry.proporsiCount += 1;
        }
      }
      const mergedCustomers = [...custMap.values()].map(e => {
        const avgProporsi = e.proporsiCount > 0 ? e.proporsiSum / e.proporsiCount : 0;
        return { ...e.c, proporsi: avgProporsi };
      });
      return {
        nik, namaAm: primaryCmRow.namaAm, divisi: primaryCmRow.divisi, divisiAll,
        statusWarna: primaryCmRow.statusWarna,
        cmAch: effectiveCmAch, ytdAch: effectiveYtdAch,
        cmTarget, cmReal,
        ytdTarget, ytdReal,
        customers: mergedCustomers,
        rawCustomers: custRaw,
      };
    }).filter(Boolean) as any[];
    // Multi-divisi AMs appear when any of their divisi matches the filter
    if (filterDivisi !== "LESA") result = result.filter(r =>
      (r.divisiAll as string[]).some((d: string) => matchesDivisiPerforma(d, filterDivisi))
    );
    console.log("[DEBUG amTableData final] filterDivisi=", filterDivisi, "result.length=", result.length, "LESA filter check:", result.filter(r => { const matched = (r.divisiAll as string[]).some((d: string) => matchesDivisiPerforma(d, "LESA")); return matched; }).length);
    if (filterNamaAms.size > 0) result = result.filter(r => filterNamaAms.has(r.namaAm));
    result.sort((a, b) => {
      if (filterTipeRank === "Ach YTD") return b.ytdAch - a.ytdAch;
      return b.cmAch - a.cmAch;
    });
    return result.map((r, i) => ({ ...r, displayRank: i + 1 }));
  }, [allPerfs, filterPeriodes, cmPeriode, cmMonth, filterDivisi, filterNamaAms, filterTipeRank, filterTipeRevenue]);

  const divisiOptions = useMemo(() => {
    if (!allPerfs.length || !cmMonth) return [];
    return [...new Set(allPerfs.filter((p: any) => p.bulan === cmMonth).map((p: any) => p.divisi).filter(Boolean))].sort() as string[];
  }, [allPerfs, cmMonth]);

  const amNames = useMemo(() => {
    if (!allPerfs.length || !cmMonth) return [];
    const rows = allPerfs.filter((p: any) => p.bulan === cmMonth && matchesDivisiPerforma(p.divisi_cc, filterDivisi));
    return [...new Set(rows.map((p: any) => p.namaAm).filter(Boolean))].sort() as string[];
  }, [allPerfs, cmMonth, filterDivisi]);

  const topCm = useMemo(() => [...amTableData].sort((a, b) => b.cmAch - a.cmAch)[0] ?? null, [amTableData]);
  const topYtd = useMemo(() => [...amTableData].sort((a, b) => b.ytdAch - a.ytdAch)[0] ?? null, [amTableData]);

  const distribusi = useMemo(() => {
    const gte100 = amTableData.filter(r => r.cmAch * 100 >= 100).length;
    const gte80 = amTableData.filter(r => r.cmAch * 100 >= 80 && r.cmAch * 100 < 100).length;
    const lt80 = amTableData.filter(r => r.cmAch * 100 < 80).length;
    return [
      { name: "Ach ≥100%", value: gte100, color: "#22c55e" },
      { name: "Ach 80-99%", value: gte80, color: "#f97316" },
      { name: "Ach <80%", value: lt80, color: "#CC0000" },
    ];
  }, [amTableData]);

  // trendData: only show months that are in filterPeriodes, or all months if no filter
  const trendData = useMemo(() => {
    if (!allPerfs.length || !cmYear) return [];
    const divisiLabel = divisiFilterLabel(filterDivisi);
    const result = MONTHS_LABEL.map((month, idx) => {
      const mNum = idx + 1;
      const periodeKey = `${cmYear}-${String(mNum).padStart(2, "0")}`;
      // If periode filter is active, skip months not in the filter
      if (filterPeriodes.size > 0 && !filterPeriodes.has(periodeKey)) {
        return { month, monthFull: `${MONTHS_FULL[idx]} ${cmYear}`, divisiLabel, target: 0, real: 0, ach: 0, _hidden: true };
      }
      const rows = allPerfs.filter((p: any) =>
        String(p.tahun) === cmYear && p.bulan === mNum &&
        matchesDivisiPerforma(p.divisi_cc, filterDivisi)
      );
      const target = rows.reduce((s, p) => s + (Number(p.targetRevenue) || 0), 0);
      const real = rows.reduce((s, p) => s + (Number(p.realRevenue) || 0), 0);
      const ach = target > 0 ? parseFloat(((real / target) * 100).toFixed(1)) : 0;
      return { month, monthFull: `${MONTHS_FULL[idx]} ${cmYear}`, divisiLabel, target, real, ach };
    }).filter(d => !d._hidden);
    console.log("[DEBUG trendData]", JSON.stringify(result));
    return result;
  }, [allPerfs, cmYear, filterDivisi, filterPeriodes]);

  const totals = useMemo(() => {
    const cmT = amTableData.reduce((s, r) => s + r.cmTarget, 0);
    const cmR = amTableData.reduce((s, r) => s + r.cmReal, 0);
    const ytdT = amTableData.reduce((s, r) => s + r.ytdTarget, 0);
    const ytdR = amTableData.reduce((s, r) => s + r.ytdReal, 0);
    return { cmTarget: cmT, cmReal: cmR, cmAch: cmT > 0 ? cmR / cmT * 100 : 0, ytdTarget: ytdT, ytdAch: ytdT > 0 ? ytdR / ytdT * 100 : 0, ytdReal: ytdR };
  }, [amTableData]);

  const filteredAmData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return amTableData;
    return amTableData.filter(row =>
      row.namaAm.toLowerCase().includes(q) ||
      (row.nik ?? "").toLowerCase().includes(q) ||
      (row.divisi ?? "").toLowerCase().includes(q) ||
      (row.customers || []).some((c: any) =>
        (c.namaCustomer ?? c.customerName ?? c.nama ?? "").toLowerCase().includes(q) ||
        (c.nip ?? "").toLowerCase().includes(q)
      )
    );
  }, [amTableData, searchQuery]);

  // Ref untuk keyboard handler — hindari stale closure
  const filteredAmDataRef = useRef<typeof filteredAmData>([]);
  useEffect(() => { filteredAmDataRef.current = filteredAmData; }, [filteredAmData]);

  const effectiveExpandedRows = useMemo(() => {
    if (!searchQuery.trim()) return expandedRows;
    return new Set(filteredAmData.map(r => r.nik));
  }, [searchQuery, filteredAmData, expandedRows]);

  const toggleRow = useCallback((nik: string) => {
    setExpandedRows(prev => { const n = new Set(prev); if (n.has(nik)) n.delete(nik); else n.add(nik); return n; });
  }, []);

  const hasData = amTableData.length > 0;
  if (!hasData) { console.log("[DEBUG hasData=false] amTableData.length=", amTableData.length, "allPerfs.length=", allPerfs.length, "cmPeriode=", cmPeriode, "cmMonth=", cmMonth, "filterDivisi=", filterDivisi, "filterPeriodes.size=", filterPeriodes.size); }

  return (
    <div className="h-screen bg-background font-sans text-foreground text-sm flex flex-col overflow-hidden">
      {/* ─── Keyboard Shortcut Help Overlay ──────────────────── */}
      {shortcutHelpOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setShortcutHelpOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl p-5 w-[340px] max-h-[85svh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-sm uppercase tracking-wide">Keyboard Shortcuts</h2>
              <button onClick={() => setShortcutHelpOpen(false)} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
            </div>
            {/* Navigasi */}
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Navigasi Slide</p>
            <div className="space-y-2 mb-4">
              {[
                { keys:["←","→"], desc:"Slide sebelumnya / berikutnya" },
                { keys:["1"],     desc:"Langsung ke Slide 1 — Performa" },
                { keys:["2"],     desc:"Langsung ke Slide 2 — Sales Funnel" },
                { keys:["3"],     desc:"Langsung ke Slide 3 — Aktivitas" },
              ].map(s=>(
                <div key={s.desc} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 shrink-0">
                    {s.keys.map(k=>(
                      <kbd key={k} className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-1.5 rounded border border-border bg-muted text-[11px] font-mono font-semibold shadow-sm">{k}</kbd>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">{s.desc}</span>
                </div>
              ))}
            </div>
            {/* Tabel */}
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Tabel &amp; Data</p>
            <div className="space-y-2 mb-4">
              {[
                { keys:["T"],     desc:"Fokus ke tabel — ↑↓ untuk scroll" },
                { keys:["E"],     desc:"Expand / Collapse semua baris AM" },
                { keys:["/"],     desc:"Fokus ke search bar" },
                { keys:["Esc"],   desc:"Collapse semua &amp; hapus pencarian" },
              ].map(s=>(
                <div key={s.desc} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 shrink-0">
                    {s.keys.map(k=>(
                      <kbd key={k} className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-1.5 rounded border border-border bg-muted text-[11px] font-mono font-semibold shadow-sm">{k}</kbd>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground" dangerouslySetInnerHTML={{__html:s.desc}} />
                </div>
              ))}
            </div>
            {/* Tampilan */}
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Tampilan</p>
            <div className="space-y-2">
              {[
                { keys:["F"],     desc:"Fullscreen / Keluar fullscreen" },
                { keys:["?"],     desc:"Tampilkan / sembunyikan shortcut ini" },
              ].map(s=>(
                <div key={s.desc} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 shrink-0">
                    {s.keys.map(k=>(
                      <kbd key={k} className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-1.5 rounded border border-border bg-muted text-[11px] font-mono font-semibold shadow-sm">{k}</kbd>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">{s.desc}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-4 pt-3 border-t border-border/50">Shortcut nonaktif saat fokus di input / search bar</p>
          </div>
        </div>
      )}
      {/* ─── Slide Navigation Overlay (all screen sizes) ────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-56 bg-card border-r border-border flex flex-col shadow-2xl z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-xs font-bold text-foreground">Navigasi Slide</span>
              <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 py-2 space-y-1 px-2">
              {SLIDES.map((slide, i) => {
                const Icon = slide.icon;
                return (
                  <button key={i} onClick={() => { setCurrentSlide(i); setSidebarOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-xs transition-colors",
                      currentSlide === i
                        ? "bg-primary text-white font-semibold shadow-sm"
                        : "text-foreground hover:bg-secondary"
                    )}
                  >
                    <span className={cn("w-5 h-5 rounded flex items-center justify-center text-[10px] font-black shrink-0", currentSlide === i ? "bg-white/20" : "bg-secondary/80")}>{i + 1}</span>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{slide.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-border text-[10px] text-muted-foreground">← → untuk berpindah slide</div>
          </div>
        </div>
      )}
      {/* ─── Top Navbar ───────────── */}
      <div className="bg-card border-b border-border shrink-0 z-30">
        {/* Row 1 — Logo + Title + Nav Arrows (always visible) */}
        <div className="flex items-center gap-2 px-3 sm:px-4 h-14 sm:h-[76px]">
          {/* Logo + Brand */}
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <img src={`${import.meta.env.BASE_URL}logo-tr3.png`} alt="Logo TR3" className="h-8 sm:h-10 object-contain shrink-0" />
            <div className="leading-tight min-w-0">
              <p className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-none">LESA VI WITEL SURAMADU</p>
              <p className="text-xs sm:text-sm font-bold text-foreground truncate max-w-[160px] sm:max-w-none">
                {currentSlide === 1 ? "Prognosa AM FY 2026" : currentSlide === 2
                  ? <><span className="sm:hidden">AM Sales Funnel</span><span className="hidden sm:inline">SALES FUNNELING LOP MYTENS {funnelSubtitle}</span></>
                  : currentSlide === 3
                  ? <><span className="sm:hidden">Sales Activity</span><span className="hidden sm:inline">AM SALES ACTIVITY REPORT</span></>
                  : "AM Performance Report"}
              </p>
            </div>
          </div>
          {/* Desktop-only divider + filters */}
          {currentSlide === 0 && (
            <>
              <div className="hidden sm:block w-px h-9 bg-border/60 shrink-0 mx-0.5" />
              <div className="hidden sm:flex items-end gap-2 flex-1 min-w-0">
                <SelectDropdown
                  label="📷 Snapshot"
                  value={String(snapshotId ?? "")}
                  onChange={v => { setSnapshotId(Number(v)); setFilterPeriodes(new Set()); }}
                  options={imports.length === 0 ? [{ value: "", label: "Belum ada data" }] : imports.map(imp => ({ value: String(imp.id), label: shortSnap(imp.createdAt, imp.snapshotDate) }))}
                  disabled={!imports.length}
                  className="flex-1 min-w-0"
                />
                <CheckboxDropdown label="Periode" options={availablePeriodes} selected={filterPeriodes} onChange={setFilterPeriodes} labelFn={periodeLabel} headerLabel="" summaryLabel="Periode" className="flex-1 min-w-0" />
                <SelectDropdown
                  label="Divisi"
                  value={filterDivisi}
                  onChange={v => { setFilterDivisi(v); setFilterNamaAms(new Set()); }}
                  options={DIVISI_OPTIONS}
                  className="flex-1 min-w-0"
                />
                <CheckboxDropdown label="Nama AM" options={amNames} selected={filterNamaAms} onChange={setFilterNamaAms} placeholder="Semua AM" headerLabel="Pilih AM" summaryLabel="AM" className="flex-1 min-w-0" />
                <SelectDropdown
                  label="Tipe Rank"
                  value={filterTipeRank}
                  onChange={setFilterTipeRank}
                  options={TIPE_RANK.map(t => ({ value: t, label: t }))}
                  className="flex-1 min-w-0"
                />
                <SelectDropdown
                  label="Revenue"
                  value={filterTipeRevenue}
                  onChange={setFilterTipeRevenue}
                  options={TIPE_REVENUE.map(t => ({ value: t, label: t }))}
                  className="flex-1 min-w-0"
                />
              </div>
            </>
          )}
          <div className="hidden sm:block w-px h-9 bg-border/60 shrink-0 mx-0.5" />
          {currentSlide === 1 && prognosaFilterBar}
          {currentSlide === 2 && (
            <div className="hidden sm:flex items-end gap-2 flex-1 min-w-0 overflow-x-auto" id="funnel-navbar-portal" />
          )}
          {currentSlide === 3 && (
            <div className="hidden sm:flex items-end gap-2 flex-1 min-w-0 overflow-x-auto" id="activity-navbar-portal" />
          )}
          {/* Slide arrows + fullscreen — always pushed to the right */}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button onClick={() => setCurrentSlide(s => Math.max(s - 1, 0))} disabled={currentSlide === 0}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="hidden sm:flex items-center gap-1">
              {SLIDES.map((_, i) => (
                <button key={i} onClick={() => setCurrentSlide(i)}
                  className={cn("rounded-full transition-all", i === currentSlide ? "w-4 h-2 bg-primary" : "w-2 h-2 bg-border hover:bg-muted-foreground")} />
              ))}
            </div>
            <button onClick={() => setCurrentSlide(s => Math.min(s + 1, SLIDES.length - 1))} disabled={currentSlide === SLIDES.length - 1}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-border/60 mx-0.5 hidden sm:block" />
            <button onClick={toggleFullscreen} title={isFullscreen ? "Keluar fullscreen (F)" : "Fullscreen (F)"}
              className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground hidden sm:block">
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={() => setShortcutHelpOpen(p => !p)} title="Keyboard shortcuts (?)"
              className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground hidden sm:flex items-center justify-center font-bold text-xs w-6 h-6 border border-border/60">
              ?
            </button>
            <button onClick={handleLogout} title="Logout"
              className="p-1 rounded-lg hover:bg-red-50 transition-colors text-red-500 hover:text-red-600">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Row 2 — Mobile-only scrollable filter row */}
        {currentSlide === 0 && (
          <div className="sm:hidden flex items-end gap-2 overflow-x-auto px-3 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <SelectDropdown
              label="📷 Snapshot"
              value={String(snapshotId ?? "")}
              onChange={v => { setSnapshotId(Number(v)); setFilterPeriodes(new Set()); }}
              options={imports.length === 0 ? [{ value: "", label: "Belum ada data" }] : imports.map(imp => ({ value: String(imp.id), label: shortSnap(imp.createdAt, imp.snapshotDate) }))}
              disabled={!imports.length}
              className="shrink-0 w-28"
            />
            <CheckboxDropdown label="Periode" options={availablePeriodes} selected={filterPeriodes} onChange={setFilterPeriodes} labelFn={periodeLabel} headerLabel="" summaryLabel="Periode" className="shrink-0 w-24" />
            <SelectDropdown
              label="Divisi"
              value={filterDivisi}
              onChange={v => { setFilterDivisi(v); setFilterNamaAms(new Set()); }}
              options={DIVISI_OPTIONS}
              className="shrink-0 w-24"
            />
            <CheckboxDropdown label="Nama AM" options={amNames} selected={filterNamaAms} onChange={setFilterNamaAms} placeholder="Semua AM" headerLabel="Pilih AM" summaryLabel="AM" className="shrink-0 w-24" />
            <SelectDropdown
              label="Tipe Rank"
              value={filterTipeRank}
              onChange={setFilterTipeRank}
              options={TIPE_RANK.map(t => ({ value: t, label: t }))}
              className="shrink-0 w-24"
            />
            <SelectDropdown
              label="Revenue"
              value={filterTipeRevenue}
              onChange={setFilterTipeRevenue}
              options={TIPE_REVENUE.map(t => ({ value: t, label: t }))}
              className="shrink-0 w-24"
            />
          </div>
        )}
        {/* Mobile prognosa filter row */}
        {currentSlide === 1 && (
          <div
            id="prognosa-navbar-portal-mobile"
            className="sm:hidden flex items-end gap-2 overflow-x-auto px-3 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          />
        )}
        {/* Mobile funnel filter row — portal target for FunnelSlide */}
        {currentSlide === 2 && (
          <div
            id="funnel-navbar-portal-mobile"
            className="sm:hidden flex items-end gap-2 overflow-x-auto px-3 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          />
        )}
        {/* Mobile activity filter row — portal target for ActivitySlide */}
        {currentSlide === 3 && (
          <div
            id="activity-navbar-portal-mobile"
            className="sm:hidden flex items-end gap-2 overflow-x-auto px-3 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          />
        )}
      </div>
      {/* ─── Main Scrollable Content ─────────────────────── */}
      <div className="flex-1 overflow-y-auto">

      {/* ─── Slide: Prognosa AM ────────────────────────── */}
      <PrognosaSlide
        visible={currentSlide === 1}
        scenario={scenario}
        setScenario={setScenario}
        selectedPeriodes={selectedPeriodes}
        setSelectedPeriodes={setSelectedPeriodes}
        selectedDivisi={selectedDivisi}
        setSelectedDivisi={setSelectedDivisi}
        selectedAmNames={selectedAmNames}
        setSelectedAmNames={setSelectedAmNames}
        tipeRank={tipeRank}
        setTipeRank={setTipeRank}
        tipeRevenue={tipeRevenue}
        setTipeRevenue={setTipeRevenue}
        amFilterValue={prognosaAmFilterValue}
        setAmFilterValue={setPrognosaAmFilterValue}
      />

      {/* ─── Slide: Sales Funnel ──────────────────────────── */}
      {currentSlide === 2 && <FunnelSlide onTitleChange={setFunnelSubtitle} />}

      {/* ─── Slide: Sales Activity ────────────────────────── */}
      {currentSlide === 3 && <ActivitySlide />}

      {/* ─── Slide: Visualisasi Performa ─────────────────── */}
      {currentSlide === 0 && (
      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Memuat data...</div>
        ) : !hasData ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Belum ada data performa</div>
        ) : (
          <>
            {/* Active filter chips */}
            {hasPerformActiveFilter && (
              <div className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] bg-secondary/30 border border-border rounded-xl px-4 py-2.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">Filter aktif:</span>
                {isPeriodeFiltered && (
                  <span className="inline-flex shrink-0 items-center gap-1 bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1 rounded-full border border-primary/20">
                    Periode: {filterPeriodes.size === 1 ? periodeLabel([...filterPeriodes][0]) : `${filterPeriodes.size} periode`}
                    <button onClick={() => setFilterPeriodes(new Set())} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {isDivisiFiltered && (
                  <span className="inline-flex shrink-0 items-center gap-1 bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800">
                    Divisi: {filterDivisi}
                    <button onClick={() => setFilterDivisi("LESA")} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {isAmFiltered && (
                  <span className="inline-flex shrink-0 items-center gap-1 bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-violet-200 dark:border-violet-800">
                    AM: {filterNamaAms.size === 1 ? [...filterNamaAms][0] : `${filterNamaAms.size} AM`}
                    <button onClick={() => setFilterNamaAms(new Set())} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {isRankFiltered && (
                  <span className="inline-flex shrink-0 items-center gap-1 bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                    Rank: {filterTipeRank}
                    <button onClick={() => setFilterTipeRank("Ach CM")} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                {isRevenueFiltered && (
                  <span className="inline-flex shrink-0 items-center gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                    Revenue: {filterTipeRevenue}
                    <button onClick={() => setFilterTipeRevenue("Reguler")} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                  </span>
                )}
                <button onClick={resetPerformFilters}
                  className="shrink-0 flex items-center gap-1 px-3 py-1 rounded-full border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                  <X className="w-3 h-3" /> Reset filter
                </button>
              </div>
            )}

            {/* Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <TrophyCard colorScheme="gold"
                title="TOP AM BY CURRENT MONTH"
                subtitle={topCm ? `Divisi ${topCm.divisi} · CM ${cmPeriode ? periodeLabel(cmPeriode) : "—"}` : ""}
                am={topCm} value={topCm && typeof topCm.cmAch === "number" && !isNaN(topCm.cmAch) ? `${(topCm.cmAch * 100).toFixed(decimalPrecision).replace(".", ",")}%` : "–"}
                realValue={topCm ? fmtRupiah(topCm.cmReal) : undefined}
                targetValue={topCm ? fmtRupiah(topCm.cmTarget) : undefined}
              />
              <TrophyCard colorScheme="blue"
                title="TOP AM BY YEAR TO DATE"
                subtitle={topYtd ? `Divisi ${topYtd.divisi} · YTD ${ytdPeriodeLabel}` : ""}
                am={topYtd} value={topYtd && typeof topYtd.ytdAch === "number" && !isNaN(topYtd.ytdAch) ? `${(topYtd.ytdAch * 100).toFixed(decimalPrecision).replace(".", ",")}%` : "–"}
                realValue={topYtd ? fmtRupiah(topYtd.ytdReal) : undefined}
                targetValue={topYtd ? fmtRupiah(topYtd.ytdTarget) : undefined}
              />
              {/* Distribusi */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Distribusi Pencapaian Target</h3>
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0" style={{ width: 160, height: 160 }}>
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={distribusi} cx="50%" cy="50%" innerRadius={52} outerRadius={72} dataKey="value" labelLine={false}>
                          {distribusi.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: "10px", border: "none", fontSize: "11px" }} formatter={(v, n) => [`${v} AM`, n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <p className="text-2xl font-black text-foreground leading-none">{amTableData.length}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">AM</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {distribusi.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                          <span className="text-muted-foreground text-[11px]">{d.name}</span>
                        </div>
                        <span className="font-bold tabular-nums text-[11px]">{d.value} AM</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-card border border-border rounded-xl">
              <div ref={perfToolbarRef} className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold text-foreground shrink-0">AM Performance Report</h3>
                  <div className="relative w-80 shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                    <input
                      ref={perfSearchRef}
                      type="text"
                      placeholder="Cari AM, NIK, divisi, pelanggan, NIP…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-7 pr-7 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setExpandedRows(prev => {
                      const niks = filteredAmDataRef.current.map(r => r.nik);
                      return prev.size >= niks.length ? new Set() : new Set(niks);
                    })}
                    className="h-7 px-2.5 rounded-lg text-xs font-semibold border border-border bg-secondary hover:border-primary/40 hover:text-primary text-foreground transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    title="Expand / Collapse semua AM (E)"
                  >
                    {expandedRows.size > 0 && expandedRows.size >= filteredAmData.length
                      ? <><Minimize2 className="w-3 h-3"/> Collapse Semua</>
                      : <><Expand className="w-3 h-3"/> Expand Semua</>
                    }
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Decimal:</label>
                    <button
                      onClick={() => setDecimalPrecision(d => d === 1 ? 2 : 1)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        decimalPrecision === 2 ? "bg-primary" : "bg-muted"
                      )}
                      title={decimalPrecision === 1 ? "1 desimal" : "2 desimal"}
                    >
                      <span className="sr-only">Toggle decimal precision</span>
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                          decimalPrecision === 2 ? "translate-x-[18px]" : "translate-x-1"
                        )}
                      />
                    </button>
                    <span className="text-[10px] font-bold text-foreground tabular-nums">{decimalPrecision === 1 ? "112.3%" : "112.27%"}</span>
                  </div>
                </div>
              </div>
              <div className="p-3">
              {(() => {
                const PERF_TB: React.CSSProperties = { minWidth: "880px", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: "100%" };
                const bgCard = "hsl(var(--card))";
                return (
                  <div className="border border-border rounded overflow-hidden">
                    {/* ① Global header — outside scroll container so it never floats above the section toolbar */}
                    <div className="overflow-x-auto">
                    <table style={{...PERF_TB, boxShadow:"0 2px 4px rgba(0,0,0,0.10)"}}>
                      <PerfColGroup showCm={showCmCol} showYtd={showYtdCol}/>
                      <thead ref={perfTheadCallbackRef}>
                        <tr className="bg-red-700 text-white">
                          <th className="px-3 py-3 text-left" style={{backgroundColor:"#B91C1C"}}></th>
                          <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide" style={{backgroundColor:"#B91C1C"}}>Nama AM</th>
                          <th className="px-2 py-3 text-center text-xs font-black uppercase tracking-wide" style={{backgroundColor:"#B91C1C"}}>Cust</th>
                          <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wide" style={{backgroundColor:"#B91C1C"}}>Target {filterTipeRevenue}</th>
                          <th className="px-4 py-3 text-right text-xs font-black uppercase tracking-wide" style={{backgroundColor:"#B91C1C"}}>Real {filterTipeRevenue}</th>
                          {showCmCol && <th className={cn("px-3 py-3 text-right text-xs font-black uppercase tracking-wide", filterTipeRank === "Ach CM" && "underline underline-offset-2")} style={{backgroundColor:"#B91C1C"}}>CM %</th>}
                          {showYtdCol && <th className={cn("px-3 py-3 text-right text-xs font-black uppercase tracking-wide", filterTipeRank === "Ach YTD" && "underline underline-offset-2")} style={{backgroundColor:"#B91C1C"}}>YTD %</th>}
                          <th className="px-3 py-3 text-center text-xs font-black uppercase tracking-wide underline underline-offset-2" style={{backgroundColor:"#B91C1C"}}>
                            {filterTipeRank === "Ach YTD" ? "RANK YTD" : "RANK CM"}
                          </th>
                        </tr>
                      </thead>
                    </table>
                    </div>
                    {/* ② Per-AM data + total — scroll container (header is outside, so sticky never escapes) */}
                    <div ref={perfTableRef} tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();e.currentTarget.scrollBy({top:80,behavior:"smooth"});}if(e.key==="ArrowUp"){e.preventDefault();e.currentTarget.scrollBy({top:-80,behavior:"smooth"});}}} className="overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" style={{maxHeight:"calc(100svh - 280px)"}}>
                    {filteredAmData.length === 0 ? (
                      <table style={PERF_TB}><PerfColGroup showCm={showCmCol} showYtd={showYtdCol}/>
                        <tbody><tr><td colSpan={showCmCol && showYtdCol ? 8 : 7} className="text-center py-12 text-muted-foreground text-sm">Tidak ada data yang cocok</td></tr></tbody>
                      </table>
                    ) : filteredAmData.map((row) => {
                      const isExpanded = effectiveExpandedRows.has(row.nik);
                      const hasCustomers = row.customers.length > 0;
                      const ring = isExpanded ? "#94a3b8" : undefined;

                      const amCells = (
                        <>
                          <td className="px-2 py-2.5" style={{backgroundColor:bgCard, width:"28px"}}>
                            {hasCustomers ? (isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />) : null}
                          </td>
                          <td className="px-4 py-2.5 font-black text-foreground uppercase tracking-wide overflow-visible" style={{backgroundColor:bgCard}}>
                            <div className="group relative flex flex-col w-fit gap-0.5">
                              <span className="text-sm font-extrabold">{row.namaAm}</span>
                              <span className="flex items-center gap-1 flex-wrap">
                                {((row.divisiAll as string[]) ?? [row.divisi_cc])
                                  .filter((d: string) => filterDivisi === "LESA" || matchesDivisiPerforma(d, filterDivisi))
                                  .map((d: string) => (
                                  <span key={d} className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",
                                    d === "DPS" ? "bg-blue-100 text-blue-700" : d === "DSS" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                                  )}>{d}</span>
                                ))}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-center font-black text-foreground text-xs" style={{backgroundColor:bgCard}}>{(row.customers || []).length}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-foreground tabular-nums text-xs whitespace-nowrap" style={{backgroundColor:bgCard}}>{fmtRupiah(row.ytdTarget)}</td>
                          <td className="px-4 py-2.5 text-right font-black text-foreground tabular-nums text-xs whitespace-nowrap" style={{backgroundColor:bgCard}}>{fmtRupiah(row.ytdReal)}</td>
                          {showCmCol && <td className={cn("px-3 py-2.5 text-right font-black tabular-nums text-xs", row.cmAch >= 1 ? "text-green-600" : row.cmAch >= 0.8 ? "text-orange-500" : "text-red-600")} style={{backgroundColor:bgCard}}>
                            {typeof row.cmAch === "number" && !isNaN(row.cmAch) ? (row.cmAch * 100).toFixed(decimalPrecision).replace(".", ",") : decimalPrecision === 1 ? "0,0" : "0,00"}%
                          </td>}
                          {showYtdCol && <td className={cn("px-3 py-2.5 text-right font-black tabular-nums text-xs", row.ytdAch >= 1 ? "text-green-600" : row.ytdAch >= 0.8 ? "text-blue-600" : "text-red-600")} style={{backgroundColor:bgCard}}>
                            {typeof row.ytdAch === "number" && !isNaN(row.ytdAch) ? (row.ytdAch * 100).toFixed(decimalPrecision).replace(".", ",") : decimalPrecision === 1 ? "0,0" : "0,00"}%
                          </td>}
                          <td className="px-3 py-2.5 text-center font-black text-foreground text-xs" style={{backgroundColor:bgCard}}>{row.displayRank}</td>
                        </>
                      );

                      if (!isExpanded) {
                        return (
                          <table key={row.nik} style={PERF_TB}>
                            <PerfColGroup showCm={showCmCol} showYtd={showYtdCol}/>
                            <tbody>
                              <tr className={cn("select-none transition-colors", hasCustomers ? "cursor-pointer hover:bg-secondary/30" : "")}
                                style={{borderTop:"1px solid hsl(var(--border))"}}
                                onClick={() => hasCustomers && toggleRow(row.nik)}>
                                {amCells}
                              </tr>
                            </tbody>
                          </table>
                        );
                      }

                      // ── Expanded AM ──
                      return (
                        <div key={row.nik}>
                          {/* Sticky AM name row — sticks at top:0 of the inner scroll container */}
                          <table ref={perfPresentAmRowCallbackRef} style={{...PERF_TB, position:"sticky", top:0, zIndex:16, boxShadow:"0 2px 8px rgba(0,0,0,0.13)"}}>
                            <PerfColGroup showCm={showCmCol} showYtd={showYtdCol}/>
                            <tbody>
                              <tr className="cursor-pointer select-none"
                                style={{borderTop:`2px solid ${ring}`, borderLeft:`2px solid ${ring}`, borderRight:`2px solid ${ring}`, borderBottom:"none"}}
                                onClick={() => toggleRow(row.nik)}>
                                {amCells}
                              </tr>
                            </tbody>
                          </table>

                          {/* Customer detail table — inline rows, sub-header sticky below AM row */}
                          {(() => {
                            const isMultiPeriode = filterPeriodes.size > 1;
                            const displayCusts = isMultiPeriode && custViewMode === "perBulan"
                              ? (row.rawCustomers || row.customers)
                              : row.customers;
                            const showPeriodeCol = isMultiPeriode && custViewMode === "perBulan";
                            const getCustRev = (c: any) => filterTipeRevenue === "Semua"
                              ? customerTotal(c)
                              : { target: c[filterTipeRevenue]?.target ?? 0, real: c[filterTipeRevenue]?.real ?? 0 };
                            return (
                              <>
                          <table style={{...PERF_TB, borderLeft:`2px solid ${ring}`, borderRight:`2px solid ${ring}`, tableLayout:"fixed", minWidth:"780px"}}>
                            <colgroup>
                              <col style={{width:"28px"}}/>
                              <col style={{width:"220px"}}/>
                              <col style={{width:"82px"}}/>
                              {showPeriodeCol && <col style={{width:"80px"}}/>}
                              {filterDivisi === "LESA" && <col style={{width:"68px"}}/>}
                              <col style={{width:"140px"}}/>
                              <col style={{width:"140px"}}/>
                              <col style={{width:"72px"}}/>
                            </colgroup>
                            <thead style={{position:"sticky", top:perfPresentAmRowH, zIndex:15}}>
                              <tr style={{background:"rgb(255,241,242)", borderTop:"1px solid #fecdd3", borderBottom:"2px solid #fecdd3"}}>
                                <th className="px-2 py-2 text-center text-sm font-black text-rose-700 uppercase tracking-wide">#</th>
                                <th className="px-4 py-2 text-left text-sm font-black text-rose-700 uppercase tracking-wide">
                                  <div className="flex items-center gap-2">
                                    <span>Pelanggan / NIP</span>
                                    {isMultiPeriode && (
                                      <span className="flex items-center rounded-full border border-rose-300 overflow-hidden text-[10px] font-bold ml-1">
                                        <button onClick={(e) => { e.stopPropagation(); setCustViewMode("agregasi"); }}
                                          className={cn("px-2 py-0.5 transition-colors", custViewMode === "agregasi" ? "bg-rose-700 text-white" : "text-rose-700 hover:bg-rose-200")}>Agregasi</button>
                                        <button onClick={(e) => { e.stopPropagation(); setCustViewMode("perBulan"); }}
                                          className={cn("px-2 py-0.5 transition-colors", custViewMode === "perBulan" ? "bg-rose-700 text-white" : "text-rose-700 hover:bg-rose-200")}>Per Bulan</button>
                                      </span>
                                    )}
                                  </div>
                                </th>
                                <th className="px-3 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Proporsi</th>
                                {showPeriodeCol && <th className="px-3 py-2 text-center text-sm font-black text-rose-700 uppercase tracking-wide">Periode</th>}
                                {filterDivisi === "LESA" && (
                                  <th className="px-3 py-2 text-center text-sm font-black text-rose-700 uppercase tracking-wide">Divisi</th>
                                )}
                                <th className="px-4 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Target</th>
                                <th className="px-4 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Real</th>
                                <th className="px-3 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Ach %</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayCusts.map((c: any, ci: number) => {
                                const { target: cTarget, real: cReal } = getCustRev(c);
                                const prop = (c.proporsi != null ? c.proporsi : 0) * 100;
                                const cAch = Math.abs(cTarget) > 0 ? cReal / cTarget * 100 : 0;
                                return (
                                  <tr key={ci} className={cn("transition-colors hover:bg-rose-50", ci % 2 === 0 ? "bg-white dark:bg-card" : "bg-rose-50/40 dark:bg-rose-950/10")}>
                                    <td className="px-2 py-2 text-center text-[11px] text-muted-foreground font-mono">{ci + 1}</td>
                                    <td className="px-4 py-2 overflow-hidden">
                                      <div className="text-xs font-bold text-foreground leading-snug truncate" title={c.pelanggan || ""}>{c.pelanggan || "—"}</div>
                                      {c.nip && <div className="text-[10px] text-muted-foreground mt-0.5">{c.nip}</div>}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <div className="w-8 h-1.5 bg-secondary rounded-full overflow-hidden shrink-0">
                                          <div className="h-full bg-rose-500 rounded-full" style={{width:`${Math.min(prop,100)}%`}} />
                                        </div>
                                        <span className="text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{typeof prop === "number" && !isNaN(prop) ? prop.toFixed(decimalPrecision) : decimalPrecision === 1 ? "0.0" : "0.00"}%</span>
                                      </div>
                                    </td>
                                    {showPeriodeCol && (
                                      <td className="px-3 py-2 text-center">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-100 text-rose-700 whitespace-nowrap">
                                          {c._periode ? periodeLabel(c._periode) : "—"}
                                        </span>
                                      </td>
                                    )}
                                    {filterDivisi === "LESA" && (
                                      <td className="px-3 py-2 text-center">
                                        {c._divisi && (
                                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold",
                                            c._divisi === "DPS" ? "bg-blue-100 text-blue-700" : c._divisi === "DSS" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                                          )}>{c._divisi}</span>
                                        )}
                                      </td>
                                    )}
                                    <td className="px-4 py-2 text-right text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(Math.abs(cTarget))}</td>
                                    <td className="px-4 py-2 text-right text-xs font-black text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(cReal)}</td>
                                    <td className={cn("px-3 py-2 text-right text-xs font-black tabular-nums", cAch >= 100 ? "text-green-600" : cAch >= 80 ? "text-orange-500" : "text-red-500")}>
                                      {typeof cAch === "number" && !isNaN(cAch) ? cAch.toFixed(decimalPrecision) : decimalPrecision === 1 ? "0.0" : "0.00"}%
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {/* AM total footer row */}
                          <table style={{...PERF_TB, borderLeft:`2px solid ${ring}`, borderRight:`2px solid ${ring}`, borderBottom:`2px solid ${ring}`, tableLayout:"fixed", minWidth:"780px"}}>
                            <colgroup>
                              <col style={{width:"28px"}}/>
                              <col style={{width:"220px"}}/>
                              <col style={{width:"82px"}}/>
                              {showPeriodeCol && <col style={{width:"80px"}}/>}
                              {filterDivisi === "LESA" && <col style={{width:"68px"}}/>}
                              <col style={{width:"140px"}}/>
                              <col style={{width:"140px"}}/>
                              <col style={{width:"72px"}}/>
                            </colgroup>
                            <tbody>
                              {(() => {
                                const footTarget = displayCusts.reduce((s: number, c: any) => s + getCustRev(c).target, 0);
                                const footReal   = displayCusts.reduce((s: number, c: any) => s + getCustRev(c).real, 0);
                                const footAch    = footTarget > 0 ? footReal / footTarget : 0;
                                return (
                                  <tr className="bg-rose-50 border-t border-rose-200 dark:border-rose-800/50">
                                    <td className="px-2 py-2" />
                                    <td className="px-4 py-2"><span className="text-xs font-black text-rose-800 uppercase tracking-wide">{displayCusts.length} Pelanggan — {row.namaAm}</span></td>
                                    <td />
                                    {showPeriodeCol && <td />}
                                    {filterDivisi === "LESA" && <td />}
                                    <td className="px-4 py-2 text-right text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(footTarget)}</td>
                                    <td className="px-4 py-2 text-right text-xs font-black text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(footReal)}</td>
                                    <td className={cn("px-3 py-2 text-right text-xs font-black tabular-nums", footAch >= 1 ? "text-green-600" : footAch >= 0.8 ? "text-orange-500" : "text-red-600")}>
                                      {typeof footAch === "number" && !isNaN(footAch) ? (footAch * 100).toFixed(decimalPrecision).replace(".", ",") : decimalPrecision === 1 ? "0,0" : "0,00"}%
                                    </td>
                                  </tr>
                                );
                              })()}
                            </tbody>
                          </table>
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                    </div>{/* closes perfTableRef scroll container */}
                    {/* ③ Global total row — di luar scroll container agar selalu terlihat */}
                    <div className="overflow-x-auto">
                    <table style={PERF_TB}>
                      <PerfColGroup showCm={showCmCol} showYtd={showYtdCol}/>
                      <tbody>
                        <tr className="bg-secondary/60" style={{borderTop:"2px solid hsl(var(--border))"}}>
                          <td className="px-2 py-3" />
                          <td className="px-4 py-3 font-bold text-sm text-foreground">Total ({amTableData.length} AM)</td>
                          <td className="px-2 py-2.5 text-center tabular-nums text-foreground font-semibold text-sm">
                            {filteredAmData.reduce((s, r) => s + (r.customers || []).length, 0)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground font-semibold text-sm whitespace-nowrap">{fmtRupiah(totals.ytdTarget)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-foreground font-bold text-sm whitespace-nowrap">{fmtRupiah(totals.ytdReal)}</td>
                          {showCmCol && <td className={cn("px-3 py-2.5 text-right tabular-nums", totals.cmAch >= 100 ? "text-green-600" : totals.cmAch >= 80 ? "text-orange-500" : "text-red-600")}>
                            <div className="font-black text-sm">{typeof totals.cmAch === "number" && !isNaN(totals.cmAch) ? totals.cmAch.toFixed(decimalPrecision).replace(".", ",") : decimalPrecision === 1 ? "0,0" : "0,00"}%</div>
                            <div className="text-[10px] font-semibold mt-0.5">{totals.cmAch >= 100 ? "Melebihi Target" : totals.cmAch >= 80 ? "Mendekati" : "Di Bawah Target"}</div>
                          </td>}
                          {showYtdCol && <td className={cn("px-3 py-2.5 text-right tabular-nums", totals.ytdAch >= 100 ? "text-green-600" : totals.ytdAch >= 80 ? "text-blue-600" : "text-red-500")}>
                            <div className="font-black text-sm">{typeof totals.ytdAch === "number" && !isNaN(totals.ytdAch) ? totals.ytdAch.toFixed(decimalPrecision).replace(".", ",") : decimalPrecision === 1 ? "0,0" : "0,00"}%</div>
                            <div className="text-[10px] font-semibold mt-0.5">{totals.ytdAch >= 100 ? "Melebihi Target" : totals.ytdAch >= 80 ? "Mendekati" : "Di Bawah Target"}</div>
                          </td>}
                          <td />
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </div>
                );
              })()}
              </div>
            </div>

            {/* Trend Chart */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-bold text-foreground mb-3">
                Tren Performa Revenue Bulanan {cmYear ?? ""}
                {filterDivisi !== "all" && <span className="ml-2 text-xs text-muted-foreground font-normal">· {divisiFilterLabel(filterDivisi)}</span>}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={trendData} margin={{ top: 5, right: 30, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10 }}
                    domain={[0, "auto"]}
                    tickFormatter={v => typeof v === "number" && !isNaN(v) ? (v >= 1e9 ? `Rp${(v/1e9).toFixed(0)}M` : v >= 1e6 ? `Rp${(v/1e6).toFixed(0)}Jt` : "0") : "0"} />
                  <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10 }}
                    domain={[0, "auto"]} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                  <Bar yAxisId="left" dataKey="real" name="Real Revenue" fill="#22c55e" radius={[3,3,0,0]} maxBarSize={36} />
                  <Bar yAxisId="left" dataKey="target" name="Target Revenue" fill="#3b82f6" radius={[3,3,0,0]} maxBarSize={36} />
                  <Line yAxisId="right" type="monotone" dataKey="ach" name="Ach Rate %" stroke="#CC0000" strokeWidth={2.5} dot={{ fill: "#CC0000", r: 3 }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
      )}
      <div className="px-4 py-2 text-[10px] text-muted-foreground/40 text-right">Telkom AM Dashboard · Data diperbarui otomatis</div>
      </div>{/* end main scrollable */}
    </div>
  );
}
