import React, { useState, useEffect, useRef, useMemo, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, Upload, TrendingUp, ChevronDown, Check,
  ChevronLeft, ChevronRight, BarChart2, Filter, Activity, Search,
  ArrowRight, PlusCircle, AlertTriangle, MinusCircle
} from "lucide-react";
import { Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { getPresentationSession } from "@/shared/hooks/use-presentation-auth";
import { cn, formatRupiahFull } from "@/shared/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Card, CardContent } from "@/shared/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
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
const MONTHS_FULL = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const KATEGORI_OPTIONS = [
  { value: "dengan_pelanggan", label: "Dengan Pelanggan" },
  { value: "proyek", label: "Pelanggan Dengan Proyek" },
  { value: "tanpa", label: "Tanpa Pelanggan" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtRupiah = (n: number) => formatRupiahFull(n);
const fmtRupiahShort = (n: number) => {
  if (n >= 1_000_000_000_000) return `Rp ${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}JT`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}Rb`;
  return `Rp ${n.toFixed(0)}`;
};
const fmtNilai = (n: number) => {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}JT`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}Rb`;
  return `${n.toFixed(0)}`;
};
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ─── Trend Chart Custom Tooltip ─────────────────────────────────────────────────
const TrendTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const real = payload.find((p: any) => p.dataKey === "real");
  const target = payload.find((p: any) => p.dataKey === "target");
  const ach = payload.find((p: any) => p.dataKey === "ach");
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg" style={{ fontSize: 11 }}>
      <p className="font-bold mb-1.5">{label}</p>
      {real && <p className="text-green-600">Real: <span className="font-semibold">{fmtRupiahShort(real.value)}</span></p>}
      {target && <p className="text-blue-600">Target: <span className="font-semibold">{fmtRupiahShort(target.value)}</span></p>}
      {ach && <p className="text-red-600">Ach %: <span className="font-semibold">{ach.value.toFixed(1)}%</span></p>}
    </div>
  );
};

// ─── Phase Color Helpers ───────────────────────────────────────────────────────
const PHASE_COLORS_MAP: Record<string, string> = {
  F0: "#0ea5e9", F1: "#3b82f6", F2: "#6366f1",
  F3: "#7c3aed", F4: "#f97316", F5: "#10b981",
};
const PHASE_TEXT_COLORS: Record<string, string> = {
  F0: "text-sky-600", F1: "text-blue-600", F2: "text-indigo-600",
  F3: "text-violet-600", F4: "text-orange-600", F5: "text-emerald-600",
};
const PHASE_BG_COLORS: Record<string, string> = {
  F0: "bg-sky-100 text-sky-700", F1: "bg-blue-100 text-blue-700", F2: "bg-indigo-100 text-indigo-700",
  F3: "bg-violet-100 text-violet-700", F4: "bg-orange-100 text-orange-700", F5: "bg-emerald-100 text-emerald-700",
};
const PHASE_ACCENT_COLORS: Record<string, string> = {
  F0: "border-l-sky-400", F1: "border-l-blue-400", F2: "border-l-indigo-400",
  F3: "border-l-violet-400", F4: "border-l-orange-400", F5: "border-l-emerald-400",
};

// ─── Pergerakan Funnel Item Row (card style) ───────────────────────────────────
interface PergerakanItem {
  lopid: string;
  judulProyek: string;
  pelanggan: string;
  nilaiProyek: number;
  statusF: string;
  prevStatusF?: string;
  divisi: string | null;
  kategoriKontrak: string | null;
  reportDate: string | null;
  monthSubs: number | null;
  isNew?: boolean;
}

function PergerakanItemRow({ item, variant, index }: { item: PergerakanItem; variant: "new" | "changed" | "stagnant"; index: number }) {
  const durasiLabel = (!item.monthSubs || item.monthSubs <= 0)
    ? "–"
    : item.monthSubs % 12 === 0
      ? `${item.monthSubs / 12} Thn`
      : `${item.monthSubs} Bln`;

  const divisiColor = (d: string | null) => {
    if (!d) return "bg-gray-100 text-gray-600";
    if (d.toUpperCase() === "DPS") return "bg-blue-100 text-blue-800 font-bold";
    if (d.toUpperCase() === "DSS") return "bg-purple-100 text-purple-800 font-bold";
    return "bg-gray-100 text-gray-600";
  };

  const phaseBg = PHASE_BG_COLORS[item.statusF] ?? "bg-gray-100 text-gray-700";
  const prevPhaseBg = item.prevStatusF ? (PHASE_BG_COLORS[item.prevStatusF] ?? "bg-gray-100 text-gray-700") : "";
  const accentColor = PHASE_ACCENT_COLORS[item.statusF] ?? "border-l-gray-400";

  const statusBadge = variant === "new"
    ? { label: "BARU", bg: "bg-blue-600", text: "text-white" }
    : variant === "changed"
    ? { label: "BERUBAH", bg: "bg-amber-500", text: "text-white" }
    : { label: "STAGNAN", bg: "bg-gray-800", text: "text-white" };

  const reportDate = item.reportDate
    ? new Date(item.reportDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    : "–";

  const cardBorder = variant === "new"
    ? "border-blue-200"
    : variant === "changed"
    ? "border-amber-200"
    : "border-gray-200";

  return (
    <div className={cn(
      "rounded-2xl border bg-white shadow-sm overflow-hidden",
      "border-l-4",
      accentColor,
      cardBorder
    )}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Number */}
        <span className="text-sm font-bold w-6 text-right shrink-0" style={{ color: "#1e1e1e" }}>{index}</span>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-200 shrink-0" />

        {/* LOP ID + phase */}
        <div className="flex flex-col gap-1 w-[115px] shrink-0">
          <span className="font-mono text-xs font-extrabold text-gray-900">{item.lopid}</span>
          <div className="flex items-center gap-1 flex-wrap">
            {variant === "changed" && item.prevStatusF && (
              <>
                <span className={cn("inline-flex items-center px-1 py-0.5 rounded text-[10px] font-bold", prevPhaseBg)}>LOP {item.prevStatusF}</span>
                <span className="text-gray-400 text-xs">→</span>
              </>
            )}
            <span className={cn("inline-flex items-center px-1 py-0.5 rounded text-[10px] font-bold", phaseBg)}>LOP {item.statusF}</span>
          </div>
        </div>

        {/* Judul proyek */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900 leading-snug line-clamp-2">{item.judulProyek}</div>
        </div>

        {/* Pelanggan */}
        <div className="w-[125px] shrink-0">
          <div className="text-xs font-bold text-gray-800 truncate">{item.pelanggan}</div>
          <div className="flex items-center gap-1 mt-0.5">
            {item.divisi && (
              <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold", divisiColor(item.divisi))}>
                {item.divisi}
              </span>
            )}
            <span className="text-[10px] text-gray-700 font-medium">{item.kategoriKontrak ?? "–"}</span>
          </div>
        </div>

        {/* Nilai */}
        <div className="w-[150px] text-right shrink-0">
          <div className="text-sm font-black text-gray-900 tabular-nums">{formatRupiahFull(item.nilaiProyek)}</div>
          <div className="text-[11px] text-gray-700 font-medium mt-0.5">{reportDate} · {durasiLabel}</div>
        </div>

        {/* Status badge */}
        <div className="w-[80px] text-right shrink-0">
          <span className={cn("inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black shrink-0", statusBadge.bg, statusBadge.text)}>
            {statusBadge.label}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Pergerakan Funnel Section ───────────────────────────────────────────────
function PergerakanSection({
  snapshotComparison,
  funnelData,
  amNama,
}: {
  snapshotComparison: SnapshotComparison;
  funnelData: any;
  amNama: string;
}) {
  const { newLops, changedStatus, stagnanLops, stagnanCount, prevCR, crDelta, currCR, totalTercakup } = snapshotComparison;
  const currentSnapshotLabel = funnelData?.snapshots?.find((s: any) => s.id === funnelData.selectedSnapshotId)?.label ?? "";
  const prevSnapshotLabel = funnelData?.snapshots?.find((s: any) => s.id === funnelData.prevSnapshotId)?.label ?? "";

  // Count by kategoriKontrak for each group
  const countByKat = (lops: any[]) => {
    const counts: Record<string, number> = {};
    for (const l of lops) {
      const k = l.kategoriKontrak ?? "(kosong)";
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  };
  const fmtKat = (counts: Record<string, number>) => {
    const parts: string[] = [];
    if (counts["GTMA"]) parts.push(`${counts["GTMA"]} GTMA`);
    if (counts["Own Channel"]) parts.push(`${counts["Own Channel"]} Own Channel`);
    if (counts["New GTMA"]) parts.push(`${counts["New GTMA"]} New GTMA`);
    if (counts["(kosong)"]) parts.push(`${counts["(kosong)"]} Uncategorized`);
    const uncategorized = Object.entries(counts).filter(([k]) => !["GTMA", "Own Channel", "New GTMA", "(kosong)"].includes(k));
    for (const [k, v] of uncategorized) parts.push(`${v} ${k}`);
    return parts.length > 0 ? `(${parts.join(", ")})` : "";
  };

  const stagnanByKat = countByKat(stagnanLops);
  const newByKat = countByKat(newLops);
  const changedByKat = countByKat(changedStatus);
  const stagnanBreakdown = fmtKat(stagnanByKat);
  const stagnanSuffix = stagnanBreakdown
    ? `${stagnanBreakdown}${newLops.length > 0 || changedStatus.length > 0 ? ` — ${newLops.length > 0 ? `${fmtKat(newByKat)} LOP baru${changedStatus.length > 0 ? " dan" : ""}` : ""}${changedStatus.length > 0 ? ` ${fmtKat(changedByKat)} LOP berubah` : ""}` : ""}.`
    : ".";

  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    new: newLops.length > 0,
    changed: changedStatus.length > 0,
    stagnant: stagnanCount > 0,
  });

  if (!prevSnapshotLabel) return null;

  const toggleCategory = (key: string) =>
    setOpenCategories(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-200">
        <h2 className="text-base font-bold text-gray-900 leading-tight">
          Laporan Pergerakan Funnel
        </h2>
        <p className="text-xs text-gray-800 mt-2 leading-relaxed">
          Berikut adalah laporan Perkembangan LOP berdasarkan data dari snapshot terbaru{" "}
          <span className="font-bold">{currentSnapshotLabel}</span> (#{funnelData.selectedSnapshotId}) dibandingkan dengan snapshot sebelumnya{" "}
          <span className="font-bold">{prevSnapshotLabel}</span> (#{funnelData.prevSnapshotId}). Berdasarkan hasil analisis, kak{" "}
          <span className="font-semibold">{amNama}</span>, memiliki total{" "}
          <span className="font-semibold">{totalTercakup} LOP</span> hingga saat ini, yang terbagi ke dalam{" "}
          <span className="font-semibold">{newLops.length} LOP baru</span> yang ditambahkan,{" "}
          <span className="font-semibold">{changedStatus.length} LOP</span> yang mengalami
          pergerakan status, dan{" "}
          <span className="font-semibold">{stagnanCount} LOP</span> yang masih stagnan
          pergerakannya {stagnanSuffix} Berdasarkan capaian funneling saat ini kak{" "}
          <span className="font-semibold">{amNama}</span> memiliki CR sebesar{" "}
          <span className="font-semibold">{fmtPct(currCR)}</span>.
        </p>
      </div>

      {/* Summary Pills */}
      <div className="flex border-b border-gray-200">
        {[
          { key: "new", label: "LOP Baru", count: newLops.length, icon: PlusCircle, color: "text-blue-600", bg: "bg-blue-50", hover: "hover:bg-blue-100" },
          { key: "changed", label: "Status Berubah", count: changedStatus.length, icon: ArrowRight, color: "text-amber-600", bg: "bg-amber-50", hover: "hover:bg-amber-100" },
          { key: "stagnant", label: "Belum Bergerak", count: stagnanCount, icon: MinusCircle, color: "text-orange-600", bg: "bg-orange-50", hover: "hover:bg-orange-100" },
        ].map(({ key, label, count, icon: Icon, color, bg, hover }) => (
          <button
            key={key}
            onClick={() => toggleCategory(key)}
            className={cn(
              "flex-1 flex items-center gap-3 px-4 py-3.5 transition-colors border-r last:border-r-0 border-gray-200",
              bg, hover,
              openCategories[key] && "ring-1 ring-inset ring-gray-300"
            )}
          >
            <Icon className={cn("w-5 h-5 shrink-0", color)} />
            <div className="text-left min-w-0">
              <div className={cn("text-[11px] font-bold uppercase tracking-wide", color)}>{label}</div>
              <div className={cn("text-2xl font-extrabold tabular-nums leading-none", color)}>{count}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Content Area */}
      <CardContent className="p-0">
        {/* LOP Baru */}
        {newLops.length > 0 && (
          <CategorySection
            title={`LOP Baru Muncul — ${newLops.length} proyek`}
            description="Tidak ada di snapshot sebelumnya"
            icon={<PlusCircle className="w-3.5 h-3.5 text-blue-600" />}
            count={newLops.length}
            isOpen={openCategories["new"]}
            onToggle={() => toggleCategory("new")}
            accentClass="border-l-blue-400"
            headerBg="bg-blue-50/70"
          >
            {newLops.map((l: any, i: number) => (
              <PergerakanItemRow key={l.lopid} item={{ ...l, isNew: true }} variant="new" index={i + 1} />
            ))}
          </CategorySection>
        )}

        {/* Status Berubah */}
        {changedStatus.length > 0 && (
          <CategorySection
            title={`Status Berubah — ${changedStatus.length} proyek`}
            description="Mengalami pergeseran fase"
            icon={<ArrowRight className="w-3.5 h-3.5 text-amber-600" />}
            count={changedStatus.length}
            isOpen={openCategories["changed"]}
            onToggle={() => toggleCategory("changed")}
            accentClass="border-l-amber-400"
            headerBg="bg-amber-50/70"
          >
            {changedStatus.map((l: any, i: number) => {
              const prev = (funnelData?.prevLops ?? []).find((p: any) => p.lopid === l.lopid);
              return (
                <PergerakanItemRow key={l.lopid} item={{ ...l, prevStatusF: prev?.statusF }} variant="changed" index={i + 1} />
              );
            })}
          </CategorySection>
        )}

        {/* Belum Bergerak */}
        {stagnanCount > 0 && (
          <CategorySection
            title={`Belum Bergerak — ${stagnanCount} proyek`}
            description="Status tetap sejak snapshot sebelumnya"
            icon={<AlertTriangle className="w-3.5 h-3.5 text-gray-500" />}
            count={stagnanCount}
            isOpen={openCategories["stagnant"]}
            onToggle={() => toggleCategory("stagnant")}
            accentClass="border-l-gray-400"
            headerBg="bg-gray-50/70"
          >
            {stagnanLops.map((l: any, i: number) => (
              <PergerakanItemRow key={l.lopid} item={l} variant="stagnant" index={i + 1} />
            ))}
          </CategorySection>
        )}

        {/* Empty state */}
        {newLops.length === 0 && changedStatus.length === 0 && stagnanCount === 0 && (
          <div className="px-5 py-8 text-center">
            <div className="text-sm font-semibold text-gray-500">Tidak ada data perubahan yang terdeteksi</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Category Accordion (flat list) ─────────────────────────────────────────────
function CategorySection({
  title,
  description,
  icon,
  accentClass,
  headerBg,
  count,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  accentClass: string;
  headerBg: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className={cn(
          "w-full flex items-center gap-3 px-5 py-3 text-left transition-colors border-l-[4px]",
          accentClass,
          headerBg
        )}>
          <span className="shrink-0">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-black">{title}</div>
            <div className="text-xs font-medium text-gray-600">{description}</div>
          </div>
          <span className="text-sm font-black text-black bg-white border border-gray-300 px-2 py-0.5 rounded-full shrink-0">{count}</span>
          <ChevronDown className={cn("w-4 h-4 text-gray-700 shrink-0 transition-transform duration-200", isOpen && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-[480px] overflow-y-auto bg-white/50 p-3 space-y-2">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface AmProfile { nik: string; nama: string; divisi: string | null; badge: string | null; witel: string | null; photoUrl: string | null; }
interface CustomerRow { pelanggan: string; nip: string | null; divisi: string | null; divisiCc: string | null; segmen: string | null; proporsi: number; targetTotal: number; realTotal: number; achRate: number; }
interface CustomerRowDetail extends CustomerRow { bulan: number; tahun: number; }
interface Snapshot { id: number; label: string; period: string | null; snapshotDate: string | null; }
interface AmProfileFilters { availableBulan: number[]; selectedBulan: number[]; tipeRevenue: string; }
interface AmProfileResponse { am: AmProfile; snapshots: Snapshot[]; customers: CustomerRow[]; selectedSnapshotId: number | null; filters: AmProfileFilters; customerRows: CustomerRowDetail[]; summary: { totalTarget: number; totalReal: number; achRate: number; periodText: string; customerCount: number; cmAchRate: number; cmTarget: number; cmReal: number; }; }
interface SnapshotComparison { newLops: any[]; changedStatus: any[]; newF5: any[]; stagnanLops: any[]; stagnanCount: number; prevCR: number; crDelta: number; currCR: number; totalTercakup: number; }
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
	function DonutChart({ pct, color = "#3b82f6", size = 150 }: { pct: number; color?: string; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.44;
  const innerR = size * 0.28;
  const clamped = Math.min(100, Math.max(0, pct));
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const polarToXY = (r: number, deg: number) => ({
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  });
  const describeArc = (r: number, startDeg: number, endDeg: number) => {
    const s = polarToXY(r, startDeg);
    const e = polarToXY(r, endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };
  const startAngle = -90;
  const filledAngle = startAngle + (clamped / 100) * 360;
  const bgEndAngle = startAngle + 360;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* Background ring */}
      <path d={describeArc((outerR + innerR) / 2, startAngle, bgEndAngle)} fill="none" stroke="#e5e7eb" strokeWidth={outerR - innerR} strokeLinecap="round" />
      {/* Filled ring */}
      {filledAngle > startAngle + 0.5 ? (
        <path d={describeArc((outerR + innerR) / 2, startAngle, filledAngle)} fill="none" stroke={color} strokeWidth={outerR - innerR} strokeLinecap="round" />
      ) : null}
      {/* Percentage in center */}
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={size * 0.17} fontWeight="800" fill={color} fontFamily="ui-monospace,monospace">{fmtPct(clamped)}</text>
      <text x={cx} y={cy + size * 0.07 + 8} textAnchor="middle" fontSize={size * 0.065} fill="#6b7280">CAPAIAN</text>
    </svg>
  );
}

// ─── Funnel Table ────────────────────────────────────────────────────────────
interface FunnelTableProps {
  lopRows: any[];
  funnelData: any;
  propTotalNilai: number;
  propTotalLop: number;
  funnelExpanded: Record<string, boolean>;
  setFunnelExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  search: string;
  setSearch: (v: string) => void;
  amNama: string;
}

const FS_MONTH_NUMS_ID = ["01","02","03","04","05","06","07","08","09","10","11","12"];
const FS_MONTHS_ID: Record<string, string> = { "01":"Januari","02":"Februari","03":"Maret","04":"April","05":"Mei","06":"Juni","07":"Juli","08":"Agustus","09":"September","10":"Oktober","11":"November","12":"Desember" };

function FunnelTable({ lopRows, funnelData, propTotalNilai, propTotalLop, funnelExpanded, setFunnelExpanded, search, setSearch, amNama }: FunnelTableProps) {
  const [filterDurasi, setFilterDurasi] = useState<"all"|"single_year"|"multi_year">("all");
  const [filterDurasiOpen, setFilterDurasiOpen] = useState(false);
  const [filterPeriodeOpen, setFilterPeriodeOpen] = useState(false);
  const [filterPeriodeYears, setFilterPeriodeYears] = useState<Set<string>>(new Set());
  const [filterPeriodeMonths, setFilterPeriodeMonths] = useState<Set<string>>(new Set());
  const [expandedPeriodeYears, setExpandedPeriodeYears] = useState<Set<string>>(new Set());
  const [filterTahunOpen, setFilterTahunOpen] = useState(false);
  const [filterTahun, setFilterTahun] = useState<Set<string>>(new Set());

  const triggerRefDurasi = useRef<HTMLDivElement>(null);
  const dropRefDurasi = useRef<HTMLDivElement>(null);
  const triggerRefPeriode = useRef<HTMLDivElement>(null);
  const dropRefPeriode = useRef<HTMLDivElement>(null);
  const triggerRefTahun = useRef<HTMLDivElement>(null);
  const dropRefTahun = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (triggerRefDurasi.current && !triggerRefDurasi.current.contains(e.target as Node) && dropRefDurasi.current && !dropRefDurasi.current.contains(e.target as Node)) setFilterDurasiOpen(false);
      if (triggerRefPeriode.current && !triggerRefPeriode.current.contains(e.target as Node) && dropRefPeriode.current && !dropRefPeriode.current.contains(e.target as Node)) setFilterPeriodeOpen(false);
      if (triggerRefTahun.current && !triggerRefTahun.current.contains(e.target as Node) && dropRefTahun.current && !dropRefTahun.current.contains(e.target as Node)) setFilterTahunOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Build available years from lopRows reportDate
  const availablePeriodeYears = useMemo(() => {
    const years = new Set<string>();
    (lopRows as any[]).forEach((l: any) => {
      if (l.reportDate) years.add(String(l.reportDate).slice(0, 4));
    });
    return [...years].sort().reverse();
  }, [lopRows]);

  // Tahun Anggaran options from funnelData API
  const availableTahunOptions = useMemo(() => {
    const ta = funnelData?.availableTahunAnggaran;
    if (Array.isArray(ta) && ta.length > 0) return [...ta].sort().reverse().map(String);
    return [];
  }, [funnelData]);

  // Compute month options per year from lopRows
  const availableMonthsByYear = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    (lopRows as any[]).forEach((l: any) => {
      if (!l.reportDate) return;
      const y = String(l.reportDate).slice(0, 4);
      const m = String(l.reportDate).slice(5, 7);
      if (!result[y]) result[y] = new Set();
      result[y].add(m);
    });
    return result;
  }, [lopRows]);

  const filteredRows = useMemo(() => {
    let rows = lopRows;
    if (search?.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r: any) =>
        (r.pelanggan || "").toLowerCase().includes(q) ||
        (r.judulProyek || "").toLowerCase().includes(q) ||
        (r.lopid || "").toLowerCase().includes(q)
      );
    }
    if (filterDurasi === "multi_year") {
      rows = rows.filter((r: any) => (r.monthSubs || 0) > 12);
    } else if (filterDurasi === "single_year") {
      rows = rows.filter((r: any) => (r.monthSubs || 0) <= 12);
    }
    // Filter by tahun anggaran
    if (filterTahun.size > 0) {
      rows = rows.filter((r: any) => {
        const ta = r.tahunAnggaran ? String(r.tahunAnggaran) : null;
        return ta && filterTahun.has(ta);
      });
    }
    // Filter by periode (reportDate year/month)
    if (filterPeriodeYears.size > 0 || filterPeriodeMonths.size > 0) {
      rows = rows.filter((r: any) => {
        if (!r.reportDate) return false;
        const y = String(r.reportDate).slice(0, 4);
        const m = String(r.reportDate).slice(5, 7);
        if (filterPeriodeYears.size > 0 && !filterPeriodeYears.has(y)) return false;
        if (filterPeriodeMonths.size > 0 && !filterPeriodeMonths.has(m)) return false;
        return true;
      });
    }
    return rows;
  }, [lopRows, search, filterDurasi, filterPeriodeYears, filterPeriodeMonths]);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of filteredRows) {
      const key = r.statusF || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows]);

  const totalNilai = filteredRows.reduce((s: number, r: any) => s + (r.nilaiProyek || 0), 0);

  if (grouped.length === 0) {
    return <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">Belum ada data funnel.</div>;
  }

  const durasiLabel = filterDurasi === "all" ? "Semua Durasi" : filterDurasi === "single_year" ? "Nilai per Tahun" : "Multi Year (>12 bln)";
  const periodePrimaryYear = [...filterPeriodeYears].sort().reverse()[0] || availablePeriodeYears[0] || "";
  const allPeriodeSelected = filterPeriodeYears.size === 0 && filterPeriodeMonths.size === 0;
  const currentPeriodeDisplay = allPeriodeSelected ? "Semua" : filterPeriodeYears.size === 1 && filterPeriodeMonths.size === 0 ? `${periodePrimaryYear}` : `${filterPeriodeYears.size} tahun${filterPeriodeMonths.size > 0 ? ` · ${filterPeriodeMonths.size} bln` : ""}`;

  const openDurasi = () => {
    if (triggerRefDurasi.current) { const r = triggerRefDurasi.current.getBoundingClientRect(); setPosD({ top: r.bottom + 4, left: r.left, minW: 180 }); }
    setFilterDurasiOpen(o => !o);
  };
  const [posD, setPosD] = useState({ top: 0, left: 0, minW: 180 });
  const openPeriode = () => {
    if (triggerRefPeriode.current) { const r = triggerRefPeriode.current.getBoundingClientRect(); setPosP({ top: r.bottom + 4, left: r.left, minW: 220 }); }
    if (filterPeriodeYears.size > 0) setExpandedPeriodeYears(new Set([...filterPeriodeYears].sort().reverse()[0]));
    setFilterPeriodeOpen(o => !o);
  };
  const [posP, setPosP] = useState({ top: 0, left: 0, minW: 220 });
  const openTahun = () => {
    if (triggerRefTahun.current) { const r = triggerRefTahun.current.getBoundingClientRect(); setPosT({ top: r.bottom + 4, left: r.left, minW: 200 }); }
    setFilterTahunOpen(o => !o);
  };
  const [posT, setPosT] = useState({ top: 0, left: 0, minW: 200 });
  const tahunLabel = filterTahun.size === 0 ? "Semua" : filterTahun.size === 1 ? [...filterTahun][0] : `${filterTahun.size} tahun`;

  const togglePeriodeYear = (y: string) => {
    const n = new Set(filterPeriodeYears);
    if (n.has(y)) n.delete(y); else n.add(y);
    setFilterPeriodeYears(n);
    if (!n.has(y)) { const m = new Set(filterPeriodeMonths); m.clear(); setFilterPeriodeMonths(m); }
  };
  const togglePeriodeMonth = (m: string) => {
    const n = new Set(filterPeriodeMonths);
    if (n.has(m)) n.delete(m); else n.add(m);
    setFilterPeriodeMonths(n);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* ── Overview Cards ── */}
      <div className="grid grid-cols-4 gap-3 p-3">
        {/* Target Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-stretch h-[88px] overflow-hidden shadow-sm">
          <div className="flex-1 flex flex-col justify-between min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider leading-none" style={{color:"#1e1e1e"}}>Target</div>
            <div className="text-2xl font-black tabular-nums leading-none" style={{color:"#1e1e1e"}}>{funnelData?.targetTotal ? fmtRupiahShort(funnelData.targetTotal) : "—"}</div>
            <div className="text-[10px] font-medium leading-none text-slate-400">{funnelData?.snapshots?.[0]?.label ?? "—"}</div>
          </div>
          <div className="flex items-center pl-3">
            <svg width="60" height="40" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="gradTarget" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              <path d="M0,36 L10,30 L20,32 L30,26 L40,22 L50,18 L60,12 L60,40 L0,40 Z" fill="url(#gradTarget)"/>
              <polyline points="0,36 10,30 20,32 30,26 40,22 50,18 60,12" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="60" cy="12" r="3" fill="#6366f1"/>
            </svg>
          </div>
        </div>
        {/* Realisasi Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-stretch h-[88px] overflow-hidden shadow-sm">
          <div className="flex-1 flex flex-col justify-between min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider leading-none" style={{color:"#1e1e1e"}}>Realisasi</div>
            <div className="text-2xl font-black tabular-nums leading-none text-emerald-600">{propTotalNilai ? fmtRupiahShort(propTotalNilai) : "—"}</div>
            <div className="text-[10px] font-medium leading-none text-slate-400">{'—'}</div>
          </div>
          <div className="flex items-center pl-3">
            <svg width="60" height="40" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="gradRealisasi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              <path d="M0,36 L10,30 L20,26 L30,22 L40,16 L50,12 L60,8 L60,40 L0,40 Z" fill="url(#gradRealisasi)"/>
              <polyline points="0,36 10,30 20,26 30,22 40,16 50,12 60,8" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="60" cy="8" r="3" fill="#10b981"/>
            </svg>
          </div>
        </div>
        {/* LOP Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-stretch h-[88px] overflow-hidden shadow-sm">
          <div className="flex-1 flex flex-col justify-between min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider leading-none" style={{color:"#1e1e1e"}}>LOP</div>
            <div className="text-2xl font-black tabular-nums leading-none" style={{color:"#1e1e1e"}}>{propTotalLop ?? "—"}</div>
            <div className="text-[10px] font-medium leading-none text-slate-400">proyek</div>
          </div>
          <div className="flex items-center pl-3">
            <svg width="60" height="40" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="gradLop" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              <path d="M0,36 L10,32 L20,28 L30,24 L40,20 L50,16 L60,12 L60,40 L0,40 Z" fill="url(#gradLop)"/>
              <polyline points="0,36 10,32 20,28 30,24 40,20 50,16 60,12" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="60" cy="12" r="3" fill="#6366f1"/>
            </svg>
          </div>
        </div>
        {/* CR Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-stretch h-[88px] overflow-hidden shadow-sm">
          <div className="flex-1 flex flex-col justify-between min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider leading-none" style={{color:"#1e1e1e"}}>Conversion Rate</div>
            <div className="text-2xl font-black tabular-nums leading-none text-emerald-600">{funnelData?.pipelineEligibleNilai > 0 ? fmtPct((funnelData.wonLopNilai / funnelData.pipelineEligibleNilai) * 100) : "—"}</div>
            <div className="text-[10px] font-medium leading-none text-slate-400">F5 ÷ F3+F4+F5</div>
          </div>
          <div className="flex items-center pl-3">
            <svg width="60" height="40" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="gradCR" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3"/>
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              <path d="M0,36 L10,33 L20,30 L30,27 L40,23 L50,19 L60,15 L60,40 L0,40 Z" fill="url(#gradCR)"/>
              <polyline points="0,36 10,33 20,30 30,27 40,23 50,19 60,15" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="60" cy="15" r="3" fill="#10b981"/>
            </svg>
          </div>
        </div>
      </div>

      {/* ── Filter Row (sticky) ── */}
      <div style={{position:"sticky",top:0,zIndex:16,boxShadow:"rgba(0,0,0,0.13) 0px 2px 8px"}}>
        <div className="bg-secondary/30 flex flex-wrap items-end gap-3 p-3">
          {/* Durasi Kontrak */}
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: "#1e1e1e" }}>Durasi Kontrak</label>
            <div className="relative" ref={triggerRefDurasi}>
              <button onClick={openDurasi}
                className="h-8 px-2.5 bg-background border border-border rounded-lg text-xs flex items-center gap-1.5 hover:bg-secondary/50 transition-colors whitespace-nowrap">
                <span className="font-medium text-foreground">{durasiLabel}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {filterDurasiOpen && createPortal(
                <div ref={dropRefDurasi} style={{position:"fixed",top:posD.top,left:posD.left,minWidth:posD.minW,zIndex:9999}}
                  className="bg-card border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto py-1">
                  {[{value:"all",label:"Semua Durasi"},{value:"single_year",label:"Nilai per Tahun"},{value:"multi_year",label:"Multi Year (>12 bln)"}].map(opt=>(
                    <button key={opt.value} onClick={()=>{setFilterDurasi(opt.value as typeof filterDurasi);setFilterDurasiOpen(false);}}
                      className={cn("w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2",
                        opt.value===filterDurasi?"font-semibold text-primary bg-primary/5":"text-foreground")}>
                      {opt.value===filterDurasi&&<span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"/>}
                      {opt.value!==filterDurasi&&<span className="w-1.5 shrink-0"/>}
                      {opt.label}
                    </button>
                  ))}
                </div>, document.body
              )}
            </div>
          </div>

          {/* Periode */}
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: "#1e1e1e" }}>Periode</label>
            <div className="relative" ref={triggerRefPeriode}>
              <button onClick={openPeriode}
                className="h-8 px-2.5 bg-background border border-border rounded-lg text-xs flex items-center gap-1.5 hover:bg-secondary/50 transition-colors whitespace-nowrap">
                <span className="font-medium text-foreground">{currentPeriodeDisplay}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {filterPeriodeOpen && createPortal(
                <div ref={dropRefPeriode} style={{position:"fixed",top:posP.top,left:posP.left,minWidth:posP.minW,zIndex:9999}}
                  className="bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Periode</span>
                    <div className="flex gap-1.5">
                      <button onClick={()=>{setFilterPeriodeYears(new Set());setFilterPeriodeMonths(new Set());}} className="text-[11px] text-primary font-semibold hover:underline">Reset</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {availablePeriodeYears.map(y=>{
                      const months = availableMonthsByYear[y] ? [...availableMonthsByYear[y]] : [];
                      const isYearExpanded = expandedPeriodeYears.has(y);
                      const allMonths = FS_MONTH_NUMS_ID;
                      return (
                        <div key={y}>
                          <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-secondary/40 transition-colors">
                            <button type="button" onClick={()=>{
                              const n=new Set(expandedPeriodeYears);
                              if(n.has(y)) n.delete(y); else n.add(y);
                              setExpandedPeriodeYears(n);
                            }} className="p-0.5 text-muted-foreground hover:text-foreground shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("lucide lucide-chevron-right w-3 h-3 transition-transform", isYearExpanded && "rotate-90")} aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                            </button>
                            <button onClick={()=>togglePeriodeYear(y)} className="flex items-center gap-2 flex-1 cursor-pointer select-none">
                              <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",filterPeriodeYears.has(y)?"bg-primary border-primary":"border-border")}>
                                {filterPeriodeYears.has(y)&&<span className="text-white text-[8px] font-black">✓</span>}
                              </span>
                              <span className="text-sm font-semibold text-foreground">{y}</span>
                            </button>
                          </div>
                          {isYearExpanded && allMonths.map(m=>{
                            const monthKey = `${y}-${m}`;
                            const hasData = months.includes(m);
                            const isMonthSelected = filterPeriodeMonths.has(m) && filterPeriodeYears.has(y);
                            return (
                              <div key={m} className={cn("flex items-center gap-1 px-2 py-1.5 transition-colors", hasData ? "hover:bg-secondary/40" : "opacity-40")}>
                                <div className="w-5 shrink-0"/>
                                <button onClick={()=>hasData && togglePeriodeMonth(m)} className={cn("flex items-center gap-2 flex-1 cursor-pointer select-none", !hasData && "cursor-default")}>
                                  <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",isMonthSelected?"bg-primary border-primary":"border-border")}>
                                    {isMonthSelected&&<span className="text-white text-[8px] font-black">✓</span>}
                                  </span>
                                  <span className="text-sm text-foreground">{FS_MONTHS_ID[m]}</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>, document.body
              )}
            </div>
          </div>

          {/* Tahun Anggara */}
          <div className="flex flex-col gap-1 shrink-0">
            <label className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: "#1e1e1e" }}>Tahun Anggaran</label>
            <div className="relative" ref={triggerRefTahun}>
              <button onClick={openTahun}
                className="h-8 px-2.5 bg-background border border-border rounded-lg text-xs flex items-center gap-1.5 hover:bg-secondary/50 transition-colors whitespace-nowrap">
                <span className="font-medium text-foreground">{tahunLabel}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
              {filterTahunOpen && createPortal(
                <div ref={dropRefTahun} style={{position:"fixed",top:posT.top,left:posT.left,minWidth:posT.minW,zIndex:9999}}
                  className="bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Tahun Anggaran</span>
                    <div className="flex gap-1.5">
                      <button onClick={()=>setFilterTahun(new Set(availableTahunOptions))} className="text-[11px] text-primary font-semibold hover:underline">Semua</button>
                      <button onClick={()=>setFilterTahun(new Set())} className="text-[11px] text-muted-foreground font-semibold hover:underline">Kosongkan</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {availableTahunOptions.map(t=>(
                      <button key={t} onClick={()=>{
                        const n=new Set(filterTahun);
                        if(n.has(t)) n.delete(t); else n.add(t);
                        setFilterTahun(n);
                      }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2">
                        <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",filterTahun.has(t)?"bg-primary border-primary":"border-border")}>
                          {filterTahun.has(t)&&<span className="text-white text-[8px] font-black">✓</span>}
                        </span>
                        <span className="text-sm font-medium text-foreground">{t}</span>
                      </button>
                    ))}
                    {availableTahunOptions.length === 0 && (
                      <div className="px-3 py-4 text-xs text-muted-foreground text-center">Tidak ada data</div>
                    )}
                  </div>
                </div>, document.body
              )}
            </div>
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-40 shrink-0">
            <label className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: "#1e1e1e" }}>Pencarian</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground shrink-0 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari LOP..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 w-full pl-7 pr-2.5 bg-background border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Phase Tables ── */}
      {grouped.map(([phase, rows]) => {
        const isOpen = funnelExpanded[phase] === true;
        const phaseTotal = rows.reduce((s: number, r: any) => s + (r.nilaiProyek || 0), 0);
        const phaseColors: Record<string, string> = { F0: "#93c5fd", F1: "#3b82f6", F2: "#6366f1", F3: "#6366f1", F4: "#8b5cf6", F5: "#10b981" };
        const phaseTextColors: Record<string, string> = { F0: "#0369a1", F1: "#1d4ed8", F2: "#4338ca", F3: "#4338ca", F4: "#5b21b6", F5: "#065f46" };
        const bgPhase = phaseColors[phase] ?? "#888";
        const textPhase = phaseTextColors[phase] ?? "#666";

        return (
          <div key={phase}>
            {/* Phase header — sticky */}
            <div style={{
              position: "sticky", top: "52px", zIndex: 15, cursor: "pointer",
              background: "rgba(253,242,248,0.75)",
              borderLeft: `4px solid ${bgPhase}`,
              boxShadow: "rgba(0,0,0,0.09) 0px 2px 6px",
            }}
              onClick={() => setFunnelExpanded(prev => ({ ...prev, [phase]: isOpen ? false : true }))}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem", paddingLeft: "2.5rem" }}>
                <ChevronRight className={cn("w-3.5 h-3.5 text-slate-500 transition-transform shrink-0", isOpen && "rotate-90")} />
                <span className="text-sm font-black uppercase tracking-wide" style={{ color: textPhase }}>
                  DAFTAR PROYEK {phase}
                </span>
                <span className="text-xs font-black text-slate-900 px-1.5 py-0.5 rounded-full" style={{ background: "rgb(242,242,242)" }}>
                  {rows.length} proyek
                </span>
                <div style={{ flex: 1 }} />
                <span className="text-sm font-black text-foreground tabular-nums shrink-0">{fmtRupiah(phaseTotal)}</span>
              </div>
            </div>

            {/* Phase table — collapsible */}
            {isOpen && (
              <div>
                <table className="text-left text-sm" style={{ tableLayout: "fixed", borderCollapse: "collapse", width: "100%" }}>
                  <colgroup>
                    <col style={{ width: "25%" }} />
                    <col style={{ width: "80px" }} />
                    <col style={{ width: "75px" }} />
                    <col style={{ width: "210px" }} />
                    <col style={{ width: "200px" }} />
                    <col style={{ width: "130px" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-200 border-y border-slate-400">
                      <td className="px-4 py-2 pl-16 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Nama Proyek</td>
                      <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Kategori</td>
                      <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Durasi</td>
                      <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">LOP ID</td>
                      <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider overflow-hidden">Pelanggan &amp; Divisi</td>
                      <td className="px-3 py-2 text-xs font-black text-slate-950 uppercase tracking-wider text-right overflow-hidden">Nilai</td>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any) => {
                      const durasiLabel = (!r.monthSubs || r.monthSubs <= 0) ? "–" : r.monthSubs % 12 === 0 ? `${r.monthSubs / 12} TAHUN` : `${r.monthSubs} BULAN`;
                      const katColor = (k: string | null) => {
                        if (k === "GTMA") return "bg-cyan-100 border border-cyan-300 text-cyan-800";
                        if (k === "Own Channel") return "bg-violet-100 border border-violet-300 text-violet-800";
                        if (k === "International") return "bg-amber-100 border border-amber-300 text-amber-800";
                        return "bg-slate-100 border border-slate-300 text-slate-700";
                      };
                      const divisiColor = (d: string | null) => {
                        if (!d) return "";
                        if (d.toUpperCase() === "DPS") return "bg-blue-50 text-blue-700 border-blue-200";
                        if (d.toUpperCase() === "DSS") return "bg-purple-50 text-purple-700 border-purple-200";
                        return "bg-slate-100 text-slate-600 border-slate-300";
                      };
                      return (
                        <tr key={r.lopid} className="hover:bg-pink-50 transition-colors border-b border-slate-100">
                          <td className="px-4 py-2.5 pl-16 overflow-hidden">
                            <div className="text-sm text-foreground font-bold leading-tight line-clamp-2" title={r.judulProyek}>{r.judulProyek}</div>
                          </td>
                          <td className="px-3 py-2.5 overflow-hidden">
                            {r.kategoriKontrak
                              ? <span className={cn("inline-block px-2 py-0.5 rounded text-[11px] font-bold whitespace-nowrap", katColor(r.kategoriKontrak))}>{r.kategoriKontrak}</span>
                              : <span className="text-muted-foreground text-xs">–</span>}
                          </td>
                          <td className="px-3 py-2.5 overflow-hidden">
                            <span className="text-sm font-bold text-teal-700 dark:text-teal-400 whitespace-nowrap">{durasiLabel}</span>
                          </td>
                          <td className="px-3 py-2.5 overflow-hidden">
                            <span className="font-mono text-xs font-semibold text-slate-600 truncate block">{r.lopid}</span>
                          </td>
                          <td className="px-3 py-2.5 overflow-hidden">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-sm text-foreground font-semibold truncate" title={r.pelanggan}>{r.pelanggan}</span>
                              {r.divisi && <span className={cn("inline-flex items-center self-start px-1.5 py-0.5 rounded text-[10px] font-black uppercase border", divisiColor(r.divisi))}>{r.divisi}</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-xs font-bold text-foreground overflow-hidden">{fmtRupiah(r.nilaiProyek || 0)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-red-50 border-t border-red-200">
                      <td colSpan={5} className="px-4 py-2 pl-16 overflow-hidden"><span className="text-sm font-black text-red-800 uppercase tracking-wide">Total Nilai {phase}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-sm font-black text-red-800 overflow-hidden">{fmtRupiah(phaseTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Total Row ── */}
      <div style={{
        display: "flex",
        borderTop: "2px solid rgb(148,163,184)",
        borderLeft: "2px solid rgb(148,163,184)",
        borderRight: "2px solid rgb(148,163,184)",
        borderBottom: "2px solid rgb(148,163,184)",
        background: "hsl(var(--card))",
        padding: "0.5rem 1rem",
        gap: "1rem",
        alignItems: "center"
      }}>
        <span className="text-sm font-black text-red-700 uppercase tracking-wide flex-1">Total Nilai Proyek — {amNama || "AM"}</span>
        <span className="text-sm font-black tabular-nums text-red-700 shrink-0">{fmtRupiah(totalNilai)}</span>
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

// ─── Rank Badge ─────────────────────────────────────────────────────────────────
// Badge for AM rank tier (Platinum/Gold/Silver/Bronze) — distinct from UI Badge
function RankBadge({ badge }: { badge: string | null }) {
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
  const [selectedKontrak, setSelectedKontrak] = useState<Set<string>>(new Set(["AO", "MO"]));
  // Kategori kontrak filter (same default as /presentation: exclude "New GTMA")
  const [filterKatKontrak, setFilterKatKontrak] = useState<Set<string>>(new Set(["GTMA", "Own Channel"]));
  const [funnelExpanded, setFunnelExpanded] = useState<Record<string, boolean>>({});
  const [funnelSearch, setFunnelSearch] = useState("");
  const [funnelTablePage, setFunnelTablePage] = useState(1);
  const [funnelTablePageSize] = useState(20);
  // Popover state
  const [funnelSnapOpen, setFunnelSnapOpen] = useState(false);
  const [funnelKontrakOpen, setFunnelKontrakOpen] = useState(false);
  const [funnelKatKontrakOpen, setFunnelKatKontrakOpen] = useState(false);

  // Activity state
  const [actLoading, setActLoading] = useState(false);
  const [actData, setActData] = useState<any>(null);
  const [actSnapshot, setActSnapshot] = useState<number | null>(null);
  const [actPeriodes, setActPeriodes] = useState<Set<string>>(new Set());
  const [actKategori, setActKategori] = useState<Set<string>>(new Set());
  const [actDivisi, setActDivisi] = useState<string>("LESA");
  const [actSearch, setActSearch] = useState("");
  const [actExpanded, setActExpanded] = useState<Record<string, boolean>>({});
  const [actPage, setActPage] = useState(1);
  const [actPageSize, setActPageSize] = useState(10);

  const session = getPresentationSession();
  const effectiveNik = nik ?? session?.nik ?? "";

  // Compute filtered funnel metrics (kategoriKontrak filter, same as /presentation)
  const filteredFunnelMetrics = useMemo(() => {
    const rawLops = funnelData?.lopRows ?? [];
    let filtered = rawLops;

    // Apply kategoriKontrak filter (same as /presentation frontend filter)
    if (filterKatKontrak.size > 0) {
      filtered = filtered.filter((l: any) => !l.kategoriKontrak || filterKatKontrak.has(l.kategoriKontrak));
    }

    // Recompute byStatus
    const allPhases = ["F0", "F1", "F2", "F3", "F4", "F5"];
    const statusMap: Record<string, { status: string; count: number; totalNilai: number }> = {};
    for (const p of allPhases) statusMap[p] = { status: p, count: 0, totalNilai: 0 };
    let totalNilai = 0, totalLop = 0, wonLop = 0, pipelineEligible = 0, pipelineEligibleNilai = 0;
    for (const l of filtered) {
      const s = l.statusF || "Unknown";
      if (!statusMap[s]) statusMap[s] = { status: s, count: 0, totalNilai: 0 };
      statusMap[s].count++;
      statusMap[s].totalNilai += l.nilaiProyek || 0;
      totalNilai += l.nilaiProyek || 0;
      totalLop++;
      if ((l.statusF || "") === "F5") { wonLop++; }
      if (["F3", "F4", "F5"].includes(l.statusF || "")) { pipelineEligible++; pipelineEligibleNilai += l.nilaiProyek || 0; }
    }
    const byStatus = allPhases.map(p => statusMap[p]);
    const conversionRate = (wonLop + pipelineEligible) > 0 ? (wonLop / (wonLop + pipelineEligible)) * 100 : 0;

    return {
      filteredLops: filtered,
      filteredByStatus: byStatus,
      filteredTotalNilai: totalNilai,
      filteredTotalLop: totalLop,
      filteredWonLopNilai: funnelData?.wonLopNilai ?? 0,
      filteredPipelineEligibleNilai: pipelineEligibleNilai,
      filteredConversionRate: conversionRate,
    };
  }, [funnelData, filterKatKontrak]);

  // Comparison: current vs previous snapshot (for "Perubahan" card)
  const snapshotComparison = useMemo(() => {
    const currLops = filteredFunnelMetrics.filteredLops;
    const prevLops: any[] = funnelData?.prevLops ?? [];
    const prevMap = new Map(prevLops.map((l: any) => [l.lopid, l]));
    const currMap = new Map(currLops.map((l: any) => [l.lopid, l]));

    // LOP baru: ada di curr, tidak ada di prev
    const newLops = currLops.filter((l: any) => !prevMap.has(l.lopid));
    // LOP berubah status: ada di keduanya, status beda
    const changedStatus = currLops.filter((l: any) => {
      const prev = prevMap.get(l.lopid);
      return prev && prev.statusF !== l.statusF;
    });
    // F5 won baru: ada di curr sebagai F5, ada di prev sebagai non-F5
    const newF5 = currLops.filter((l: any) => {
      const prev = prevMap.get(l.lopid);
      return l.statusF === "F5" && prev && prev.statusF !== "F5";
    });
    // LOP stagnan: LOP yang ada di prev & curr, tidak berubah status (termasuk F5)
    const stagnanLops = prevLops.filter((l: any) => {
      return currMap.has(l.lopid);
    });
    const stagnanCount = stagnanLops.length;

    // Prev CR (value-based: F5 ÷ (F3+F4+F5) based on nilai — same as slide 3)
    const prevWonNilai = prevLops.filter((l: any) => l.statusF === "F5").reduce((s: number, l: any) => s + (l.nilaiProyek || 0), 0);
    const prevPipelineNilai = prevLops.filter((l: any) => ["F3", "F4", "F5"].includes(l.statusF || "")).reduce((s: number, l: any) => s + (l.nilaiProyek || 0), 0);
    const prevCR = prevPipelineNilai > 0 ? (prevWonNilai / prevPipelineNilai) * 100 : 0;
    // Curr CR (value-based — same formula as slide 3 Detail Funnel per AM)
    const currWonNilai = funnelData?.wonLopNilai ?? 0;
    const currPipelineNilai = funnelData?.pipelineEligibleNilai ?? 0;
    const currCR = currPipelineNilai > 0 ? (currWonNilai / currPipelineNilai) * 100 : 0;
    const crDelta = currCR - prevCR;

    const totalTercakup = currLops.length;
    return { newLops, changedStatus, newF5, stagnanLops, stagnanCount, prevCR, crDelta, currCR, totalTercakup };
  }, [filteredFunnelMetrics, funnelData]);

  // Count LOPs by kategoriKontrak (from unfiltered lopRows) for dropdown badge
  const katKontrakCounts = useMemo(() => {
    const rows = funnelData?.lopRows ?? [];
    const counts: Record<string, number> = {};
    for (const l of rows) {
      const k = l.kategoriKontrak ?? "(kosong)";
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [funnelData]);

  const KONTRAK_OPTIONS = [
    { value: "GTMA", label: "GTMA" },
    { value: "Own Channel", label: "Own Channel" },
    { value: "New GTMA", label: "New GTMA" },
    { value: "Uncategorized", label: "Uncategorized" },
  ];

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

  // Initialize default snapshot and periode dari data yang sudah ada (bukan current month)
  useEffect(() => {
    if (actLoading || !actData) return;
    // Default snapshot to latest
    if (actSnapshot === null && actData?.snapshots?.length > 0) {
      setActSnapshot(actData.snapshots[0].id);
    }
    // Default periode to latest month (availableMonths[0] already sorted desc)
    if (actPeriodes.size === 0 && actData?.availableMonths?.length > 0) {
      const latest = actData.availableMonths[0];
      setActPeriodes(new Set([latest]));
    }
  }, [actLoading, actData, actSnapshot, actPeriodes]);

  // Fetch activity data
  useEffect(() => {
    if (!effectiveNik) return;
    let cancelled = false;
    setActLoading(true);

    const params = new URLSearchParams();
    if (actSnapshot) params.set("snapshotId", String(actSnapshot));
    if (actDivisi !== "LESA") params.set("divisiCc", actDivisi);
    // Send selected periodes (empty = fetch all, filter happens on frontend)
    actPeriodes.forEach(p => {
      const [y, m] = p.split("-");
      params.append("bulan", m);
      params.append("tahun", y);
    });
    if (actKategori.size > 0) {
      actKategori.forEach(k => params.append("kategori", k));
    }
    const query = params.toString();
    const url = `/api/presentation/am-activity/${effectiveNik}${query ? `?${query}` : ""}`;
    fetch(url, { headers: presHeaders() })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (cancelled) return;
        setActData(d);
        setActLoading(false);
      })
      .catch(e => { if (!cancelled) { setActData(null); setActLoading(false); } });
    return () => { cancelled = true; };
  }, [effectiveNik, actSnapshot, actPeriodes, actKategori, actDivisi]);

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
    if (selectedKontrak.size > 0 && selectedKontrak.size < 2) {
      params.set("kategori_kontrak", [...selectedKontrak].join(","));
    }
    const qs = params.toString();
    fetch(`/api/presentation/am-funnel/${effectiveNik}${qs ? `?${qs}` : ""}`, { headers: presHeaders() })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setFunnelData(d); setFunnelLoading(false); } })
      .catch(() => { if (!cancelled) setFunnelLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveNik, embTab, selectedFunnelSnapshot, selectedKontrak]);

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

  // Trend chart data: bar chart of Real/Target per bulan, line of Ach%
  const trendData = useMemo(() => {
    const rows = data?.customerRows ?? [];
    // Get year from latest selected periode
    const tahun = latestPeriode ? parseInt(latestPeriode.split("-")[0]) : new Date().getFullYear();
    // Aggregate by bulan — only for rows in selectedPeriodes
    const byBulan: Record<number, { target: number; real: number }> = {};
    for (const r of rows) {
      if (r.tahun !== tahun) continue;
      if (!byBulan[r.bulan]) byBulan[r.bulan] = { target: 0, real: 0 };
      byBulan[r.bulan].target += r.targetTotal ?? 0;
      byBulan[r.bulan].real += r.realTotal ?? 0;
    }
    // Build data for selected periods only, sorted by bulan
    return [...selectedPeriodes]
      .filter(p => parseInt(p.split("-")[0]) === tahun)
      .map(p => {
        const bulan = parseInt(p.split("-")[1]);
        const { target, real } = byBulan[bulan] ?? { target: 0, real: 0 };
        const ach = target > 0 ? parseFloat(((real / target) * 100).toFixed(1)) : 0;
        return { month: MONTHS_SHORT[bulan - 1], bulan, target, real, ach };
      })
      .sort((a, b) => a.bulan - b.bulan);
  }, [data, latestPeriode, selectedPeriodes]);

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
              <label className="text-xs font-display font-bold uppercase tracking-wide" style={{ color: "#1e1e1e" }}>Snapshot</label>
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
            {/* Kategori Kontrak */}
            <div className="flex flex-col gap-1 w-48 shrink-0">
              <label className="text-xs font-display font-bold uppercase tracking-wide" style={{ color: "#1e1e1e" }}>Kategori</label>
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
            {/* Kategori Kontrak (kategoriKontrak filter — GTMA/Own Channel/New GTMA) */}
            <div className="flex flex-col gap-1 w-48 shrink-0">
              <label className="text-xs font-display font-bold uppercase tracking-wide" style={{ color: "#1e1e1e" }}>Kontrak</label>
              <Popover open={funnelKatKontrakOpen} onOpenChange={setFunnelKatKontrakOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full disabled:opacity-40 transition-colors text-left">
                    <span className="flex-1 truncate font-medium text-foreground">
                      {filterKatKontrak.size === KONTRAK_OPTIONS.length ? "Semua" : filterKatKontrak.size === 2 ? "GTMA & Own Channel" : [...filterKatKontrak].join(", ")}
                    </span>
                    <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{filteredFunnelMetrics.filteredTotalLop ?? 0}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <div className="p-1 space-y-0.5">
                    {KONTRAK_OPTIONS.map(({ value, label }) => {
                      const count = katKontrakCounts[value] ?? 0;
                      return (
                        <button key={value} onClick={() => { const next = new Set(filterKatKontrak); next.has(value) ? next.delete(value) : next.add(value); setFilterKatKontrak(next); }} className={cn("w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors flex items-center gap-2", filterKatKontrak.has(value) && "bg-accent font-semibold")}>
                          <span className={cn("w-4 h-4 border rounded flex items-center justify-center shrink-0", filterKatKontrak.has(value) ? "bg-primary border-primary" : "border-border")}>{filterKatKontrak.has(value) && <Check className="w-2.5 h-2.5 text-white" />}</span>
                          <span className="flex-1">{label}</span>
                          <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* ── LOP per Fase + Metrics (3 cols) ── */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: "1.3fr 1fr 1fr" }}>
            {/* LOP per Fase */}
            <div>
              <h3 className="text-base font-display font-bold text-foreground mb-3">LOP per Fase</h3>
              <div className="space-y-2">
                {(filteredFunnelMetrics.filteredByStatus ?? []).map((s: any) => {
                  const maxCount = Math.max(...(filteredFunnelMetrics.filteredByStatus ?? []).map((x: any) => x.count));
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
                {(filteredFunnelMetrics.filteredByStatus ?? []).map((s: any) => {
                  const labelColors: Record<string, string> = { F0: "rgb(3,105,161)", F1: "rgb(29,78,216)", F2: "rgb(67,56,202)", F3: "rgb(91,33,182)", F4: "rgb(194,65,12)", F5: "rgb(6,95,70)" };
                  return (
                    <div key={s.status} className="flex-1 min-w-0 bg-secondary/60 rounded-lg px-2.5 py-2.5 border border-border/50 flex flex-col justify-between">
                      <span className="text-xs font-black leading-none" style={{ color: labelColors[s.status] ?? "#666", fontFamily: "Inter, sans-serif" }}>{s.status}</span>
                      <span className="text-[17px] font-black tabular-nums leading-tight text-foreground truncate" style={{ fontFamily: "Inter, sans-serif" }}>{fmtNilai(s.totalNilai)}</span>
                      <span className="text-[11px] font-bold text-muted-foreground tabular-nums leading-none">{s.count} LOP</span>
                    </div>
                  );
                })}
                <div className="flex-1 min-w-0 bg-rose-100 rounded-lg px-2.5 py-2.5 border border-rose-200 flex flex-col justify-between">
                  <span className="text-xs font-black leading-none text-rose-600">TOTAL</span>
                  <span className="text-[17px] font-black tabular-nums leading-tight text-foreground truncate" style={{ fontFamily: "Inter, sans-serif" }}>{fmtNilai(filteredFunnelMetrics.filteredTotalNilai ?? 0)}</span>
                  <span className="text-[11px] font-bold text-muted-foreground tabular-nums leading-none">{filteredFunnelMetrics.filteredTotalLop ?? 0} LOP</span>
                </div>
              </div>
            </div>
            {/* Capaian Real vs Target */}
            <div style={{ overflow: "visible" }} className="bg-card border border-border rounded-xl p-2 shadow-sm min-w-0">
              <h3 className="text-base font-display font-bold text-foreground mb-1">Capaian Real vs Target</h3>
              <div className="flex items-start justify-center pb-1">
                <DonutChart pct={(funnelData.targetTotal ?? 0) > 0 ? Math.min(100, ((filteredFunnelMetrics.filteredTotalNilai ?? 0) / funnelData.targetTotal) * 100) : 0} color="#3b82f6" size={145} />
              </div>
              <div className="space-y-1" style={{ fontSize: "13px" }}>
                <div className="flex justify-between items-baseline gap-1">
                  <span className="whitespace-nowrap shrink-0" style={{ color: "#1e1e1e" }}>Real</span>
                  <span className="font-bold text-black tabular-nums shrink-0">{fmtRupiahShort(filteredFunnelMetrics.filteredTotalNilai ?? 0)}</span>
                </div>
                <div className="flex justify-between items-baseline gap-1">
                  <span className="whitespace-nowrap shrink-0" style={{ color: "#1e1e1e" }}>Target</span>
                  <span className="tabular-nums text-black shrink-0">{funnelData.targetTotal ? fmtRupiahShort(funnelData.targetTotal) : "—"}</span>
                </div>
                {((filteredFunnelMetrics.filteredTotalNilai ?? 0) >= (funnelData.targetTotal ?? 0)) ? (
                  <div className="flex justify-between items-baseline gap-1 pt-1 border-t border-gray-200">
                    <span className="font-bold whitespace-nowrap shrink-0 text-emerald-600">Kelebihan</span>
                    <span className="font-bold tabular-nums text-emerald-600 shrink-0">+{fmtRupiahShort(Math.max(0, (filteredFunnelMetrics.filteredTotalNilai ?? 0) - (funnelData.targetTotal ?? 0)))}</span>
                  </div>
                ) : (funnelData.targetTotal ?? 0) > 0 ? (
                  <div className="flex justify-between items-baseline gap-1 pt-1 border-t border-gray-200">
                    <span className="font-bold whitespace-nowrap shrink-0 text-red-600">Minus</span>
                    <span className="font-bold tabular-nums text-red-600 shrink-0">-{fmtRupiahShort(Math.max(0, (funnelData.targetTotal ?? 0) - (filteredFunnelMetrics.filteredTotalNilai ?? 0)))}</span>
                  </div>
                ) : null}
              </div>
            </div>
            {/* Conversion Rate */}
            <div style={{ overflow: "visible" }} className="bg-card border border-border rounded-xl p-2 shadow-sm min-w-0">
              <h3 className="text-base font-display font-bold text-foreground mb-1">Conversion Rate</h3>
              <div className="flex items-start justify-center pb-1">
                <DonutChart pct={funnelData.pipelineEligibleNilai > 0 ? Math.min(100, (funnelData.wonLopNilai / funnelData.pipelineEligibleNilai) * 100) : 0} color="#10b981" size={145} />
              </div>
              <div className="space-y-1" style={{ fontSize: "13px" }}>
                <div className="flex justify-between items-baseline gap-1">
                  <span className="whitespace-nowrap shrink-0" style={{ color: "#1e1e1e" }}>F5 (Closed Won)</span>
                  <span className="font-bold tabular-nums shrink-0" style={{ color: "rgb(59,130,246)" }}>{fmtNilai(funnelData.wonLopNilai ?? 0)}</span>
                </div>
                <div className="flex justify-between items-baseline gap-1">
                  <span className="whitespace-nowrap shrink-0" style={{ color: "#1e1e1e" }}>F3 + F4 + F5</span>
                  <span className="tabular-nums text-black shrink-0">{fmtNilai(funnelData.pipelineEligibleNilai ?? 0)}</span>
                </div>
                <div className="flex justify-between items-baseline gap-1">
                  <span className="whitespace-nowrap shrink-0" style={{ color: "#1e1e1e" }}>Tercapai</span>
                  <span className="font-bold tabular-nums text-emerald-600 shrink-0">{funnelData.pipelineEligibleNilai > 0 ? fmtPct(Math.min(100, (funnelData.wonLopNilai / funnelData.pipelineEligibleNilai) * 100)) : "—"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Pergerakan Funnel ── */}
        {funnelData?.prevSnapshotLabel && (
          <PergerakanSection
            snapshotComparison={snapshotComparison}
            funnelData={funnelData}
            amNama={am.nama}
          />
        )}

        {/* ── Table ── */}
        <FunnelTable
          lopRows={filteredFunnelMetrics.filteredLops}
          funnelData={funnelData}
          propTotalNilai={filteredFunnelMetrics.filteredTotalNilai}
          propTotalLop={filteredFunnelMetrics.filteredTotalLop}
          funnelExpanded={funnelExpanded}
          setFunnelExpanded={setFunnelExpanded}
          search={funnelSearch}
          setSearch={setFunnelSearch}
          amNama={data?.am?.nama ?? ""}
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
                    <label className="text-[10px] font-display font-bold uppercase tracking-wide" style={{ color: "#1e1e1e" }}>Snapshot</label>
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
                    <label className="text-[10px] font-display font-bold uppercase tracking-wide" style={{ color: "#1e1e1e" }}>Periode</label>
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
                      <div className="text-2xl font-black tabular-nums leading-none text-emerald-600">{fmtPct(data?.summary?.cmAchRate ?? 0)}</div>
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

              {/* ── Trend Chart ───────────────────────────────────────── */}
              {trendData.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <h3 className="text-sm font-bold text-foreground mb-3">
                    Tren Performa Revenue Bulanan {latestPeriode ? latestPeriode.split("-")[0] : ""}
                    {selectedDivisi !== "LESA" && <span className="ml-2 text-xs text-muted-foreground font-normal">· {selectedDivisi}</span>}
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
                      <Tooltip content={<TrendTooltip />} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                      <Bar yAxisId="left" dataKey="real" name="Real Revenue" fill="#22c55e" radius={[3,3,0,0]} maxBarSize={36} />
                      <Bar yAxisId="left" dataKey="target" name="Target Revenue" fill="#3b82f6" radius={[3,3,0,0]} maxBarSize={36} />
                      <Line yAxisId="right" type="monotone" dataKey="ach" name="Ach Rate %" stroke="#CC0000" strokeWidth={2.5} dot={{ fill: "#CC0000", r: 3 }} activeDot={{ r: 5 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
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
            <div className="w-full space-y-4">
              {/* ── Filter Bar (white card) ─────────────────────────── */}
              <div className="bg-card border border-border rounded-xl p-3">
                <div className="flex items-end gap-2 flex-wrap min-w-0">
                  {/* Snapshot */}
                <div className="flex flex-col gap-1 w-44 shrink-0">
                  <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Snapshot</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                        <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                          {actData?.snapshots?.find((s: any) => s.id === actSnapshot)?.label ?? "Pilih Snapshot"}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 160 }}>
                      <div className="bg-popover border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto py-1">
                        {(actData?.snapshots ?? []).map((s: any) => (
                          <button key={s.id} onClick={() => { setActSnapshot(s.id); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2">
                            <span className="w-1.5 shrink-0 flex items-center justify-center">
                              {actSnapshot === s.id && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                            </span>
                            <span className={cn("flex-1", actSnapshot === s.id ? "font-semibold text-primary" : "")}>{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Periode */}
                <div className="flex flex-col gap-1 shrink-0 w-44">
                  <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Periode</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                        <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                          {actPeriodes.size === 0 ? "Pilih Periode" : actPeriodes.size === 1 ? (
                            (() => { const p = [...actPeriodes][0]; const [y, m] = p.split("-"); return `${MONTHS_SHORT[parseInt(m)-1]} ${y}`; })()
                          ) : `${actPeriodes.size} dipilih`}
                        </span>
                        {actPeriodes.size > 0 && <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0">{actPeriodes.size}</span>}
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 200 }}>
                      <div className="bg-popover border border-border rounded-xl shadow-xl w-52 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Periode</span>
                          <div className="flex gap-1.5">
                            <button onClick={() => setActPeriodes(new Set(actData?.availableMonths ?? []))} className="text-[11px] text-primary font-semibold hover:underline">Semua</button>
                            <span className="text-muted-foreground text-[11px]">·</span>
                            <button onClick={() => setActPeriodes(new Set())} className="text-[11px] text-muted-foreground font-semibold hover:underline">Reset</button>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto py-1">
                          {/* Years */}
                          {(() => {
                            const availableMonths = (actData?.availableMonths ?? []) as string[];
                            const years = [...new Set(availableMonths.map((m: string) => m.split("-")[0]))].sort((a: string, b: string) => b.localeCompare(a));
                            return years.map((y: string) => {
                              const monthsOfYear = availableMonths.filter((m: string) => m.startsWith(y + "-"));
                              return (
                                <div key={y}>
                                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-secondary transition-colors cursor-pointer">
                                    <span className={cn("w-4 h-4 rounded border shrink-0 flex items-center justify-center", actPeriodes.has(y) || monthsOfYear.some((m: string) => actPeriodes.has(m)) ? "border-primary bg-primary/10" : "border-border")}>
                                      {(actPeriodes.has(y) || monthsOfYear.every((m: string) => actPeriodes.has(m))) && actPeriodes.size > 0 && <span className="text-primary text-[9px] font-black leading-none">–</span>}
                                    </span>
                                    <span className="flex-1 text-sm font-semibold text-foreground">{y}</span>
                                  </div>
                                  {monthsOfYear.map((m: string) => {
                                    const monthNum = parseInt(m.split("-")[1]);
                                    const isSelected = actPeriodes.has(m);
                                    return (
                                      <button key={m} onClick={() => {
                                        setActPeriodes(prev => {
                                          const next = new Set(prev);
                                          if (next.has(m)) next.delete(m); else next.add(m);
                                          return next;
                                        });
                                      }} className="w-full text-left pl-9 pr-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2 transition-colors">
                                        <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center", isSelected ? "bg-primary border-primary" : "border-border")}>
                                          {isSelected && <span className="text-white text-[8px] font-black">✓</span>}
                                        </span>
                                        <span className={cn(isSelected ? "text-primary font-semibold" : "")}>{MONTHS_FULL[monthNum - 1]}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Kategori */}
                <div className="flex flex-col gap-1 w-44 shrink-0">
                  <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Kategori</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                        <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                          {actKategori.size === 0 ? "Semua" : actKategori.size === 1 ? [...actKategori][0].replace(/_/g, " ") : `${actKategori.size} dipilih`}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 200 }}>
                      <div className="bg-popover border border-border rounded-xl shadow-xl min-w-[200px] max-w-[260px] overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Kategori</span>
                          <div className="flex gap-1.5">
                            <button onClick={() => setActKategori(new Set())} className="text-[11px] text-primary font-semibold hover:underline">Semua</button>
                            <span className="text-muted-foreground text-[11px]">·</span>
                            <button onClick={() => setActKategori(new Set(KATEGORI_OPTIONS.map(o => o.value)))} className="text-[11px] text-muted-foreground font-semibold hover:underline">Kosongkan</button>
                          </div>
                        </div>
                        <div className="max-h-56 overflow-y-auto py-1">
                          {KATEGORI_OPTIONS.map(opt => {
                            const isSelected = actKategori.has(opt.value);
                            return (
                              <button key={opt.value} onClick={() => {
                                setActKategori(prev => {
                                  const next = new Set(prev);
                                  if (next.has(opt.value)) next.delete(opt.value); else next.add(opt.value);
                                  return next;
                                });
                              }} className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center gap-2 transition-colors">
                                <span className={cn("w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center", isSelected ? "bg-primary border-primary" : "border-border")}>
                                  {isSelected && <span className="text-white text-[8px] font-black">✓</span>}
                                </span>
                                <span className={cn(isSelected ? "text-primary font-semibold" : "")}>{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Divisi */}
                <div className="flex flex-col gap-1 w-28 shrink-0">
                  <label className="text-xs font-display font-bold text-foreground uppercase tracking-wide">Divisi</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-9 px-3 bg-secondary/50 border border-border rounded-lg text-sm flex items-center gap-1.5 w-full whitespace-nowrap focus:ring-2 focus:ring-primary/20 focus:border-primary">
                        <span className="flex-1 text-left truncate font-medium text-foreground text-xs">
                          {DIVISI_OPTIONS_EMB.find(o => o.value === actDivisi)?.label ?? "LESA (All)"}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start" sideOffset={4} style={{ width: 120 }}>
                      <div className="bg-popover border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto py-1">
                        {DIVISI_OPTIONS_EMB.map(opt => (
                          <button key={opt.value} onClick={() => setActDivisi(opt.value)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2">
                            <span className="w-1.5 shrink-0 flex items-center justify-center">
                              {actDivisi === opt.value && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                            </span>
                            <span className={cn(actDivisi === opt.value ? "font-semibold text-primary" : "")}>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* ── KPI Progress + Activity Table ───────────────────── */}
              {actLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                (() => {
                  const kpiTarget = actData?.kpiTarget ?? 30;
                  const kpiCount = actData?.kpiCount ?? 0;
                  const activityCount = actData?.activityCount ?? 0;
                  const pct = kpiTarget > 0 ? Math.min(100, (kpiCount / kpiTarget) * 100) : 0;
                  const remaining = Math.max(0, kpiTarget - kpiCount);
                  const isAboveKpi = kpiCount >= kpiTarget;
                  const statusLabel = isAboveKpi ? "Memenuhi KPI" : "Di Bawah KPI";
                  const statusBg = isAboveKpi ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600";
                  const barColor = pct >= 100 ? "from-emerald-600 to-emerald-500" : "from-red-600 to-red-500";

                  // Build kategori label
                  const kategoriLabel = (label: string | null | undefined): string => {
                    if (!label) return "–";
                    const l = label.toLowerCase();
                    if (l.includes("tanpa")) return "Tanpa Pelanggan";
                    if (l.includes("proyek")) return "Pelanggan Dengan Proyek";
                    return "Dengan Pelanggan";
                  };
                  const kategoriColor = (label: string | null | undefined): string => {
                    if (!label) return "bg-slate-100 text-slate-700";
                    const l = label.toLowerCase();
                    if (l.includes("tanpa")) return "bg-slate-100 text-slate-700";
                    if (l.includes("proyek")) return "bg-teal-50 text-teal-700";
                    return "bg-blue-50 text-blue-700";
                  };

                  // Filter activities by search + pagination
                  const filteredActivities = (actData?.activities ?? []) as any[];
                  const searchedActivities = actSearch.trim()
                    ? filteredActivities.filter((a: any) => {
                        const q = actSearch.toLowerCase();
                        return (
                          (a.caName || "").toLowerCase().includes(q) ||
                          (a.label || "").toLowerCase().includes(q) ||
                          (a.activityType || "").toLowerCase().includes(q) ||
                          (a.activityNotes || "").toLowerCase().includes(q) ||
                          (a.picName || "").toLowerCase().includes(q)
                        );
                      })
                    : filteredActivities;

                  // Reset page when filters/search change
                  const safePage = Math.min(actPage, Math.max(1, Math.ceil(searchedActivities.length / actPageSize)));
                  const paginatedActivities = searchedActivities.slice((safePage - 1) * actPageSize, safePage * actPageSize);
                  const totalPages = Math.max(1, Math.ceil(searchedActivities.length / actPageSize));

                  return (
                    <>
                      {/* KPI Header Card */}
                      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center gap-3">
                          <span className="text-sm font-bold text-foreground">Monitoring KPI Aktivitas</span>
                          <span className="bg-secondary border border-border text-foreground text-xs font-bold px-2 py-0.5 rounded-full">{effectiveNik}</span>
                          <div className="flex-1" />
                          {/* Search */}
                          <div className="h-8 flex items-center gap-2 bg-background border border-border rounded-lg px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-colors min-w-[220px]">
                            <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                            <input
                              type="text"
                              placeholder="Cari tipe, label, pelanggan, catatan…"
                              value={actSearch}
                              onChange={e => setActSearch(e.target.value)}
                              className="border-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 bg-transparent flex-1 min-w-0"
                            />
                          </div>
                        </div>

                        {/* KPI Progress Bar */}
                        <div className="grid items-center px-4 py-3 border-b border-border" style={{ gridTemplateColumns: "1fr 240px 100px 72px 64px 110px" }}>
                          <div>
                            <div className="text-sm font-bold text-foreground">{data?.am?.nama ?? effectiveNik}</div>
                            <div className="text-xs font-semibold text-foreground/70 mt-0.5 flex items-center gap-1">
                              {data?.am?.divisi && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-100 text-blue-700">{data.am.divisi}</span>
                              )}
                              <span className="text-foreground/60 font-semibold">· {activityCount} aktivitas</span>
                            </div>
                          </div>
                          <div className="pr-2">
                            <div className="h-4 bg-secondary rounded-full overflow-hidden mb-2">
                              <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", barColor)} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className={cn("text-base font-black font-display", isAboveKpi ? "text-emerald-600" : "text-red-600")}>{pct.toFixed(0)}%</span>
                              <span className="text-sm font-bold font-display text-foreground/70">{kpiCount}/{kpiTarget} aktivitas KPI</span>
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-base font-black font-display text-foreground">{kpiCount}</div>
                            <div className="text-[10px] font-medium text-foreground/50">Aktivitas</div>
                          </div>
                          <div className="text-center">
                            <div className="text-base font-bold font-display text-foreground/70">{kpiTarget}</div>
                            <div className="text-[10px] font-medium text-foreground/50">Target</div>
                          </div>
                          <div className="text-center">
                            <div className="text-base font-bold font-display text-foreground">{remaining}</div>
                            <div className="text-[10px] font-medium text-foreground/50">Sisa</div>
                          </div>
                          <div>
                            <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold", statusBg)}>
                              {statusLabel}
                            </span>
                          </div>
                        </div>

                        {/* Activity Detail Table Header */}
                        {paginatedActivities.length > 0 && (
                          <div className="grid text-xs font-black uppercase tracking-wide text-white font-display" style={{ gridTemplateColumns: "28px 96px 1fr 140px 120px 60px", padding: "10px 14px 10px 52px", background: "rgb(185, 28, 28)" }}>
                            <div>#</div>
                            <div>Tanggal</div>
                            <div>Pelanggan &amp; Catatan</div>
                            <div>Tipe Aktivitas</div>
                            <div>Kategori</div>
                            <div>KPI</div>
                          </div>
                        )}

                        {/* Activity Rows */}
                        {paginatedActivities.length === 0 ? (
                          <div className="flex items-center gap-3 px-6 py-8 text-sm text-foreground/50 justify-center">
                            <Activity className="w-4 h-4" />
                            <span>Tidak ada data aktivitas pada periode yang dipilih.</span>
                          </div>
                        ) : paginatedActivities.map((act: any, idx: number) => {
                          const [datePart] = (act.activityEndDate ?? "").split(" ");
                          const dateObj = datePart ? new Date(datePart) : null;
                          const dayStr = dateObj ? `${String(dateObj.getDate()).padStart(2,"0")}/${String(dateObj.getMonth()+1).padStart(2,"0")}` : "–";
                          const monthStr = dateObj ? dateObj.toLocaleDateString("id-ID", { weekday: "short", month: "short", year: "numeric" }).replace(",","") : "–";
                          const kat = kategoriLabel(act.label);
                          const katCls = kategoriColor(act.label);
                          return (
                            <div key={act.id}>
                              <div className="grid items-start border-b border-border/20 last:border-b-0 hover:bg-secondary/30 transition-colors"
                                style={{ gridTemplateColumns: "28px 96px 1fr 140px 120px 60px", padding: "9px 14px 9px 52px" }}>
                                <div className="text-xs font-bold text-foreground/50 font-mono pt-0.5">{idx + 1}</div>
                                <div>
                                  <div className="text-sm font-bold text-foreground font-mono">{dayStr}</div>
                                  <div className="text-[11px] font-medium text-foreground/60 mt-px">{monthStr}</div>
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-foreground">{act.caName || "–"}</div>
                                  <div className="text-xs font-medium text-foreground/60 mt-0.5 line-clamp-2">{act.activityNotes || "–"}</div>
                                </div>
                                <div className="pt-0.5">
                                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "rgb(227, 242, 253)", color: "rgb(21, 101, 192)" }}>
                                    {act.activityType || "–"}
                                  </span>
                                </div>
                                <div className="pt-0.5">
                                  <span className={cn("inline-flex px-2 py-0.5 rounded text-xs font-semibold", katCls)}>{kat}</span>
                                </div>
                                <div className="pt-0.5">
                                  <span className={cn("text-xs font-bold px-2 py-0.5 rounded", act.isKpi ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-50")}>
                                    {act.isKpi ? "✓ Ya" : "✗ Tidak"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Pagination Controls */}
                        {searchedActivities.length > 0 && (
                          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-secondary/20">
                            {/* Page size */}
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Tampilkan:</span>
                              {[10, 20, 50].map(size => (
                                <button key={size} onClick={() => { setActPageSize(size); setActPage(1); }}
                                  className={cn("h-6 px-2.5 rounded text-[11px] font-semibold border transition-colors",
                                    actPageSize === size ? "bg-primary border-primary text-white" : "border-border bg-background hover:border-primary/40 text-foreground")}>
                                  {size}
                                </button>
                              ))}
                            </div>
                            {/* Page info + controls */}
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] font-medium text-foreground/60">
                                {(safePage - 1) * actPageSize + 1}–{Math.min(safePage * actPageSize, searchedActivities.length)} dari {searchedActivities.length}
                              </span>
                              <button onClick={() => setActPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                                className="h-7 w-7 flex items-center justify-center rounded border border-border bg-background hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                const start = Math.max(1, Math.min(safePage - 2, totalPages - 4));
                                const page = start + i;
                                if (page > totalPages) return null;
                                return (
                                  <button key={page} onClick={() => setActPage(page)}
                                    className={cn("h-7 min-w-[28px] px-1 flex items-center justify-center rounded text-[11px] font-semibold border transition-colors",
                                      safePage === page ? "bg-primary border-primary text-white" : "border-border bg-background hover:border-primary/40 text-foreground")}>
                                    {page}
                                  </button>
                                );
                              })}
                              <button onClick={() => setActPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                                className="h-7 w-7 flex items-center justify-center rounded border border-border bg-background hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Summary Footer */}
                        {paginatedActivities.length > 0 && (
                          <div className="flex items-center gap-5 px-6 py-3 border-t-2 border-primary/20 bg-primary/5">
                            <span className="text-[10px] font-bold text-foreground/40 uppercase tracking-wide">Ringkasan:</span>
                            <span className="text-sm font-bold text-emerald-700">{kpiCount} aktivitas KPI</span>
                            <span className="text-sm font-semibold text-foreground/60">({activityCount} total)</span>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()
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
                  <RankBadge badge={am.badge} />
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
