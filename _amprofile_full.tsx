import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Camera, Loader2, X, ZoomIn, ZoomOut, Upload, LogOut, BarChart2,
  TrendingUp, ChevronDown, Check, Target, Award, TrendingDown, ChevronLeft,
  ChevronRight, Users, CreditCard, MapPin, Building2
} from "lucide-react";
import { getPresentationSession, clearPresentationSession } from "@/shared/hooks/use-presentation-auth";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

// ─── Types ──────────────────────────────────────────────────────────────────
interface AmProfile {
  nik: string;
  nama: string;
  divisi: string;
  witel: string;
  badge: string;
  photoUrl: string | null;
}
interface CustomerRow {
  nip: string;
  pelanggan: string;
  divisi: string;
  divisiCc: string;
  segmen: string;
  proporsi: number;
  targetTotal: number;
  realTotal: number;
  achRate: number;
}
interface Snapshot {
  id: number;
  period: string;
  label: string;
  snapshotDate: string | null;
}
interface AmProfileResponse {
  am: AmProfile;
  snapshots: Snapshot[];
  selectedSnapshotId: number | null;
  customers: CustomerRow[];
  summary: {
    totalTarget: number;
    totalReal: number;
    achRate: number;
    periodText: string;
    customerCount: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtRupiah = (n: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "Rp 0";
  return `Rp ${v.toLocaleString("id-ID", { minimumFractionDigits: 0 })}`;
};
const fmtPct = (n: number) => `${Number(n).toFixed(1)}%`;
const fmtRupiahShort = (n: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}M`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}Jt`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}Rb`;
  return v.toString();
};

// ─── TABS for embedded ────────────────────────────────────────────────────────
const TABS = [
  { id: "performansi", label: "Data Performansi", icon: BarChart2 },
  { id: "summary", label: "Ringkasan", icon: Award },
  { id: "customer", label: "Detail Pelanggan", icon: Users },
] as const;
type TabId = typeof TABS[number]["id"];

// ─── Crop Image Canvas ───────────────────────────────────────────────────────
interface CropModalProps {
  imageSrc: string;
  onCrop: (blob: Blob) => void;
  onClose: () => void;
}
function CropImageCanvas({ imageSrc, onCrop, onClose }: CropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const size = Math.min(img.width, img.height);
      const initialScale = 200 / size;
      setScale(initialScale);
      setOffset({ x: (img.width - size) / 2, y: (img.height - size) / 2 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 300;
    canvas.height = 300;
    ctx.clearRect(0, 0, 300, 300);
    const cropSize = 200 / scale;
    ctx.drawImage(img, offset.x, offset.y, cropSize, cropSize, 0, 0, 300, 300);
  }, [scale, offset]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !imgRef.current) return;
    const dx = (e.clientX - dragStart.current.x) / scale;
    const dy = (e.clientY - dragStart.current.y) / scale;
    const img = imgRef.current;
    const cropSize = 200 / scale;
    setOffset({
      x: Math.max(0, Math.min(img.width - cropSize, dragStart.current.ox + dx)),
      y: Math.max(0, Math.min(img.height - cropSize, dragStart.current.oy + dy)),
    });
  };
  const handleMouseUp = () => setIsDragging(false);

  const zoomIn = () => setScale(s => Math.min(s * 1.2, 5));
  const zoomOut = () => setScale(s => Math.max(s / 1.2, 0.1));

  const handleCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => { if (blob) onCrop(blob); }, "image/jpeg", 0.9);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="font-semibold text-slate-800 text-sm">Crop Foto</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="p-4">
          <div
            className="relative w-[200px] h-[200px] mx-auto mb-4 rounded-full overflow-hidden border-4 border-white shadow-lg cursor-move select-none"
            style={{ background: "#f1f5f9" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <div className="flex items-center justify-center gap-3 mb-4">
            <button onClick={zoomOut} className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors">
              <ZoomOut className="w-4 h-4 text-slate-600" />
            </button>
            <span className="text-xs text-slate-500 font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
            <button onClick={zoomIn} className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors">
              <ZoomIn className="w-4 h-4 text-slate-600" />
            </button>
          </div>
          <div className="text-xs text-slate-500 text-center mb-4">
            Drag foto untuk memindahkan &bull; Output: 300&times;300 px
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2 px-4 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Batal
            </button>
            <button onClick={handleCrop} className="flex-1 py-2 px-4 rounded-lg bg-red-600 text-sm font-medium text-white hover:bg-red-700 transition-colors">
              Simpan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Badge Component ───────────────────────────────────────────────────────────
function Badge({ badge }: { badge: string }) {
  if (badge === "ENTERPRISE") return <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded-full px-2 py-0.5"><span>🏢</span>{badge}</span>;
  if (badge === "GOVERNMENT") return <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded-full px-2 py-0.5"><span>🏛️</span>{badge}</span>;
  if (badge === "MULTI DIVISION") return <span className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 bg-purple-100 border border-purple-200 rounded-full px-2 py-0.5"><span>📦</span>{badge}</span>;
  return <span className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">{badge}</span>;
}

// ─── Main Component ──────────────────────────────────────────────────────────
interface Props {
  nik?: string;
  embedded?: boolean;
  onAmLoaded?: (info: { nama: string; badge: string; nik: string }) => void;
}

export default function AmProfilePage({ nik, embedded = false, onAmLoaded }: Props) {
  const [data, setData] = useState<AmProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Embedded state
  const [embTab, setEmbTab] = useState<TabId>("performansi");
  const [embPage, setEmbPage] = useState(1);
  const [embPageSize] = useState(10);

  const session = getPresentationSession();
  const effectiveNik = nik ?? session?.nik ?? "";

  useEffect(() => {
    if (!effectiveNik) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/presentation/am-profile/${encodeURIComponent(effectiveNik)}`, {
      headers: { "x-presentation-token": session?.presentationToken ?? "" },
      credentials: "include",
    })
      .then(r => { if (!r.ok) throw new Error("Gagal memuat data profil"); return r.json(); })
      .then((d: AmProfileResponse) => {
        setData(d);
        onAmLoaded?.({ nama: d.am.nama, badge: d.am.badge, nik: d.am.nik });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [effectiveNik]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (ev.target?.result) {
        setCropImageSrc(ev.target.result as string);
        setShowCropModal(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleCropped = async (blob: Blob) => {
    setShowCropModal(false);
    setCropImageSrc(null);
    if (!blob) return;
    setUploading(true);
    const form = new FormData();
    form.append("photo", blob, "photo.jpg");
    try {
      const res = await fetch(`${API_BASE}/api/presentation/am-photo`, {
        method: "POST",
        headers: { "x-presentation-token": session?.presentationToken ?? "" },
        credentials: "include",
        body: form,
      });
      const json = await res.json();
      if (json.success) {
        setData(d => d ? { ...d, am: { ...d.am, photoUrl: json.photoUrl + "?t=" + Date.now() } } : d);
      }
    } finally {
      setUploading(false);
    }
  };

  // ── EMBEDDED VERSION ────────────────────────────────────────────────────────
  if (embedded) {
    if (loading) return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-red-600" />
      </div>
    );
    if (error || !data) return (
      <div className="text-center py-20 text-sm text-slate-500">{error ?? "Data tidak tersedia"}</div>
    );

    const { am, summary, customers } = data;
    const photoSrc = am.photoUrl
      ? (am.photoUrl.startsWith("http") ? am.photoUrl : `${API_BASE}${am.photoUrl}`)
      : null;

    const totalPages = Math.max(1, Math.ceil(customers.length / embPageSize));
    const paginatedCustomers = customers.slice((embPage - 1) * embPageSize, embPage * embPageSize);

    return (
      <>
        {/* Wallpaper Header */}
        <div className="relative w-full overflow-hidden mb-3" style={{ height: "240px" }}>
          <img alt="" className="absolute inset-0 w-full h-full object-cover object-right scale-[1.2]" src="/login-bg.jpg" />
          <div className="absolute inset-0 bg-[#cc0000]/70 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
          <div className="relative z-10 flex flex-col h-full px-4 pb-3">
            {/* Profile row: avatar + nama + chips — same row */}
            <div className="flex items-center mt-auto mb-5">
              {/* Avatar — rounded square, larger */}
              <div className="relative flex-shrink-0 mr-4">
                <div className="w-28 h-28 rounded-2xl bg-white/20 backdrop-blur-md border-2 border-white/40 flex items-center justify-center text-5xl font-black text-white shadow-xl overflow-hidden">
                  {photoSrc ? (
                    <img
                      src={photoSrc}
                      alt={am.nama}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : null}
                  <span className="relative z-10 select-none">{am.nama.charAt(0)}</span>
                </div>
                {/* Upload button */}
                <div className="absolute -bottom-1 -right-1">
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-7 h-7 rounded-full bg-blue-500 hover:bg-blue-600 border-2 border-white flex items-center justify-center transition-colors disabled:opacity-50"
                    title="Unggah Foto"
                  >
                    {uploading ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>
              </div>
              {/* Nama + Chips di kanan avatar */}
              <div className="flex-1 min-w-0">
                <h2 className="text-3xl font-bold text-white drop-shadow leading-tight">{am.nama}</h2>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <div className="flex flex-col px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[10px] text-white/70 font-medium leading-none"><CreditCard className="w-3 h-3 inline mr-0.5 -mt-0.5" />NIK</span>
                    <span className="text-[13px] text-white font-bold leading-none mt-0.5">{am.nik}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[10px] text-white/70 font-medium leading-none"><MapPin className="w-3 h-3 inline mr-0.5 -mt-0.5" />WITEL</span>
                    <span className="text-[13px] text-white font-bold leading-none mt-0.5">{am.witel ?? "SURAMADU"}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[10px] text-white/70 font-medium leading-none"><Building2 className="w-3 h-3 inline mr-0.5 -mt-0.5" />DIVISI</span>
                    <span className="text-[13px] text-white font-bold leading-none mt-0.5">{am.divisi ?? "DPS"}</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Tabs di bawah */}
            <div className="flex gap-0">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = embTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setEmbTab(tab.id); setEmbPage(1); }}
                    className={`flex items-center gap-1 py-2 px-4 text-xs font-bold border-b-2 transition-all ${
                      isActive ? "text-white border-white" : "text-white/50 border-transparent hover:text-white/80"
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Tab: Performansi */}
          {embTab === "performansi" && (
            <div className="p-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: "Total Target", value: fmtRupiah(summary.totalTarget), sub: null },
                  { label: "Total Realisasi", value: fmtRupiah(summary.totalReal), sub: null },
                  { label: "Achievement", value: fmtPct(summary.achRate), sub: `${summary.customerCount} pelanggan` },
                  { label: "Periode", value: summary.periodText || "-", sub: null },
                ].map(card => (
                  <div key={card.label} className="bg-slate-50 rounded-xl border border-slate-200 p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">{card.label}</p>
                    <p className="text-sm font-bold text-slate-800">{card.value}</p>
                    {card.sub && <p className="text-xs text-slate-400 mt-0.5">{card.sub}</p>}
                    {card.label === "Achievement" && (
                      <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${summary.achRate >= 100 ? "bg-emerald-500" : summary.achRate >= 80 ? "bg-yellow-400" : "bg-red-500"}`}
                          style={{ width: `${Math.min(100, summary.achRate)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Ringkasan */}
          {embTab === "summary" && (
            <div className="p-4">
              <div className="space-y-3">
                {[
                  { label: "Target Revenue", value: fmtRupiah(summary.totalTarget), color: "text-blue-600" },
                  { label: "Realisasi Revenue", value: fmtRupiah(summary.totalReal), color: "text-emerald-600" },
                  { label: "Achievement Rate", value: fmtPct(summary.achRate), color: summary.achRate >= 100 ? "text-emerald-600" : summary.achRate >= 80 ? "text-yellow-600" : "text-red-600" },
                  { label: "Jumlah Pelanggan", value: String(summary.customerCount), color: "text-slate-700" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-600">{item.label}</span>
                    <span className={`text-sm font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Detail Pelanggan */}
          {embTab === "customer" && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-8">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Pelanggan</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Divisi</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Segmen</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-600">Target</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-600">Realisasi</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-600">Ach</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-slate-400">Belum ada data pelanggan</td>
                      </tr>
                    ) : (
                      paginatedCustomers.map((cust, idx) => {
                        const achClass = cust.achRate >= 100 ? "text-emerald-700 bg-emerald-50" : cust.achRate >= 80 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
                        return (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-2.5 text-slate-400">{(embPage - 1) * embPageSize + idx + 1}</td>
                            <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[160px] truncate">{cust.pelanggan || "-"}</td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                                cust.divisi === "DPS" || cust.divisiCc === "DPS" ? "bg-blue-100 text-blue-700" :
                                cust.divisi === "DSS" || cust.divisiCc === "DSS" ? "bg-green-100 text-green-700" :
                                cust.divisi === "DGS" || cust.divisiCc === "DGS" ? "bg-purple-100 text-purple-700" :
                                "bg-slate-100 text-slate-600"
                              }`}>{cust.divisi || cust.divisiCc || "-"}</span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-500">{cust.segmen || "-"}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtRupiah(cust.targetTotal)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtRupiah(cust.realTotal)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-bold ${achClass}`}>
                                {fmtPct(cust.achRate)}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50">
                  <span className="text-xs text-slate-500">
                    {(embPage - 1) * embPageSize + 1}-{Math.min(embPage * embPageSize, customers.length)} dari {customers.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEmbPage(p => Math.max(1, p - 1))}
                      disabled={embPage <= 1}
                      className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4 text-slate-600" />
                    </button>
                    <span className="text-xs font-mono text-slate-600 w-12 text-center">{embPage}/{totalPages}</span>
                    <button
                      onClick={() => setEmbPage(p => Math.min(totalPages, p + 1))}
                      disabled={embPage >= totalPages}
                      className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {showCropModal && cropImageSrc && createPortal(
          <CropImageCanvas
            imageSrc={cropImageSrc}
            onCrop={handleCropped}
            onClose={() => { setShowCropModal(false); setCropImageSrc(null); }}
          />,
          document.body
        )}
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
  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="text-center text-slate-500">{error ?? "Profil tidak ditemukan"}</div>
    </div>
  );

  const { am, summary, customers } = data;
  const photoSrc = am.photoUrl
    ? (am.photoUrl.startsWith("http") ? am.photoUrl : `${API_BASE}${am.photoUrl}`)
    : null;

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Header with wallpaper */}
        <div className="relative w-full overflow-hidden" style={{ height: "240px" }}>
          <img alt="" className="absolute inset-0 w-full h-full object-cover object-right scale-[1.2]" src="/login-bg.jpg" />
          <div className="absolute inset-0 bg-[#cc0000]/70 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />
          <div className="relative z-10 flex flex-col h-full px-6 pb-3">
            {/* Profile row: avatar + nama + chips */}
            <div className="flex items-center mt-auto mb-4">
              {/* Avatar */}
              <div className="relative flex-shrink-0 mr-4">
                <div className="w-28 h-28 rounded-2xl bg-white/20 backdrop-blur-md border-2 border-white/40 flex items-center justify-center text-5xl font-black text-white shadow-xl overflow-hidden">
                  {photoSrc ? (
                    <img src={photoSrc} alt={am.nama} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    am.nama.charAt(0)
                  )}
                </div>
                {/* Upload button */}
                <div className="absolute -bottom-1 -right-1">
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-7 h-7 rounded-full bg-blue-500 hover:bg-blue-600 border-2 border-white flex items-center justify-center transition-colors disabled:opacity-50"
                    title="Unggah Foto"
                  >
                    {uploading ? (
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <h1 className="text-3xl font-bold text-white drop-shadow-lg">{am.nama}</h1>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <div className="flex flex-col px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[10px] text-white/70 font-medium leading-none"><CreditCard className="w-3 h-3 inline mr-0.5 -mt-0.5" />NIK</span>
                    <span className="text-[13px] text-white font-bold leading-none mt-0.5">{am.nik}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[10px] text-white/70 font-medium leading-none"><MapPin className="w-3 h-3 inline mr-0.5 -mt-0.5" />WITEL</span>
                    <span className="text-[13px] text-white font-bold leading-none mt-0.5">{am.witel ?? "SURAMADU"}</span>
                  </div>
                  <div className="flex flex-col px-3 py-1.5 rounded-lg bg-white/15 backdrop-blur-md border border-white/20">
                    <span className="text-[10px] text-white/70 font-medium leading-none"><Building2 className="w-3 h-3 inline mr-0.5 -mt-0.5" />DIVISI</span>
                    <span className="text-[13px] text-white font-bold leading-none mt-0.5">{am.divisi ?? "DPS"}</span>
                  </div>
                  <Badge badge={am.badge} />
                </div>
              </div>
              {/* Achievement */}
              <div className="text-right flex-shrink-0">
                <div className={`text-4xl font-black ${summary.achRate >= 100 ? "text-emerald-300" : summary.achRate >= 80 ? "text-yellow-300" : "text-white"}`}>
                  {fmtPct(summary.achRate)}
                </div>
                <div className="text-white/70 text-xs">{summary.periodText}</div>
              </div>
            </div>
            {/* Tabs di bawah */}
            <div className="flex gap-0">
              {TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {}}
                    className="flex items-center gap-1 py-2 px-4 text-xs font-bold text-white/50 border-b-2 border-transparent hover:text-white/80 transition-all"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
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
                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                {card.label === "Achievement" && (
                  <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r rounded-full transition-all ${summary.achRate >= 100 ? "from-emerald-500 to-emerald-400" : summary.achRate >= 80 ? "from-yellow-400 to-yellow-300" : "from-red-500 to-red-400"}`}
                      style={{ width: `${Math.min(100, summary.achRate)}%` }}
                    />
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
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                        Belum ada data pelanggan
                      </td>
                    </tr>
                  ) : (
                    customers.map((cust, idx) => {
                      const achClass =
                        cust.achRate >= 100 ? "text-emerald-700 bg-emerald-50" :
                        cust.achRate >= 80 ? "text-amber-700 bg-amber-50" :
                        "text-red-700 bg-red-50";
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2.5 text-slate-400 text-xs">{idx + 1}</td>
                          <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[200px] truncate">{cust.pelanggan || "-"}</td>
                          <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">{cust.nip || "-"}</td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                              cust.divisi === "DPS" || cust.divisiCc === "DPS" ? "bg-blue-100 text-blue-700" :
                              cust.divisi === "DSS" || cust.divisiCc === "DSS" ? "bg-green-100 text-green-700" :
                              cust.divisi === "DGS" || cust.divisiCc === "DGS" ? "bg-purple-100 text-purple-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>{cust.divisi || cust.divisiCc || "-"}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 text-xs">{cust.segmen || "-"}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtRupiah(cust.targetTotal)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtRupiah(cust.realTotal)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${achClass}`}>
                              {fmtPct(cust.achRate)}
                            </span>
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

      {showCropModal && cropImageSrc && createPortal(
        <CropImageCanvas
          imageSrc={cropImageSrc}
          onCrop={handleCropped}
          onClose={() => { setShowCropModal(false); setCropImageSrc(null); }}
        />,
        document.body
      )}
    </>
  );
}
