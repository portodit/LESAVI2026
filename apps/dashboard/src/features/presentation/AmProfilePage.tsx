import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, X, Upload, TrendingUp, ChevronDown, Check, Target,
  TrendingDown, ChevronLeft, ChevronRight, Users, Trophy, CreditCard, MapPin,
  BarChart2, Filter, Activity, TrendingUp, Search, Minimize2
} from "lucide-react";
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getPresentationSession } from "@/shared/hooks/use-presentation-auth";
import { cn, formatRupiahFull } from "@/shared/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const MONTHS_LABEL = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const REVENUE_OPTIONS = [
  { value: "Reguler", label: "Reguler" },
  { value: "Sustain", label: "Sustain" },
  { value: "Scaling", label: "Scaling" },
  { value: "NGTMA", label: "NGTMA" },
];
const DIVISI_OPTIONS_EMB = [
  { value: "LESA", label: "LESA (All)" },
  { value: "DPS", label: "DPS" },
  { value: "DSS", label: "DSS" },
];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtRupiah = (n: number) => formatRupiahFull(n);
const fmtRupiahShort = (n: number) => {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}Rb`;
  return `Rp ${n.toFixed(0)}`;
};
const fmtNilai = (n: number) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}Rb`;
  return `${n.toFixed(0)}`;
};
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface AmProfile { nik: string; nama: string; divisi: string | null; badge: string | null; witel: string | null; photoUrl: string | null; }
interface CustomerRow { pelanggan: string; nip: string | null; divisi: string | null; divisiCc: string | null; segmen: string | null; proporsi: number; targetTotal: number; realTotal: number; achRate: number; }
interface CustomerRowDetail extends CustomerRow { bulan: number; tahun: number; }
interface Snapshot { id: number; label: string; period: string | null; snapshotDate: string | null; }
interface AmProfileFilters { availableBulan: number[]; selectedBulan: number[]; tipeRevenue: string; }
interface AmProfileResponse { am: AmProfile; snapshots: Snapshot[]; customers: CustomerRow[]; selectedSnapshotId: number | null; filters: AmProfileFilters; customerRows: CustomerRowDetail[]; summary: { totalTarget: number; totalReal: number; achRate: number; periodText: string; customerCount: number; }; }
interface RankData { myRank: number | null; myAchRate: number | null; totalCount: number; bulan?: number; tahun?: number; }
type TabId = "performansi" | "salesFunnel" | "salesActivity" | "prognosa";
interface Props { nik?: string; embedded?: boolean; onAmLoaded?: (am: AmProfile) => void; }

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ values, color = "#10b981", fill = true }: { values: number[]; color?: string; fill?: boolean }) {
  if (!values || values.length < 2) return <div className="w-[88px] h-[36px]" />;
  const W = 88, H = 36, PAD = 2;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${PAD + (H - 2 * PAD) * (1 - (v - min) / range)}`);
  const linePath = `M${pts.join(" L")}`;
  const fillPath = values.length > 1 ? `${linePath} L${W},${H} L0,${H} Z` : undefined;
  const gradId = `sg-${color.replace("#", "")}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && fillPath && <path d={fillPath} fill={`url(#${gradId})`} />}
      <path d={linePath} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Donut Chart ─────────────────────────────────────────────────────────────
function DonutChart({ pct, color = "#3b82f6", size = 150, stroke = 18 }: { pct: number; color?: string; size?: number; stroke?: number }) {
  const R = 54;
  const cx = 80, cy = 80;
  const startAngle = -90;
  const clamped = Math.min(100, Math.max(0, pct));
  const endAngle = startAngle + (clamped / 100) * 360;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arc = (a: number) => {
    const rad = toRad(a);
    return `${cx + R * Math.cos(rad)},${cy + R * Math.sin(rad)}`;
  };
  const start = arc(startAngle);
  const end = arc(endAngle);
  const large = clamped > 50 ? 1 : 0;
  const bgEnd = arc(startAngle + 360);
  return (
    <svg width={size} height={size} viewBox="0 0 160 115">
      <path d={`M ${start} A ${R} ${R} 0 1 1 ${bgEnd}`} fill="none" stroke="#e5e7eb" strokeWidth={stroke} strokeLinecap="round" />
      <path d={`M ${start} A ${R} ${R} 0 ${large} 1 ${end}`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="22" fontWeight="800" fill={color} fontFamily="ui-monospace,monospace">{fmtPct(clamped)}</text>
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize="8.5" fill="#6b7280">CAPAIAN</text>
    </svg>
  );
}

// ─── Funnel Table ────────────────────────────────────────────────────────────
interface FunnelTableProps {
  lopRows: any[];
  funnelExpanded: Record<string, boolean>;
  setFunnelExpanded: (v: Record<string, boolean>) => void;
  search: string;
  setSearch: (v: string) => void;
  fmtNilai: (n: number) => string;
  fmtRupiahShort: (n: number) => string;
  amNama: string;
  amBadge: string;
}

function FunnelTable({ lopRows, funnelExpanded, setFunnelExpanded, search, setSearch, fmtNilai, amNama, amBadge }: FunnelTableProps) {
  const phaseColors: Record<string, string> = { F0: "#0ea5e9", F1: "#3b82f6", F2: "#6366f1", F3: "#7c3aed", F4: "#f97316", F5: "#10b981" };

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of lopRows) {
      const key = r.statusF || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lopRows]);

  const totalNilai = lopRows.reduce((s: number, r: any) => s + (r.nilaiProyek || 0), 0);
  const lopCount = lopRows.length;
  const pelangganSet = new Set(lopRows.map((r: any) => r.pelanggan).filter(Boolean));
  const badge = amBadge;

  const crF5 = lopRows.filter((r: any) => r.statusF === "F5").length;
  const crPipeline = lopRows.filter((r: any) => ["F3","F4","F5"].includes(r.statusF)).length;
  const cr = crPipeline > 0 ? (crF5 / crPipeline) * 100 : 0;

  const toggleAll = () => {
    if (Object.keys(funnelExpanded).length === 0) {
      setFunnelExpanded(Object.fromEntries(grouped.map(([k]) => [k, true])));
    } else {
      setFunnelExpanded({});
    }
  };

  if (grouped.length === 0) {
    return <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">Belum ada data funnel.</div>;
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header row */}
      <div style={{ position: "sticky", top: 0, zIndex: 16, boxShadow: "rgba(0,0,0,0.13) 0px 2px 8px" }}>
        <div style={{ display: "flex", borderLeft: "4px solid rgb(99,102,241)", borderRight: "2px solid rgb(148,163,184)", borderTop: "2px solid rgb(148,163,184)", borderBottom: "none", background: "hsl(var(--card))", padding: "0.5rem 1rem", alignItems: "center", gap: "0.5rem" }}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm uppercase tracking-wide font-bold text-foreground">{amNama || "AM"}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 bg-blue-100 text-blue-700">{badge}</span>
            <button onClick={toggleAll} className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 shrink-0" title="Expand/Collapse semua">
              <Minimize2 className="w-3 h-3" />
            </button>
          </div>
          <span className="text-sm font-black tabular-nums shrink-0">{lopCount} <span className="font-normal text-xs text-muted-foreground">lop</span></span>
          <span className="text-sm font-black tabular-nums text-foreground shrink-0">{pelangganSet.size} <span className="font-normal text-xs text-muted-foreground">plg</span></span>
          <span className="text-sm font-black tabular-nums text-foreground shrink-0">{fmtRupiahShort(totalNilai)}</span>
          <span className="font-bold text-sm tabular-nums text-emerald-600 shrink-0">{fmtPct(cr)}</span>
        </div>
      </div>

      {/* Phase sections */}
      {grouped.map(([phase, rows]) => {
        const isOpen = funnelExpanded[phase] !== false;
        const phaseTotal = rows.reduce((s: number, r: any) => s + (r.nilaiProyek || 0), 0);
        return (
          <div key={phase}>
            <div style={{ position: "sticky", top: "52px", zIndex: 15, cursor: "pointer", borderLeft: `4px solid ${phaseColors[phase] ?? "#888"}`, borderRight: "2px solid rgb(148,163,184)", borderTop: "1px solid hsl(var(--border))", boxShadow: "rgba(0,0,0,0.09) 0px 2px 6px", background: "rgba(253,242,248,0.75)" }}
              onClick={() => setFunnelExpanded(prev => ({ ...prev, [phase]: !prev[phase] }))}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem", paddingLeft: "2.5rem" }}>
                <ChevronRight className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0", isOpen && "rotate-90")} />
                <span className="text-sm font-black uppercase tracking-wide" style={{ color: phaseColors[phase] ?? "#666" }}>
                  DAFTAR PROYEK {phase}
                </span>
                <span className="text-xs font-black text-slate-900 px-1.5 py-0.5 rounded-full" style={{ background: "rgb(242,242,242)" }}>
                  {rows.length} proyek
                </span>
                <div style={{ flex: 1 }} />
                <span className="text-sm font-black text-foreground tabular-nums shrink-0">{fmtRupiahShort(phaseTotal)}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ borderLeft: `4px solid ${phaseColors[phase] ?? "#888"}`, borderRight: "2px solid rgb(148,163,184)", borderBottom: "2px solid rgb(148,163,184)" }}>
                {rows.map((r: any) => (
                  <div key={r.lopid} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.5rem 1rem", borderTop: "1px solid hsl(var(--border)/0.5)", background: "hsl(var(--card))" }}>
                    <span className="text-xs text-muted-foreground w-32 truncate shrink-0">{r.pelanggan || "—"}</span>
                    <span className="text-xs text-foreground flex-1 truncate min-w-0">{r.judulProyek || "—"}</span>
                    <span className="text-xs font-bold text-foreground tabular-nums shrink-0">{fmtRupiahShort(r.nilaiProyek || 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Total row */}
      <div style={{ display: "flex", borderTop: "2px solid rgb(148,163,184)", borderLeft: "2px solid rgb(148,163,184)", borderRight: "2px solid rgb(148,163,184)", borderBottom: "2px solid rgb(148,163,184)", background: "hsl(var(--card))", padding: "0.5rem 1rem", gap: "1rem", alignItems: "center" }}>
        <span className="text-sm font-black text-red-700 uppercase tracking-wide flex-1">Total Nilai Proyek — {amNama || "AM"}</span>
        <span className="text-sm font-black tabular-nums text-red-700 shrink-0">{fmtRupiahShort(totalNilai)}</span>
      </div>
    </div>
  );
}

// ─── Select Dropdown ─────────────────────────────────────────────────────────
function SelectDropdown({ label, value, onChange, options, className, disabled }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className={cn("relative", className)}>
      {label && <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</label>}
      <button type="button" onClick={() => !disabled && setOpen(o => !o)} disabled={disabled}
        className={cn("w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border bg-background hover:bg-secondary/50 transition-colors",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer", open && "ring-1 ring-primary/40")}>
        <span className="truncate">{options.find(o => o.value === value)?.label ?? value}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn("w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-secondary/60 transition-colors", o.value === value && "bg-primary/10 text-primary font-bold")}>
              {o.value === value && <Check className="w-3 h-3 shrink-0" />}<span className={cn("flex-1 truncate", o.value !== value && "pl-5")}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Checkbox Dropdown ───────────────────────────────────────────────────────
function CheckboxDropdown({ label, options, selected, onChange, labelFn, summaryLabel, className }: {
  label: string; options: string[]; selected: Set<string>; onChange: (next: Set<string>) => void;
  labelFn?: (v: string) => string; summaryLabel?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className={cn("relative", className)}>
      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</label>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={cn("w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border bg-background hover:bg-secondary/50 transition-colors")}>
        <span className="truncate text-muted-foreground">
          {selected.size === 0 ? `Semua ${summaryLabel ?? label}` : selected.size === 1 ? labelFn ? labelFn([...selected][0]) : `[${[...selected][0]}]` : `${selected.size} ${summaryLabel ?? label}`}
        </span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          <button onClick={() => onChange(new Set())} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-secondary/60 transition-colors border-b border-border">
            <div className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center", selected.size === 0 ? "bg-primary border-primary" : "border-muted-foreground")}>
              {selected.size === 0 && <Check className="w-2.5 h-2.5 text-white" />}
            </div>
            <span>Semua {summaryLabel ?? label}</span>
          </button>
          {options.map(o => {
            const isSelected = selected.has(o);
            return (
              <button key={o} onClick={() => {
                const next = new Set(selected);
                isSelected ? next.delete(o) : next.add(o);
                onChange(next);
              }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-secondary/60 transition-colors">
                <div className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center", isSelected ? "bg-primary border-primary" : "border-muted-foreground")}>
                  {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span>{labelFn ? labelFn(o) : o}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────
function Badge({ badge }: { badge: string | null }) {
  if (!badge) return null;
  const map: Record<string, string> = { Platinum: "bg-slate-400", Gold: "bg-yellow-500", Silver: "bg-slate-300", Bronze: "bg-orange-400", Default: "bg-red-500" };
  return <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded text-white uppercase tracking-wide", map[badge] ?? map.Default)}>{badge}</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AmProfilePage({ nik, embedded = false, onAmLoaded }: Props) {
  const [data, setData] = useState<AmProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Embedded state
  const [embTab, setEmbTab] = useState<TabId>("performansi");
  const [embPage, setEmbPage] = useState(1);
  const [embPageSize] = useState(10);
  const [embRankCM, setEmbRankCM] = useState<RankData | null>(null);
  const [embRankYtd, setEmbRankYtd] = useState<RankData | null>(null);
  const [rankLoading, setRankLoading] = useState(false);

  // Filter state (performansi tab)
  const [selectedSnapshot, setSelectedSnapshot] = useState<number | null>(null);
  const [selectedPeriodes, setSelectedPeriodes] = useState<Set<string>>(new Set());
  const [selectedRevenue, setSelectedRevenue] = useState<string>("Reguler");
  const [selectedDivisi, setSelectedDivisi] = useState<string>("LESA");
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [tableViewMode, setTableViewMode] = useState<"agregasi" | "perbulan">("agregasi");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const [decimalPrecision, setDecimalPrecision] = useState<number>(1);
  const [customerSearch, setCustomerSearch] = useState("");
  const periodesInitializedRef = useRef(false);

  // Funnel state
  const [funnelData, setFunnelData] = useState<any>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [selectedFunnelSnapshot, setSelectedFunnelSnapshot] = useState<number | null>(null);
  const [selectedFunnelTarget, setSelectedFunnelTarget] = useState<string>("FULL");
  const [selectedKontrak, setSelectedKontrak] = useState<Set<string>>(new Set(["AO", "MO"]));
  const [selectedStatusFunnel, setSelectedStatusFunnel] = useState<string>("all");
  const [funnelExpanded, setFunnelExpanded] = useState<Record<string, boolean>>({});
  const [funnelSearch, setFunnelSearch] = useState("");
  const [funnelTablePage, setFunnelTablePage] = useState(1);
  const [funnelTablePageSize] = useState(20);
  // Popover state
  const [funnelSnapOpen, setFunnelSnapOpen] = useState(false);
  const [funnelTargetOpen, setFunnelTargetOpen] = useState(false);
  const [funnelKontrakOpen, setFunnelKontrakOpen] = useState(false);
  const [funnelStatusOpen, setFunnelStatusOpen] = useState(false);

  const session = getPresentationSession();
  const effectiveNik = nik ?? session?.nik ?? "";

  // Computed available periodes: ALL 12 months (for dropdown options), derived from selected snapshot's tahun
  const availablePeriodes = useMemo(() => {
    const rawPeriod = data?.snapshots?.find(s => s.id === selectedSnapshot)?.period ?? "";
    let tahun: number;
    if (rawPeriod.includes("-")) {
      tahun = parseInt(rawPeriod.split("-")[0]);
    } else if (rawPeriod.length >= 4) {
      tahun = parseInt(rawPeriod.slice(0, 4));
    } else {
      tahun = new Date().getFullYear();
    }
    if (isNaN(tahun)) return [];
    // Return all 12 months of that tahun
    return Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, "0")}`);
  }, [data?.snapshots, selectedSnapshot]);

  // Default selected periodes: only bulan where customerRows has real data
  const defaultSelectedPeriodes = useMemo(() => {
    const tahun = availablePeriodes.length > 0 ? availablePeriodes[0].split("-")[0] : "";
    const bulanWithData = new Set(
      (data?.customerRows ?? [])
        .filter(r => r.realTotal > 0)
        .map(r => r.bulan)
    );
    return new Set(
      availablePeriodes.filter(p => {
        const bulan = parseInt(p.split("-")[1]);
        return bulanWithData.has(bulan);
      })
    );
  }, [availablePeriodes, data?.customerRows]);

  // Initialize from data (only once, not on subsequent data changes)
  useEffect(() => {
    if (!data) return;
    if (selectedSnapshot === null && data.selectedSnapshotId != null) setSelectedSnapshot(data.selectedSnapshotId);
    if (!periodesInitializedRef.current && defaultSelectedPeriodes.size > 0) {
      periodesInitializedRef.current = true;
      setSelectedPeriodes(new Set(defaultSelectedPeriodes));
    }
  }, [data, defaultSelectedPeriodes]);

  // Reset to page 1 when filters/data change
  useEffect(() => { setTablePage(1); }, [customerSearch, tableViewMode, selectedPeriodes, selectedRevenue, selectedDivisi, selectedSnapshot, data]);
  const presHeaders = () => ({ "x-presentation-token": session?.presentationToken ?? "" });
  useEffect(() => {
    if (!effectiveNik) return;
    let cancelled = false;
    setLoading(true);
    // Save scroll position before refetch
    const scrollY = window.scrollY;
    const params = new URLSearchParams();
    if (selectedSnapshot) params.set("snapshotId", String(selectedSnapshot));
    if (selectedDivisi !== "LESA") params.set("divisiCc", selectedDivisi);
    params.set("tipeRevenue", selectedRevenue);
    const currentYear = new Date().getFullYear();
    selectedPeriodes.forEach(p => {
      const [y, m] = p.split("-");
      const tahunNum = parseInt(y);
      if (isNaN(tahunNum)) return;
      params.append("bulan", m);
      params.append("tahun", String(tahunNum));
    });
    const query = params.toString();
    const url = `/api/presentation/am-profile/${effectiveNik}${query ? `?${query}` : ""}`;
    fetch(url, { headers: presHeaders() })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (cancelled) return;
        if (!d?.am) { setError("Invalid response from server"); setLoading(false); return; }
        setData(d);
        onAmLoaded?.(d.am);
        setLoading(false);
        // Restore scroll position after data loads
        window.scrollTo({ top: scrollY, behavior: "instant" });
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [effectiveNik, selectedSnapshot, selectedPeriodes, selectedRevenue, selectedDivisi]);

  // Fetch ranks
  // Determine latest selected periode for CM rank
  const latestPeriode = useMemo(() => {
    const sorted = [...selectedPeriodes].sort((a, b) => b.localeCompare(a));
    return sorted[0] ?? null;
  }, [selectedPeriodes]);

  // YTD periode range
  const ytdPeriodeLabel = useMemo(() => {
    const sorted = [...selectedPeriodes].sort((a, b) => a.localeCompare(b));
    if (sorted.length === 0) return null;
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const [fy, fm] = first.split("-");
    const [ly, lm] = last.split("-");
    if (fy === ly) {
      return `${MONTHS_SHORT[parseInt(fm) - 1]} – ${MONTHS_SHORT[parseInt(lm) - 1]} ${fy}`;
    }
    return `${MONTHS_SHORT[parseInt(fm) - 1]} ${fy} – ${MONTHS_SHORT[parseInt(lm) - 1]} ${ly}`;
  }, [selectedPeriodes]);

  useEffect(() => {
    if (!effectiveNik) return;
    let cancelled = false;
    setRankLoading(true);

    // CM rank params
    const cmParams = new URLSearchParams();
    cmParams.set("nik", effectiveNik);
    if (selectedSnapshot) cmParams.set("snapshotId", String(selectedSnapshot));
    if (latestPeriode) {
      const [y, m] = latestPeriode.split("-");
      cmParams.set("tahun", y);
      cmParams.set("bulan", String(parseInt(m)));
    }
    if (selectedDivisi !== "LESA") cmParams.set("divisiCc", selectedDivisi);
    if (selectedRevenue !== "Reguler") cmParams.set("tipeRevenue", selectedRevenue);

    // YTD rank params
    const ytdParams = new URLSearchParams();
    ytdParams.set("nik", effectiveNik);
    ytdParams.set("scope", "ytd");
    if (selectedSnapshot) ytdParams.set("snapshotId", String(selectedSnapshot));
    ytdParams.set("tahun", String(latestPeriode ? latestPeriode.split("-")[0] : new Date().getFullYear()));
    if (selectedDivisi !== "LESA") ytdParams.set("divisiCc", selectedDivisi);
    if (selectedRevenue !== "Reguler") ytdParams.set("tipeRevenue", selectedRevenue);

    Promise.all([
      fetch(`/api/presentation/am-rank?${cmParams}`, { headers: presHeaders() }).then(r => r.json()).catch(() => null),
      fetch(`/api/presentation/am-rank?${ytdParams}`, { headers: presHeaders() }).then(r => r.json()).catch(() => null),
    ]).then(([cm, ytd]) => {
      if (!cancelled) { setEmbRankCM(cm); setEmbRankYtd(ytd); setRankLoading(false); }
    });
    return () => { cancelled = true; };
  }, [effectiveNik, selectedSnapshot, latestPeriode, selectedDivisi, selectedRevenue]);

  // Fetch funnel
  useEffect(() => {
    if (!effectiveNik || embTab !== "salesFunnel") return;
    let cancelled = false;
    setFunnelLoading(true);
    const params = new URLSearchParams();
    if (selectedFunnelSnapshot) params.set("import_id", String(selectedFunnelSnapshot));
    params.set("target_type", selectedFunnelTarget);
    if (selectedKontrak.size > 0 && selectedKontrak.size < 2) {
      params.set("kategori_kontrak", [...selectedKontrak].join(","));
    }
    if (selectedStatusFunnel !== "all") params.set("status_funnel", selectedStatusFunnel);
    const qs = params.toString();
    fetch(`/api/presentation/am-funnel/${effectiveNik}${qs ? `?${qs}` : ""}`, { headers: presHeaders() })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setFunnelData(d); setFunnelLoading(false); } })
      .catch(() => { if (!cancelled) setFunnelLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveNik, embTab, selectedFunnelSnapshot, selectedFunnelTarget, selectedKontrak, selectedStatusFunnel]);

  // Upload photo
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setCropImageSrc(reader.result); };
    reader.readAsDataURL(file);
  };
  const handleCropped = async (blob: Blob) => {
    if (!effectiveNik) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", blob, "photo.jpg");
      const res = await fetch(`/api/presentation/am-profile/${effectiveNik}/photo`, { method: "POST", headers: presHeaders(), body: fd });
      const json = await res.json();
      if (json.photoUrl) setData(d => d ? { ...d, am: { ...d.am, photoUrl: json.photoUrl + "?t=" + Date.now() } } : d);
    } finally { setUploading(false); }
  };

  // Table data: filter + paginate
  const tableData = useMemo(() => {
    const allFiltered = tableViewMode === "agregasi"
      ? (customerSearch.trim()
          ? (data?.customers ?? []).filter(c =>
              (c.pelanggan || "").toLowerCase().includes(customerSearch.toLowerCase()) ||
              (c.nip || "").toLowerCase().includes(customerSearch.toLowerCase()))
          : (data?.customers ?? []))
      : (customerSearch.trim()
          ? (data?.customerRows ?? []).filter(r =>
              (r.pelanggan || "").toLowerCase().includes(customerSearch.toLowerCase()) ||
              (r.nip || "").toLowerCase().includes(customerSearch.toLowerCase()))
          : (data?.customerRows ?? []));
    const totalPages = Math.max(1, Math.ceil(allFiltered.length / tablePageSize));
    const currentPage = Math.min(tablePage, totalPages);
    const rows = allFiltered.slice((currentPage - 1) * tablePageSize, currentPage * tablePageSize);
    return { allFiltered, rows, currentPage, totalPages };
  }, [data, customerSearch, tableViewMode, tablePage, tablePageSize]);

  // Monthly sparkline data: aggregate customerRows by month (chronological)
  const monthlyData = useMemo(() => {
    const rows = data?.customerRows ?? [];
    const byKey: Record<string, { target: number; real: number }> = {};
    for (const r of rows) {
      const key = `${r.tahun}-${String(r.bulan).padStart(2, "0")}`;
      if (!byKey[key]) byKey[key] = { target: 0, real: 0 };
      byKey[key].target += r.targetTotal ?? 0;
      byKey[key].real += r.realTotal ?? 0;
    }
    const sorted = Object.entries(byKey).sort(([a], [b]) => a.localeCompare(b));
    return {
      targetValues: sorted.map(([, v]) => v.target),
      realValues: sorted.map(([, v]) => v.real),
    };
  }, [data]);

  // YTD achievement from monthly data
  const ytdAch = useMemo(() => {
    const { targetValues, realValues } = monthlyData;
    const totalTarget = targetValues.reduce((s, v) => s + v, 0);
    const totalReal = realValues.reduce((s, v) => s + v, 0);
    return totalTarget > 0 ? (totalReal / totalTarget) * 100 : 0;
  }, [monthlyData]);

  // ── EMBEDDED VERSION ───────────────────────────────────────────────────────
  if (embedded) {
    if (loading) return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-red-600" />
      </div>
    );
    if (error || !data || !data.am) return (
      <div className="text-center py-20 text-sm text-slate-500">{error ?? "Data tidak tersedia"}</div>
    );

    const { am, summary, customers } = data;
    const photoSrc = am.photoUrl ? (am.photoUrl.startsWith("http") ? am.photoUrl : `${API_BASE}${am.photoUrl}`) : null;

    const searchQ = customerSearch.trim().toLowerCase();
    const filtered = searchQ
      ? customers.filter(c => (c.pelanggan || "").toLowerCase().includes(searchQ) || (c.nip || "").toLowerCase().includes(searchQ))
      : customers;
    const totalPages = Math.max(1, Math.ceil(filtered.length / embPageSize));
    const paginatedCustomers = filtered.slice((embPage - 1) * embPageSize, embPage * embPageSize);
    const filterTotalTarget = filtered.reduce((s, c) => s + c.targetTotal, 0);
    const filterTotalReal = filtered.reduce((s, c) => s + c.realTotal, 0);
    const filterAchRate = filterTotalTarget > 0 ? (filterTotalReal / filterTotalTarget) * 100 : 0;

    const funnelContent = funnelLoading ? (
      <div className="space-y-4">
        <div className="h-10 bg-secondary/50 rounded-xl animate-pulse" />
        <div className="grid grid-cols-4 gap-3"><div className="h-[88px] bg-secondary/50 rounded-xl animate-pulse" /><div className="h-[88px] bg-secondary/50 rounded-xl animate-pulse" /><div className="h-[88px] bg-secondary/50 rounded-xl animate-pulse" /><div className="h-[88px] bg-secondary/50 rounded-xl animate-pulse" /></div>
        <div className="grid grid-cols-3 gap-3"><div className="h-48 bg-secondary/50 rounded-xl animate-pulse" /><div className="h-48 bg-secondary/50 rounded-xl animate-pulse" /><div className="h-48 bg-secondary/50 rounded-xl animate-pulse" /></div>
      </div>
    ) : funnelData ? (
      <div className="space-y-3">
        {/* ── Filter Group ── */}
        <div className="bg-card border border-border rounded-xl p-3">
          <div className="flex items-end gap-2 flex-nowrap overflow-x-auto">
            {/* Snapshot */}
            <div className="flex flex-col gap-1 w-40 shrink-0">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Snapshot</label>
              <Popover open={funnelSnapOpen} onOpenChange={setFunnelSnapOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left">
                    <span className="flex-1 truncate font-medium text-foreground">{funnelData.snapshots?.find((s: any) => s.id === selectedFunnelSnapshot)?.label ?? funnelData.snapshots?.[0]?.label ?? "Pilih..."}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <div className="p-1">
                    {funnelData.snapshots?.map((s: any) => (
                      <button key={s.id} onClick={() => { setSelectedFunnelSnapshot(s.id); setFunnelSnapOpen(false); }} className={cn("w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors", selectedFunnelSnapshot === s.id && "bg-accent font-semibold")}>{s.label}</button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {/* Target */}
            <div className="flex flex-col gap-1 w-36 shrink-0">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Target</label>
              <Popover open={funnelTargetOpen} onOpenChange={setFunnelTargetOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left">
                    <span className="flex-1 truncate font-medium text-foreground">{selectedFunnelTarget}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-0" align="start">
                  <div className="p-1">
                    {[["FULL","FULL (HO+BA)"],["HO","HO Only"],["BA","BA Only"]].map(([v,l]) => (
                      <button key={v} onClick={() => { setSelectedFunnelTarget(v); setFunnelTargetOpen(false); }} className={cn("w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors", selectedFunnelTarget === v && "bg-accent font-semibold")}>{l}</button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {/* Kategori Kontrak */}
            <div className="flex flex-col gap-1 w-48 shrink-0">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Kategori</label>
              <Popover open={funnelKontrakOpen} onOpenChange={setFunnelKontrakOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left">
                    <span className="flex-1 truncate font-medium text-foreground">{selectedKontrak.size === 2 ? "Semua" : [...selectedKontrak].join(", ")}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-0" align="start">
                  <div className="p-1 space-y-0.5">
                    {[["AO","AO"],["MO","MO"]].map(([v,l]) => (
                      <button key={v} onClick={() => { const next = new Set(selectedKontrak); next.has(v) ? next.delete(v) : next.add(v); setSelectedKontrak(next); }} className={cn("w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors flex items-center gap-2", selectedKontrak.has(v) && "bg-accent font-semibold")}>
                        <span className={cn("w-4 h-4 border rounded flex items-center justify-center shrink-0", selectedKontrak.has(v) ? "bg-primary border-primary" : "border-border")}>{selectedKontrak.has(v) && <Check className="w-2.5 h-2.5 text-white" />}</span>
                        <span>{l}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {/* Status Funnel */}
            <div className="flex flex-col gap-1 w-36 shrink-0">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Status</label>
              <Popover open={funnelStatusOpen} onOpenChange={setFunnelStatusOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left">
                    <span className="flex-1 truncate font-medium text-foreground">{selectedStatusFunnel === "all" ? "Semua" : selectedStatusFunnel}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-0" align="start">
                  <div className="p-1">
                    {[["all","Semua"],["ACTIVE","Active"],["INACTIVE","Inactive"],["WON","Won"],["LOST","Lost"]].map(([v,l]) => (
                      <button key={v} onClick={() => { setSelectedStatusFunnel(v); setFunnelStatusOpen(false); }} className={cn("w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors", selectedStatusFunnel === v && "bg-accent font-semibold")}>{l}</button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* ── LOP per Fase + Metrics (3 cols) ── */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 280px" }}>
            {/* LOP per Fase */}
            <div>
              <h3 className="text-base font-display font-bold text-foreground mb-3">LOP per Fase</h3>
              <div className="space-y-2">
                {(funnelData.byStatus ?? []).filter((s: any) => s.count > 0).map((s: any) => {
                  const maxCount = Math.max(...(funnelData.byStatus ?? []).map((x: any) => x.count));
                  const width = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                  const phaseColors: Record<string, string> = { F0: "#0ea5e9", F1: "#3b82f6", F2: "#6366f1", F3: "#7c3aed", F4: "#f97316", F5: "#10b981" };
                  const labelColors: Record<string, string> = { F0: "rgb(3,105,161)", F1: "rgb(29,78,216)", F2: "rgb(67,56,202)", F3: "rgb(91,33,182)", F4: "rgb(194,65,12)", F5: "rgb(6,95,70)" };
                  return (
                    <div key={s.status} className="flex items-center gap-2 group" title={s.status + ": " + s.count + " proyek · " + fmtNilai(s.totalNilai)}>
                      <div className="w-7 shrink-0"><span className="text-sm font-black" style={{ color: labelColors[s.status] ?? "#666", fontFamily: "Inter, sans-serif" }}>{s.status}</span></div>
                      <div className="flex-1 bg-secondary rounded overflow-hidden relative h-5">
                        <div className="h-full rounded transition-all duration-500" style={{ width: (width) + "%", backgroundColor: phaseColors[s.status] ?? "#888" }} />
                        <div className="absolute inset-0 flex items-center pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[10px] font-black text-white drop-shadow-sm whitespace-nowrap">{s.count} proyek · {fmtNilai(s.totalNilai)}</span>
                        </div>
                      </div>
                      <span className="text-sm font-black w-16 shrink-0 text-right" style={{ color: labelColors[s.status] ?? "#666", fontFamily: "Inter, sans-serif" }}>
                        {s.count} <span className="font-semibold text-muted-foreground text-[10px]">LOP</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1.5 mt-3 pt-3 border-t border-border/60">
                {(funnelData.byStatus ?? []).filter((s: any) => s.count > 0).map((s: any) => {
                  const labelColors: Record<string, string> = { F0: "rgb(3,105,161)", F1: "rgb(29,78,216)", F2: "rgb(67,56,202)", F3: "rgb(91,33,182)", F4: "rgb(194,65,12)", F5: "rgb(6,95,70)" };
                  return (
                    <div key={s.status} className="flex-1 min-w-0 bg-secondary/60 rounded-lg px-2.5 py-2.5 border border-border/50 flex flex-col justify-between">
                      <span className="text-xs font-black leading-none" style={{ color: labelColors[s.status] ?? "#666", fontFamily: "Inter, sans-serif" }}>{s.status}</span>
                      <span className="text-[17px] font-black tabular-nums leading-tight text-foreground truncate" style={{ fontFamily: "Inter, sans-serif" }}>{fmtNilai(s.totalNilai)}</span>
                      <span className="text-[11px] font-bold text-muted-foreground tabular-nums leading-none">{s.count} LOP</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Capaian + Conversion Rate (stacked) */}
            <div className="flex flex-col gap-3">
              {/* Capaian Real vs Target */}
              <div className="bg-secondary/40 border border-border rounded-xl p-3 flex items-start gap-2">
                <DonutChart pct={funnelData.capaianTotal ?? 0} color="#3b82f6" size={56} stroke={8} />
                <div className="flex-1 min-w-0 space-y-0.5" style={{ fontSize: "10px" }}>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Capaian</p>
                  <div className="flex justify-between items-baseline gap-1">
                    <span className="text-muted-foreground shrink-0">Real</span>
                    <span className="font-bold text-foreground tabular-nums shrink-0">{fmtRupiahShort(funnelData.totalNilai ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-baseline gap-1">
                    <span className="text-muted-foreground shrink-0">Target</span>
                    <span className="tabular-nums text-foreground shrink-0">{funnelData.targetTotal ? fmtRupiahShort(funnelData.targetTotal) : "—"}</span>
                  </div>
                  {(funnelData.capaianTotal ?? 0) >= 100 ? (
                    <div className="flex justify-between items-baseline gap-1">
                      <span className="font-bold text-emerald-600 shrink-0">Plus</span>
                      <span className="font-bold tabular-nums text-emerald-600 shrink-0">+{fmtRupiahShort(Math.max(0, (funnelData.totalNilai ?? 0) - (funnelData.targetTotal ?? 0)))}</span>
                    </div>
                  ) : (funnelData.targetTotal ?? 0) > 0 ? (
                    <div className="flex justify-between items-baseline gap-1">
                      <span className="font-bold text-red-600 shrink-0">Minus</span>
                      <span className="font-bold tabular-nums text-red-600 shrink-0">-{fmtRupiahShort(Math.max(0, (funnelData.targetTotal ?? 0) - (funnelData.totalNilai ?? 0)))}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              {/* Conversion Rate */}
              <div className="bg-secondary/40 border border-border rounded-xl p-3 flex items-start gap-2">
                <DonutChart pct={funnelData.conversionRate ?? 0} color="#10b981" size={56} stroke={8} />
                <div className="flex-1 min-w-0 space-y-0.5" style={{ fontSize: "10px" }}>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Conversion Rate</p>
                  <div className="flex justify-between items-baseline gap-1">
                    <span className="text-muted-foreground shrink-0">F5 Won</span>
                    <span className="font-bold tabular-nums shrink-0" style={{ color: "rgb(16,185,129)" }}>{fmtNilai(funnelData.wonLopNilai ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-baseline gap-1">
                    <span className="text-muted-foreground shrink-0">F3+F4+F5</span>
                    <span className="tabular-nums text-foreground shrink-0">{fmtNilai(funnelData.pipelineEligibleNilai ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-baseline gap-1">
                    <span className="text-muted-foreground shrink-0">Threshold</span>
                    <span className="font-bold text-amber-500 shrink-0">≥ 70%</span>
                  </div>
                  <div className="flex justify-between items-baseline gap-1">
                    <span className="font-bold text-emerald-600 shrink-0">Rate</span>
                    <span className="font-black tabular-nums text-emerald-600 shrink-0">{fmtPct(funnelData.conversionRate ?? 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <FunnelTable
          lopRows={funnelData.lopRows ?? []}
          funnelExpanded={funnelExpanded}
          setFunnelExpanded={setFunnelExpanded}
          search={funnelSearch}
          setSearch={setFunnelSearch}
          fmtNilai={fmtNilai}
          fmtRupiahShort={fmtRupiahShort}
          amNama={data?.am?.nama ?? ""}
          amBadge={data?.am?.badge ?? ""}
        />
      </div>
    ) : (
      <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground/60 italic">
        Data funnel tidak tersedia untuk filter yang dipilih.
      </div>
    );

  return (
      <>
        {/* ─── Banner: Avatar + Name + Info + Tab Menu ─────────────────────────── */}
        <div className="relative w-full overflow-hidden min-h-[160px] md:min-h-[200px]">
          <img alt="" className="absolute inset-0 w-full h-full object-cover object-right scale-[1.2]" src="/login-bg.jpg" />
          <div className="absolute inset-0 bg-gradient-to-br from-red-900/80 via-red-800/70 to-orange-700/60 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
          <div className="relative z-10 flex flex-col justify-between h-full px-6 md:px-10 pb-0 pt-5">
            {/* Top: Avatar + Name + Info */}
            <div className="flex items-center gap-5">
              <div className="relative flex-shrink-0">
                <div className="w-16 h-16 md:w-[88px] md:h-[88px] rounded-2xl bg-white/20 backdrop-blur-md border-2 border-white/40 flex items-center justify-center text-2xl md:text-3xl font-black text-white shadow-xl overflow-hidden">
                  {photoSrc && !photoError ? (
                    <img src={photoSrc} alt={am.nama} className="absolute inset-0 w-full h-full object-cover" onError={() => setPhotoError(true)} />
                  ) : null}
                  <span className="relative z-10 select-none">{am.nama.split(" ").slice(0, 3).map(w => w.charAt(0)).join("")}</span>
                </div>
                <div className="absolute -bottom-1 -right-1">
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-500 hover:bg-blue-600 border-2 border-white flex items-center justify-center transition-colors disabled:opacity-50 shadow-md">
                    {uploading ? <Loader2 className="w-3 h-3 md:w-3.5 md:h-3.5 text-white animate-spin" /> : <Upload className="w-3 h-3 md:w-3.5 md:h-3.5 text-white" />}
                  </button>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl md:text-3xl font-black uppercase tracking-wider text-white drop-shadow-lg leading-tight mb-2 truncate">{am.nama}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex flex-col justify-center px-2.5 py-1 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[8px] md:text-[9px] text-white/70 font-semibold leading-none uppercase tracking-wide">NIK</span>
                    <span className="text-[11px] md:text-[12px] text-white font-black leading-none mt-0.5">{am.nik}</span>
                  </div>
                  <div className="flex flex-col justify-center px-2.5 py-1 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[8px] md:text-[9px] text-white/70 font-semibold leading-none uppercase tracking-wide">Witel</span>
                    <span className="text-[11px] md:text-[12px] text-white font-black leading-none mt-0.5">{am.witel ?? "—"}</span>
                  </div>
                  <div className="flex flex-col justify-center px-2.5 py-1 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[8px] md:text-[9px] text-white/70 font-semibold leading-none uppercase tracking-wide">Divisi</span>
                    <span className="text-[11px] md:text-[12px] text-white font-black leading-none mt-0.5">{am.divisi ?? "—"}</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Bottom: Tab Menu */}
            <div className="flex items-center gap-0 mt-auto pt-[30px]">
              {([
                { id: "performansi" as TabId, label: "PERFORMANSI", icon: BarChart2 },
                { id: "salesFunnel" as TabId, label: "SALES FUNNEL", icon: Filter },
                { id: "salesActivity" as TabId, label: "SALES ACTIVITY", icon: Activity },
                { id: "prognosa" as TabId, label: "PROGNOSA FY", icon: TrendingUp },
              ]).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setEmbTab(id)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-2 text-[11px] md:text-xs font-bold uppercase tracking-wide transition-colors whitespace-nowrap border-b-[3px]",
                    embTab === id
                      ? "text-white border-white"
                      : "text-white/50 border-white/20 hover:text-white/80"
                  )}>
                  <Icon className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="w-full pt-5 px-6 md:px-8 lg:px-12 xl:px-[120px]">

          {/* Tab: Performansi */}
          {embTab === "performansi" && (
            <div className="w-full">
              {/* ── Filter Section ─────────────────────────────────── */}
              <div className="border border-border rounded-xl overflow-hidden mb-4">
                <div className="grid grid-cols-4 divide-x divide-border">
                  {/* Snapshot */}
                  <div className="flex flex-col gap-1 p-3">
                    <label className="text-[10px] font-display font-bold text-foreground uppercase tracking-wide">Snapshot</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                          <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                            {data?.snapshots?.find(s => s.id === selectedSnapshot)?.label ?? "Pilih Snapshot"}
                          </span>
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 160 }}>
                        <div className="bg-popover border border-border rounded-xl shadow-lg min-w-[140px] max-h-60 overflow-y-auto py-1">
                          {(data?.snapshots ?? []).map(s => (
                            <button key={s.id} onClick={() => { setSelectedSnapshot(s.id); setSelectedPeriodes(new Set()); }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2">
                              <span className="w-3.5 shrink-0 flex items-center justify-center">
                                {selectedSnapshot === s.id && <Check className="w-3 h-3 text-primary" />}
                              </span>
                              <span className={cn(selectedSnapshot === s.id ? "font-semibold text-primary" : "")}>{s.label}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Periode */}
                  <div className="flex flex-col gap-1 p-3">
                    <label className="text-[10px] font-display font-bold text-foreground uppercase tracking-wide">Periode</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                          <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                            {selectedPeriodes.size === availablePeriodes.length ? `Semua (${availablePeriodes.length})`
                              : selectedPeriodes.size === 0 ? `Pilih Periode`
                              : `${selectedPeriodes.size} Periode dipilih`}
                          </span>
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 200 }}>
                        <div className="bg-popover border border-border rounded-xl shadow-lg min-w-[180px] max-h-72 overflow-y-auto p-1.5">
                          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border mb-1">
                            <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">Periode</span>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedPeriodes(new Set(availablePeriodes)); }}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary font-semibold transition-colors">
                                Semua
                              </button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedPeriodes(new Set()); }}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-secondary hover:bg-secondary/80 text-muted-foreground font-semibold transition-colors">
                                Kosongkan
                              </button>
                            </div>
                          </div>
                          {availablePeriodes.map(p => {
                            const [y, m] = p.split("-");
                            const monthIdx = parseInt(m) - 1;
                            const label = `${MONTHS_SHORT[monthIdx]} ${y}`;
                            const isSelected = selectedPeriodes.has(p);
                            return (
                              <label key={p} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary cursor-pointer text-xs">
                                <input type="checkbox" checked={isSelected}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    setSelectedPeriodes(prev => {
                                      const next = new Set(prev);
                                      if (next.has(p)) { next.delete(p); }
                                      else { next.add(p); }
                                      return next;
                                    });
                                  }}
                                  style={{ accentColor: "hsl(0, 84%, 60%)" }}
                                  className="rounded cursor-pointer w-3.5 h-3.5" />
                                <span className="flex-1">{label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Divisi */}
                  <div className="flex flex-col gap-1 p-3">
                    <label className="text-[10px] font-display font-bold text-foreground uppercase tracking-wide">Divisi</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                          <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                            {DIVISI_OPTIONS_EMB.find(o => o.value === selectedDivisi)?.label ?? "LESA (All)"}
                          </span>
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 160 }}>
                        <div className="bg-popover border border-border rounded-xl shadow-lg min-w-[140px] max-h-60 overflow-y-auto py-1">
                          {DIVISI_OPTIONS_EMB.map(o => (
                            <button key={o.value} onClick={() => setSelectedDivisi(o.value)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2">
                              <span className="w-3.5 shrink-0 flex items-center justify-center">
                                {selectedDivisi === o.value && <Check className="w-3 h-3 text-primary" />}
                              </span>
                              <span className={cn(selectedDivisi === o.value ? "font-semibold text-primary" : "")}>{o.label}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Revenue */}
                  <div className="flex flex-col gap-1 p-3">
                    <label className="text-[10px] font-display font-bold text-foreground uppercase tracking-wide">Revenue</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                          <span className="flex-1 text-left truncate font-medium text-foreground text-xs">{selectedRevenue}</span>
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 140 }}>
                        <div className="bg-popover border border-border rounded-xl shadow-lg min-w-[140px] max-h-60 overflow-y-auto py-1">
                          {REVENUE_OPTIONS.map(o => (
                            <button key={o.value} onClick={() => setSelectedRevenue(o.value)}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2">
                              <span className="w-3.5 shrink-0 flex items-center justify-center">
                                {selectedRevenue === o.value && <Check className="w-3 h-3 text-primary" />}
                              </span>
                              <span className={cn(selectedRevenue === o.value ? "font-semibold text-primary" : "")}>{o.label}</span>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>

              {/* ── Cards Section ──────────────────────────────────── */}
              {(loading || rankLoading) ? (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-secondary/50 border border-border rounded-xl p-3 h-[88px] animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {/* TARGET | REAL */}
                  <div className="col-span-2 bg-secondary/50 border border-border rounded-xl p-3 flex items-stretch h-[88px] overflow-hidden">
                    {/* TARGET */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-none">Target</div>
                      <div className="text-2xl font-black tabular-nums leading-none text-foreground">{fmtRupiahShort(data?.summary?.totalTarget ?? 0)}</div>
                      <div className="text-[10px] font-medium leading-none" style={{ color: "#1e1e1e" }}>
                        {latestPeriode ? (() => { const [y, m] = latestPeriode.split("-"); return `${MONTHS_SHORT[parseInt(m) - 1]} ${y}`; })() : "—"}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center">
                      <Sparkline values={monthlyData.targetValues} color="#10b981" />
                    </div>
                    <div className="w-px bg-border mx-1 shrink-0" />
                    {/* REAL */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-none">Real</div>
                      <div className="text-2xl font-black tabular-nums leading-none text-blue-600">{fmtRupiahShort(data?.summary?.totalReal ?? 0)}</div>
                      <div className="text-[10px] font-medium leading-none" style={{ color: "#1e1e1e" }}>
                        {latestPeriode ? (() => { const [y, m] = latestPeriode.split("-"); return `${MONTHS_SHORT[parseInt(m) - 1]} ${y}`; })() : "—"}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center">
                      <Sparkline values={monthlyData.realValues} color="#3b82f6" />
                    </div>
                  </div>
                  {/* ACH CM | RANK CM */}
                  <div className="bg-secondary/50 border border-border rounded-xl p-3 flex items-stretch h-[88px] overflow-hidden">
                    {/* ACH CM */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-none">ACH CM</div>
                      <div className="text-2xl font-black tabular-nums leading-none text-emerald-600">{fmtPct(data?.summary?.achRate ?? 0)}</div>
                      <div className="text-[10px] font-medium leading-none" style={{ color: "#1e1e1e" }}>{latestPeriode ? (() => { const [y, m] = latestPeriode.split("-"); return `${MONTHS_SHORT[parseInt(m) - 1]} ${y}`; })() : "—"}</div>
                    </div>
                    <div className="w-px bg-border mx-1 shrink-0" />
                    {/* RANK CM */}
                    <div className="flex-1 flex flex-col justify-between min-w-0 text-center">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-none">RANK CM</div>
                      <div className="text-2xl font-black tabular-nums leading-none text-violet-600">
                        {embRankCM?.myRank != null ? `#${embRankCM.myRank}/${embRankCM.totalCount}` : rankLoading ? <span className="animate-pulse text-muted-foreground">…</span> : "—"}
                      </div>
                      <div className="text-[10px] font-medium leading-none" style={{ color: "#1e1e1e" }}>{latestPeriode ? (() => { const [y, m] = latestPeriode.split("-"); return `${MONTHS_SHORT[parseInt(m) - 1]} ${y}`; })() : "—"}</div>
                    </div>
                  </div>
                  {/* ACH YTD | RANK YTD */}
                  <div className="bg-secondary/50 border border-border rounded-xl p-3 flex items-stretch h-[88px] overflow-hidden">
                    {/* ACH YTD */}
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-none">ACH YTD</div>
                      <div className="text-2xl font-black tabular-nums leading-none text-emerald-600">{fmtPct(ytdAch)}</div>
                      <div className="text-[10px] font-medium leading-none" style={{ color: "#1e1e1e" }}>{ytdPeriodeLabel ?? "—"}</div>
                    </div>
                    <div className="w-px bg-border mx-1 shrink-0" />
                    {/* RANK YTD */}
                    <div className="flex-1 flex flex-col justify-between min-w-0 text-center">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide leading-none">RANK YTD</div>
                      <div className="text-2xl font-black tabular-nums leading-none text-orange-500">
                        {embRankYtd?.myRank != null ? `#${embRankYtd.myRank}/${embRankYtd.totalCount}` : rankLoading ? <span className="animate-pulse text-muted-foreground">…</span> : "—"}
                      </div>
                      <div className="text-[10px] font-medium leading-none" style={{ color: "#1e1e1e" }}>{ytdPeriodeLabel ?? "—"}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Table Section ──────────────────────────────────── */}
              <div className="rounded-xl border-2 border-rose-200 overflow-hidden">
                {/* Table Header */}
                <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold text-foreground shrink-0">AM Performance Report</h3>
                    {/* Search */}
                    <div className="relative w-80 shrink-0">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                      <input placeholder="Cari pelanggan, NIP…" value={customerSearch}
                        onChange={e => setCustomerSearch(e.target.value)}
                        className="w-full pl-7 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/60" />
                    </div>
                    {/* Expand */}
                    <button className="h-7 px-2.5 rounded-lg text-xs font-semibold border border-border bg-secondary hover:border-primary/40 hover:text-primary text-foreground transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden="true"><path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M21 16v5h-5"/><path d="M21 8V3h-5"/><path d="M3 16v5h5"/><path d="m3 21 6-6"/><path d="M3 8V3h5"/><path d="M9 9 3 3"/></svg>
                      Expand Semua
                    </button>
                    {/* Decimal toggle */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Decimal:</span>
                      <button
                        onClick={() => setDecimalPrecision(d => d === 1 ? 2 : 1)}
                        className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", decimalPrecision === 1 ? "bg-muted" : "bg-primary")}
                        title={decimalPrecision === 1 ? "1 desimal" : "2 desimal"}>
                        <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform", decimalPrecision === 1 ? "translate-x-1" : "translate-x-5")} />
                      </button>
                      <span className="text-[10px] font-bold text-foreground tabular-nums">{data?.summary?.achRate?.toFixed(decimalPrecision) ?? "0.0"}%</span>
                    </div>
                  </div>
                </div>

                {/* Table Body */}
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-rose-500" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table style={{ minWidth: tableViewMode === "perbulan" ? 820 : 780, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, width: "100%" }}
                      className="w-full">
                      <colgroup>
                        <col style={{ width: 28 }} />
                        <col style={{ width: 220 }} />
                        <col style={{ width: 82 }} />
                        {tableViewMode === "perbulan" && <col style={{ width: 80 }} />}
                        <col style={{ width: 68 }} />
                        <col style={{ width: 140 }} />
                        <col style={{ width: 140 }} />
                        <col style={{ width: 72 }} />
                      </colgroup>
                      <thead style={{ position: "static", zIndex: 0 }}>
                        <tr style={{ background: "#fff1f2", borderTop: "1px solid #fecdd3", borderBottom: "2px solid #fecdd3" }}>
                          <th className="px-2 py-2 text-center text-sm font-black text-rose-700 uppercase tracking-wide">#</th>
                          <th className="px-4 py-2 text-left text-sm font-black text-rose-700 uppercase tracking-wide">
                            <div className="flex items-center gap-2">
                              <span>Pelanggan / NIP</span>
                              <span className="flex items-center rounded-full border border-rose-300 overflow-hidden text-[10px] font-bold ml-1">
                                <button onClick={() => setTableViewMode("agregasi")}
                                  className={cn("px-2 py-0.5 transition-colors", tableViewMode === "agregasi" ? "bg-rose-700 text-white" : "text-rose-700 hover:bg-rose-200")}>
                                  Agregasi
                                </button>
                                <button onClick={() => setTableViewMode("perbulan")}
                                  className={cn("px-2 py-0.5 transition-colors", tableViewMode === "perbulan" ? "bg-rose-700 text-white" : "text-rose-700 hover:bg-rose-200")}>
                                  Per Bulan
                                </button>
                              </span>
                            </div>
                          </th>
                          <th className="px-3 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Proporsi</th>
                          {tableViewMode === "perbulan" && (
                            <th className="px-3 py-2 text-center text-sm font-black text-rose-700 uppercase tracking-wide">Periode</th>
                          )}
                          <th className="px-3 py-2 text-center text-sm font-black text-rose-700 uppercase tracking-wide">Divisi</th>
                          <th className="px-4 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Target</th>
                          <th className="px-4 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Real/Sustain/Scaling</th>
                          <th className="px-3 py-2 text-right text-sm font-black text-rose-700 uppercase tracking-wide">Ach %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          if (tableData.allFiltered.length === 0) {
                            return <tr><td colSpan={tableViewMode === "perbulan" ? 8 : 7} className="px-4 py-10 text-center text-sm text-slate-400">
                              {selectedPeriodes.size === 0 ? "Pilih periode terlebih dahulu untuk melihat data" : "Belum ada data pelanggan"}
                            </td></tr>;
                          }
                          if (tableViewMode === "agregasi") {
                            return tableData.rows.map((cust: any, idx) => {
                              const achPct = cust.achRate ?? 0;
                              const achColor = achPct >= 100 ? "text-green-600" : achPct >= 80 ? "text-orange-500" : "text-red-500";
                              const rowBg = idx % 2 === 0 ? "bg-white" : "bg-rose-50/40";
                              return (
                                <tr key={idx} className={cn("transition-colors hover:bg-rose-50", rowBg)}>
                                  <td className="px-2 py-2 text-center text-[11px] text-muted-foreground font-mono">{(tableData.currentPage - 1) * tablePageSize + idx + 1}</td>
                                  <td className="px-4 py-2 overflow-hidden">
                                    <div className="text-xs font-bold text-foreground leading-snug truncate" title={cust.pelanggan || ""}>{cust.pelanggan || "-"}</div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5">{cust.nip || "-"}</div>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <div className="w-8 h-1.5 bg-secondary rounded-full overflow-hidden shrink-0">
                                        <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(100, achPct)}%` }} />
                                      </div>
                                      <span className="text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{achPct.toFixed(decimalPrecision)}%</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold",
                                      (cust.divisi === "DPS" || cust.divisiCc === "DPS") ? "bg-blue-100 text-blue-700" :
                                      (cust.divisi === "DSS" || cust.divisiCc === "DSS") ? "bg-emerald-100 text-emerald-700" :
                                      "bg-slate-100 text-slate-600"
                                    )}>{cust.divisi || cust.divisiCc || "-"}</span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(cust.targetTotal)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-black text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(cust.realTotal)}</td>
                                  <td className={cn("px-3 py-2 text-right text-xs font-black tabular-nums", achColor)}>{achPct.toFixed(decimalPrecision)}%</td>
                                </tr>
                              );
                            });
                          }
                          return tableData.rows.map((row: any, idx) => {
                            const achPct = row.achRate ?? 0;
                            const achColor = achPct >= 100 ? "text-green-600" : achPct >= 80 ? "text-orange-500" : "text-red-500";
                            const rowBg = idx % 2 === 0 ? "bg-white" : "bg-rose-50/40";
                            const periodeLabel = row.bulan && row.tahun
                              ? `${MONTHS_SHORT[(row.bulan as number) - 1]} ${row.tahun}`
                              : "-";
                            return (
                              <tr key={idx} className={cn("transition-colors hover:bg-rose-50", rowBg)}>
                                <td className="px-2 py-2 text-center text-[11px] text-muted-foreground font-mono">{(tableData.currentPage - 1) * tablePageSize + idx + 1}</td>
                                <td className="px-4 py-2 overflow-hidden">
                                  <div className="text-xs font-bold text-foreground leading-snug truncate" title={row.pelanggan || ""}>{row.pelanggan || "-"}</div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">{row.nip || "-"}</div>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <div className="w-8 h-1.5 bg-secondary rounded-full overflow-hidden shrink-0">
                                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(100, achPct)}%` }} />
                                    </div>
                                    <span className="text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{achPct.toFixed(decimalPrecision)}%</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-100 text-rose-700 whitespace-nowrap">{periodeLabel}</span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold",
                                    (row.divisi === "DPS" || row.divisiCc === "DPS") ? "bg-blue-100 text-blue-700" :
                                    (row.divisi === "DSS" || row.divisiCc === "DSS") ? "bg-emerald-100 text-emerald-700" :
                                    "bg-slate-100 text-slate-600"
                                  )}>{row.divisi || row.divisiCc || "-"}</span>
                                </td>
                                <td className="px-4 py-2 text-right text-xs font-semibold text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(row.targetTotal)}</td>
                                <td className="px-4 py-2 text-right text-xs font-black text-foreground tabular-nums whitespace-nowrap">{fmtRupiah(row.realTotal)}</td>
                                <td className={cn("px-3 py-2 text-right text-xs font-black tabular-nums", achColor)}>{achPct.toFixed(decimalPrecision)}%</td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                  )}

                  {/* Pagination */}
                  {selectedPeriodes.size === 0 ? null : (
                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-secondary/20">
                      {/* Left: row count + page size */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {tableData.allFiltered.length > 0
                            ? `${(tableData.currentPage - 1) * tablePageSize + 1}–${Math.min(tableData.currentPage * tablePageSize, tableData.allFiltered.length)} dari ${tableData.allFiltered.length}`
                            : "0 data"}
                        </span>
                        <select value={tablePageSize} onChange={e => { setTablePageSize(Number(e.target.value)); setTablePage(1); }}
                          className="h-6 px-1.5 text-[10px] border border-border rounded bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/40">
                          <option value={10}>10 / hal</option>
                          <option value={25}>25 / hal</option>
                          <option value={50}>50 / hal</option>
                          <option value={100}>100 / hal</option>
                        </select>
                      </div>
                      {/* Right: prev / page numbers / next */}
                      <div className="flex items-center gap-1">
                        <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tableData.currentPage <= 1}
                          className="h-6 w-6 flex items-center justify-center rounded text-[10px] font-semibold border border-border bg-secondary hover:bg-primary/10 hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                        {Array.from({ length: tableData.totalPages }, (_, i) => i + 1).reduce((pages: number[], page) => {
                          if (page === 1 || page === tableData.totalPages || (page >= tableData.currentPage - 1 && page <= tableData.currentPage + 1)) {
                            pages.push(page);
                          } else if (pages[pages.length - 1] !== 0) {
                            pages.push(0);
                          }
                          return pages;
                        }, []).map((page, i) =>
                          page === 0
                            ? <span key={`ellipsis-${i}`} className="text-[10px] text-muted-foreground px-0.5">…</span>
                            : <button key={page} onClick={() => setTablePage(page)}
                                className={cn("h-6 min-w-[24px] px-1 flex items-center justify-center rounded text-[10px] font-semibold border transition-colors",
                                  page === tableData.currentPage
                                    ? "bg-primary text-white border-primary"
                                    : "border-border bg-secondary hover:bg-primary/10 hover:border-primary/40 text-foreground"
                                )}>
                                {page}
                              </button>
                        )}
                        <button onClick={() => setTablePage(p => Math.min(tableData.totalPages, p + 1))} disabled={tableData.currentPage >= tableData.totalPages}
                          className="h-6 w-6 flex items-center justify-center rounded text-[10px] font-semibold border border-border bg-secondary hover:bg-primary/10 hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}</div></div>)}
                {/* Tab: Sales Funnel */}
                {embTab === "salesFunnel" && funnelContent}
                {/* Tab: Sales Activity */}
          {embTab === "salesActivity" && (
            <div className="w-full">
              <div className="text-sm text-muted-foreground/60 italic">Konten Sales Activity — dalam pengembangan</div>
            </div>
          )}

          {/* Tab: Prognosa */}
          {embTab === "prognosa" && (
            <div className="w-full">
              <div className="text-sm text-muted-foreground/60 italic">Konten Prognosa FY — dalam pengembangan</div>
            </div>
          )}
        </div>
      </>
    );
  }

  // ── STANDALONE VERSION ─────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-red-600 mx-auto mb-2" />
        <p className="text-sm text-slate-500">Memuat profil...</p>
      </div>
    </div>
  );
  if (error || !data || !data.am) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="text-center text-slate-500">{error ?? "Profil tidak ditemukan"}</div>
    </div>
  );

  const { am, summary, customers } = data;
  const photoSrc = am.photoUrl ? (am.photoUrl.startsWith("http") ? am.photoUrl : `${API_BASE}${am.photoUrl}`) : null;

  return (
    <React.Fragment>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Header */}
        <div className="relative w-full py-10 px-6 bg-cover bg-center" style={{ backgroundImage: "url('/login-bg.jpg')" }}>
          <div className="absolute inset-0 bg-gradient-to-r from-red-800/85 to-red-600/70" />
          <div className="relative z-10 max-w-4xl mx-auto">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-md border-2 border-white/40 flex items-center justify-center text-4xl font-black text-white shadow-xl overflow-hidden">
                {photoSrc ? <img src={photoSrc} alt={am.nama} className="w-full h-full object-cover" /> : am.nama.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-white drop-shadow-lg">{am.nama}</h1>
                <p className="text-red-200 font-mono text-sm">NIK {am.nik}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {am.divisi && <span className="text-xs px-2 py-0.5 rounded bg-white/20 text-white font-semibold">{am.divisi}</span>}
                  <Badge badge={am.badge} />
                  {am.witel && <span className="text-xs text-red-200">{am.witel}</span>}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={cn("text-3xl font-black", summary.achRate >= 100 ? "text-emerald-300" : summary.achRate >= 80 ? "text-yellow-300" : "text-white")}>{fmtPct(summary.achRate)}</div>
                <div className="text-white/70 text-xs">{summary.periodText}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="max-w-4xl mx-auto px-6 -mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Target", value: fmtRupiah(summary.totalTarget), color: "text-slate-700" },
              { label: "Total Realisasi", value: fmtRupiah(summary.totalReal), color: summary.achRate >= 100 ? "text-emerald-600" : "text-slate-700" },
              { label: "Achievement", value: fmtPct(summary.achRate), color: summary.achRate >= 100 ? "text-emerald-600" : summary.achRate >= 80 ? "text-yellow-600" : "text-red-600" },
              { label: "Jumlah Pelanggan", value: String(summary.customerCount), color: "text-slate-700" },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <p className="text-xs text-slate-500 mb-1">{card.label}</p>
                <p className={cn("text-xl font-bold", card.color)}>{card.value}</p>
                {card.label === "Achievement" && (
                  <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", summary.achRate >= 100 ? "from-emerald-500 to-emerald-400" : summary.achRate >= 80 ? "from-yellow-400 to-yellow-300" : "from-red-500 to-red-400")}
                      style={{ width: `${Math.min(100, summary.achRate)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Customer Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mt-4 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 text-sm">Detail Pelanggan</h3>
              <span className="text-xs text-slate-500">{summary.customerCount} pelanggan</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 w-8">#</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Pelanggan</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">NIPNAS</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Divisi</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600">Segmen</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Target</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Realisasi</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-600">Ach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">Belum ada data pelanggan</td></tr>
                  ) : (
                    customers.map((cust, idx) => {
                      const achClass = cust.achRate >= 100 ? "text-emerald-700 bg-emerald-50" : cust.achRate >= 80 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2.5 text-slate-400 text-xs">{idx + 1}</td>
                          <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[200px] truncate">{cust.pelanggan || "-"}</td>
                          <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">{cust.nip || "-"}</td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cust.divisi === "DPS" || cust.divisiCc === "DPS" ? "bg-blue-100 text-blue-700" : cust.divisi === "DSS" || cust.divisiCc === "DSS" ? "bg-green-100 text-green-700" : cust.divisi === "DGS" || cust.divisiCc === "DGS" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"}`}>
                              {cust.divisi || cust.divisiCc || "-"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 text-xs">{cust.segmen || "-"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtRupiah(cust.targetTotal)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtRupiah(cust.realTotal)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${achClass}`}>{fmtPct(cust.achRate)}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 text-right">
              Total: {customers.length} pelanggan
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}
