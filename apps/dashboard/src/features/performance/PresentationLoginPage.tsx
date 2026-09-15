import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, CreditCard, XCircle } from "lucide-react";
import { getPresentationSession } from "@/shared/hooks/use-presentation-auth";

export default function PresentationLoginPage() {
  const [nik, setNik] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "otp">("form");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const [otpLocked, setOtpLocked] = useState(false);
  const [hasResent, setHasResent] = useState(false);
  const resendRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preserve ?type=funnel&snapshot=142 through the login flow
  const returnTo = typeof window !== "undefined" ? window.location.search : "";

  // Expiry countdown — only runs when step is "otp", clears when leaving otp step
  useEffect(() => {
    if (step !== "otp") return;
    setError(null); // clear any stale expiry error when entering otp step
    const tick = () => {
      // Only show expiry timer if user has actually resent a code
      if (!hasResent) return;
      const exp = sessionStorage.getItem("pres_expiresAt");
      if (!exp) return;
      const remaining = Math.max(0, Math.ceil((new Date(exp).getTime() - Date.now()) / 1000));
      setOtpExpirySeconds(remaining);
      if (remaining <= 0) {
        setError("Kode verifikasi telah kedaluwarsa. Silakan minta kode baru.");
        if (expiryRef.current) clearInterval(expiryRef.current);
      }
    };
    tick();
    expiryRef.current = setInterval(tick, 1000);
    return () => { if (expiryRef.current) clearInterval(expiryRef.current); };
  }, [step, hasResent]);

  // Clear error when leaving otp step (e.g., going back to form)
  useEffect(() => {
    if (step !== "otp") {
      setError(null);
    }
  }, [step]);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) {
      if (resendRef.current) { clearInterval(resendRef.current); resendRef.current = null; }
      if (otpLocked) {
        setOtpLocked(false);
        setError(null); // clear "terlalu banyak" error after cooldown ends
      }
      return;
    }
    resendRef.current = setInterval(() => {
      setResendCooldown(c => {
        if (c <= 1) {
          if (resendRef.current) { clearInterval(resendRef.current); resendRef.current = null; }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (resendRef.current) { clearInterval(resendRef.current); resendRef.current = null; } };
  }, [resendCooldown > 0]);

  // If already logged into presentation, redirect to /presentation + preserved params
  useEffect(() => {
    // Check cookie session
    if (document.cookie.includes("pres_sid")) {
      window.location.href = "/presentation" + returnTo;
      return;
    }
    // Check localStorage presentation token
    const session = getPresentationSession();
    if (session?.presentationToken) {
      window.location.href = "/presentation" + returnTo;
      return;
    }
  }, []);

  // Don't render until mounted (client-side only to avoid hydration mismatch)
  if (typeof window === "undefined") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Submit NIK → request OTP ────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNik = nik.trim();
    if (!trimmedNik) return;

    setIsLoading(true);
    setError(null);

    try {
      const apiBase = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiBase}/api/auth/presentation/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nik: trimmedNik }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "NIK tidak ditemukan");
        setIsLoading(false);
        return;
      }

      if (data.nextStep === "TELEGRAM_LINK_REQUIRED") {
        sessionStorage.setItem("pres_returnTo", returnTo);
        setLocation(`/auth/telegram-link?returnTo=${encodeURIComponent("/presentation" + returnTo)}`);
        return;
      }

      if (data.nextStep === "OTP_REQUIRED") {
        setChallengeId(data.challengeId);
        sessionStorage.setItem("pres_challengeId", data.challengeId);
        sessionStorage.setItem("pres_expiresAt", data.expiresAt);
        sessionStorage.setItem("pres_pendingNik", trimmedNik);
        sessionStorage.setItem("pres_pendingNama", data.nama);
        sessionStorage.setItem("pres_pendingUserId", String(data.userId));
        setStep("otp");
        setOtpExpirySeconds(Math.ceil((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
        setResendCooldown(0);
        setHasResent(true); // initial OTP already sent
        setOtp("");
      }
    } catch (err: any) {
      setError(err?.message ?? "Koneksi gagal. Silakan coba lagi.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Verify OTP ─────────────────────────────────────────────────────────────
  const handleVerify = async (currentOtp?: string) => {
    const code = currentOtp ?? otp;
    if (code.length !== 5) {
      setError("Masukkan 5 digit kode verifikasi");
      return;
    }

    const cid = challengeId ?? sessionStorage.getItem("pres_challengeId");
    if (!cid) {
      setError("Challenge tidak valid. Silakan mulai dari awal.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const apiBase = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiBase}/api/auth/presentation/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ challengeId: cid, otp: code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Kode verifikasi tidak sesuai");
        setOtp("");
        if (data.locked) {
          setOtpLocked(true);
          setResendCooldown(60);
          setHasResent(false); // hide expiry timer during lock — will re-show after user clicks resend
          setOtpExpirySeconds(0);
        }
        setIsLoading(false);
        return;
      }

      // Store presentation session in localStorage
      const token: string = data.presentationToken ?? "";
      const pendingNik = sessionStorage.getItem("pres_pendingNik") ?? "";
      const nama = sessionStorage.getItem("pres_pendingNama") ?? "";
      const expires = new Date();
      expires.setDate(expires.getDate() + 1);
      localStorage.setItem("presentation_auth_v1", JSON.stringify({
        nik: pendingNik,
        namaAm: nama,
        expires: expires.toISOString(),
        presentationToken: token,
      }));

      window.location.href = "/presentation" + returnTo;
    } catch (err: any) {
      setError(err?.message ?? "Koneksi gagal. Silakan coba lagi.");
      setResendCooldown(60);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Resend OTP ─────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (resendCooldown > 0) return;

    setIsResending(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL ?? "";
      const userId = sessionStorage.getItem("pres_pendingUserId");
      const res = await fetch(`${apiBase}/api/auth/presentation/resend-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "Gagal mengirim kode verifikasi ulang.");
        return;
      }

      setChallengeId(data.challengeId);
      sessionStorage.setItem("pres_challengeId", data.challengeId);
      sessionStorage.setItem("pres_expiresAt", data.expiresAt);
      setOtpExpirySeconds(Math.ceil((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
      setResendCooldown(60);
      setError(null);
      setOtp("");
    } catch (err: any) {
      setError(err?.message ?? "Gagal mengirim kode verifikasi ulang.");
    } finally {
      setIsResending(false);
    }
  };

  const pendingNama = sessionStorage.getItem("pres_pendingNama");

  if (step === "otp") {
    return (
      <div className="relative flex min-h-screen w-full overflow-hidden">
        <div className="absolute inset-0 z-0 lg:hidden">
          <img src={`${import.meta.env.BASE_URL}login-bg.jpg`} alt="" className="h-full w-full object-cover object-center" />
          <div className="absolute inset-0 bg-red-600/70 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
        </div>
        <div className="relative z-10 flex w-full items-center justify-center p-4 sm:p-6 lg:justify-start lg:p-0">
          <div className="w-full max-w-[440px] bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl px-8 py-10 sm:px-10 sm:py-12 lg:rounded-none lg:h-screen lg:max-w-none lg:w-[42%] xl:w-[40%] lg:flex lg:flex-col lg:justify-center lg:bg-white lg:shadow-none lg:px-14 lg:py-16 overflow-y-auto">
            <div className="mx-auto w-full max-w-[418px]">
              {/* Logo */}
              <div className="mb-8 flex items-center gap-3.5">
                <img src={`${import.meta.env.BASE_URL}logo-tr3.png`} alt="Logo TR3" className="h-12 object-contain shrink-0" />
                <div className="flex flex-col leading-tight">
                  <p className="text-[15px] font-bold text-gray-900 tracking-[-0.45px]" style={{ fontFamily: "'Montserrat', sans-serif" }}>LESA VI · WITEL SURAMADU</p>
                  <p className="text-[10px] font-semibold tracking-[1.5px] uppercase text-red-600" style={{ fontFamily: "'Inter', sans-serif" }}>Monitoring Dashboard</p>
                </div>
              </div>

              {/* Heading */}
              <div className="mb-6 text-center">
                <h1 className="text-[24px] sm:text-[28px] font-bold text-gray-900 tracking-[-0.75px] leading-8 mb-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>Verifikasi Akses</h1>
                <p className="text-sm text-gray-500 tracking-[-0.16px] leading-5">
                  {pendingNama ? <>Hai <strong>{pendingNama}</strong>, </> : null}
                  Masukkan kode 5 digit yang dikirim ke akun Telegram Anda.
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 bg-red-50 border-2 border-red-300 rounded-2xl px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-sm font-semibold leading-snug">{error}</p>
                  </div>
                </div>
              )}

              {/* OTP Input — styled text input, paste + manual typing */}
              <div className="flex justify-center mb-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpLocked || isLoading ? "" : otp}
                  onChange={otpLocked || isLoading ? undefined : (e => {
                    const raw = e.target.value.replace(/\D/g, "").slice(0, 5);
                    setOtp(raw);
                    setError(null);
                    if (raw.length === 5) handleVerify(raw);
                  })}
                  onKeyDown={otpLocked || isLoading ? undefined : (e => {
                    if (e.key === "Enter" && otp.length === 5) handleVerify(otp);
                  })}
                  placeholder={otpLocked || isLoading ? "" : "• • • • •"}
                  disabled={otpLocked || isLoading}
                  readOnly={otpLocked || isLoading}
                  className={
                    otpLocked || isLoading
                      ? "w-full max-w-[280px] text-center text-2xl font-bold tracking-[12px] py-3 px-4 rounded-xl border-2 border-gray-200 bg-gray-100 text-gray-400 outline-none cursor-not-allowed select-none"
                      : "w-full max-w-[280px] text-center text-2xl font-bold tracking-[12px] py-3 px-4 rounded-xl border-2 border-gray-200 bg-gray-50 outline-none focus:border-red-600 focus:ring-4 focus:ring-red-100 transition-all placeholder:text-gray-300"
                  }
                  style={{ fontFamily: "'Inter', sans-serif", color: (otpLocked || isLoading) ? "#9ca3af" : "#101828" }}
                  autoFocus={!(otpLocked || isLoading)}
                />
              </div>
              <p className="text-center text-xs text-gray-500 mb-4" style={{ fontFamily: "'Inter', sans-serif" }}>
                Ketik 5 digit atau <strong>Ctrl+V</strong> paste dari Telegram
              </p>

              {/* Timer */}
              {resendCooldown > 0 || otpExpirySeconds > 0 ? (
                <div className="text-center mb-4">
                  {resendCooldown > 0 ? (
                    <span className="text-xs font-medium text-gray-700">
                      Tunggu <span className="font-bold">{String(Math.floor(resendCooldown / 60)).padStart(2, "0")}:{String(resendCooldown % 60).padStart(2, "0")}</span> sebelum kirim ulang
                    </span>
                  ) : otpExpirySeconds > 0 ? (
                    <span className="text-xs text-gray-700">
                      Kode berlaku{" "}
                      <span className={otpExpirySeconds <= 60 ? "font-semibold text-red-600" : ""}>
                        {String(Math.floor(otpExpirySeconds / 60)).padStart(2, "0")}:{String(otpExpirySeconds % 60).padStart(2, "0")}
                      </span> lagi
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* Verify Button */}
              <div className="relative mb-4">
                <div className="absolute inset-0 rounded-2xl pointer-events-none shadow-sm" />
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={otp.length !== 5 || isLoading || resendCooldown > 0 || otpLocked}
                  className="relative w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-2xl py-[14px] px-4 text-sm font-bold tracking-[-0.16px] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Memverifikasi...</> : "Verifikasi"}
                </button>
              </div>

              {/* Resend */}
              <div className="text-center mb-4">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isLoading || isResending || resendCooldown > 0 || otpLocked}
                  className={`text-sm font-semibold underline transition-colors ${
                    (resendCooldown > 0 || otpLocked) ? "text-gray-400 cursor-not-allowed no-underline" : "text-red-600 hover:text-red-700"
                  }`}
                >
                  {isResending ? "Mengirim..." : "Kirim Ulang Kode"}
                </button>
              </div>

              {/* Back */}
              <button
                type="button"
                onClick={() => { setStep("form"); setOtp(""); setError(null); }}
                className="w-full flex items-center justify-center gap-1.5 bg-white border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.99] text-gray-700 rounded-xl py-[11px] px-4 text-sm font-semibold tracking-[-0.16px] transition-all"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                ← Kembali ke halaman masuk
              </button>

              <p className="mt-8 text-[11px] text-gray-400 text-center tracking-[-0.16px]" style={{ fontFamily: "'Inter', sans-serif" }}>
                © 2026 Large Enterprise Service Area VI Witel Suramadu Telkom Indonesia
              </p>
            </div>
          </div>
          <div className="hidden lg:flex lg:flex-1 relative overflow-hidden self-stretch">
            <img src={`${import.meta.env.BASE_URL}login-bg.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
            <div className="absolute inset-0 bg-red-600/70 mix-blend-multiply" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
          </div>
        </div>
      </div>
    );
  }

  // ── Login form ─────────────────────────────────────────────────────────────
  return (
    <div className="relative flex min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 z-0 bg-white">
        <div className="absolute top-0 bottom-0 right-0 hidden lg:block" style={{ left: "42%" }}>
          <img src={`${import.meta.env.BASE_URL}login-bg.jpg`} alt="" className="h-full w-full object-cover object-center" />
          <div className="absolute inset-0 bg-red-600/70 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
        </div>
        <div className="absolute inset-0 lg:hidden">
          <img src={`${import.meta.env.BASE_URL}login-bg.jpg`} alt="" className="h-full w-full object-cover object-center" />
          <div className="absolute inset-0 bg-red-600/70 mix-blend-multiply" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
        </div>
      </div>

      <div className="relative z-10 flex w-full items-center justify-center p-4 sm:p-6 lg:justify-start lg:p-0">
        <div className="w-full max-w-[440px] bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl px-8 py-10 sm:px-10 sm:py-12 lg:rounded-none lg:h-screen lg:max-w-none lg:w-[42%] xl:w-[40%] lg:flex lg:flex-col lg:items-center lg:justify-center lg:bg-white lg:shadow-none lg:px-14 lg:py-16 overflow-y-auto">
          <div className="w-full max-w-[400px]">
            {/* Logo */}
            <div className="mb-10 flex items-center gap-3.5">
              <img src={`${import.meta.env.BASE_URL}logo-tr3.png`} alt="Logo TR3" className="h-12 sm:h-14 object-contain shrink-0" />
              <div className="flex flex-col leading-tight">
                <p className="text-[15px] sm:text-[18px] font-bold text-gray-900 tracking-[-0.45px]" style={{ fontFamily: "'Montserrat', sans-serif" }}>LESA VI · WITEL SURAMADU</p>
                <p className="text-[10px] sm:text-[11px] font-semibold tracking-[1.5px] uppercase text-red-600" style={{ fontFamily: "'Inter', sans-serif" }}>Monitoring Dashboard</p>
              </div>
            </div>

            {/* Heading */}
            <div className="mb-8">
              <h1 className="text-[26px] sm:text-[30px] font-bold text-gray-900 tracking-[-0.75px] leading-9 mb-1.5" style={{ fontFamily: "'Montserrat', sans-serif" }}>Lihat Performa Anda</h1>
              <p className="text-sm text-gray-500 tracking-[-0.16px] leading-5">
                Masukkan NIK Anda untuk mengakses laporan performa dan pencapaian target penjualan.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-2xl">
                  {error}
                </div>
              )}

              {/* NIK */}
              <div className="flex flex-col gap-[2.5px] pt-[5.5px]">
                <label className="text-[12px] font-semibold text-gray-600 uppercase tracking-[0.6px]" style={{ fontFamily: "'Inter', sans-serif" }}>NIK</label>
                <div className="relative">
                  <CreditCard className="absolute left-[14px] top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    inputMode="numeric"
                    value={nik}
                    onChange={e => { setNik(e.target.value); setError(null); }}
                    placeholder="Masukkan NIK Anda"
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-[14px] pl-[42px] pr-4 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-red-600 focus:ring-4 focus:ring-red-50 transition-all"
                    style={{ fontFamily: "'Inter', sans-serif" }}
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="relative pt-1">
                <div className="absolute inset-0 rounded-2xl pointer-events-none shadow-sm" />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="relative w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-2xl py-[14px] px-4 text-sm font-bold tracking-[-0.16px] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Memverifikasi...</> : "Lihat Dashboard Saya"}
                </button>
              </div>
            </form>

            <p className="mt-10 text-[11px] text-gray-400 text-center tracking-[-0.16px]" style={{ fontFamily: "'Inter', sans-serif" }}>
              © 2026 Large Enterprise Service Area VI Witel Suramadu Telkom Indonesia
            </p>
          </div>
        </div>
        <div className="hidden lg:block lg:flex-1" />
      </div>
    </div>
  );
}
