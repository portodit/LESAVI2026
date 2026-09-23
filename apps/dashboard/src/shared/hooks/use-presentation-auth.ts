const STORAGE_KEY = "presentation_auth_v1";
const EXPIRY_DAYS = 1; // Token is server-validated; localStorage is just a cache for 1 day

export interface PresentationSession {
  nik: string;
  namaAm: string;
  role?: string;
  expires: string;
  presentationToken: string;
}

export function getPresentationSession(): PresentationSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session: PresentationSession = JSON.parse(raw);
    if (new Date(session.expires) < new Date()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function storePresentationSession(nik: string, namaAm: string, presentationToken: string, role?: string): void {
  const expires = new Date();
  expires.setDate(expires.getDate() + EXPIRY_DAYS);
  const session: PresentationSession = { nik, namaAm, role, expires: expires.toISOString(), presentationToken };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearPresentationSession(): void {
  const session = getPresentationSession();
  if (session?.presentationToken) {
    // Fire-and-forget: delete token from DB then clear local
    fetch("/api/auth/presentation/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ presentationToken: session.presentationToken }),
    }).finally(() => localStorage.removeItem(STORAGE_KEY));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
