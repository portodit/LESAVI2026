/**
 * Dynamic public base URL tracker.
 *
 * The Telegram bot sends URLs to users via messages. These URLs must match
 * the host the user actually uses to access the dashboard/API.
 *
 * Since the server binds to 0.0.0.0 and the public IP can change (e.g.
 * NordLynx VPN, different Wi-Fi), we dynamically detect the public URL
 * from incoming HTTP request headers (x-forwarded-host / host).
 *
 * The poller uses this instead of process.env so URLs in Telegram messages
 * always match the host the user is browsing from.
 *
 * IMPORTANT: Only trust x-forwarded-host (set by reverse proxy/nginx) for
 * public URL detection. Raw "host" header comes from internal requests too
 * (e.g. bot calling http://localhost:8080 internally) and would override
 * the correct public URL with "localhost".
 */

let _currentPublicBaseUrl: string = process.env["PUBLIC_BASE_URL"] || "http://localhost:8000";

export function getPublicBaseUrl(): string {
  return _currentPublicBaseUrl;
}

export function setPublicBaseUrl(url: string): void {
  _currentPublicBaseUrl = url;
}

export function getPublicBaseUrlSafe(): string {
  // Always prefer env var — more reliable than dynamic detection
  return process.env["PUBLIC_BASE_URL"] || _currentPublicBaseUrl;
}

/**
 * Normalize a base URL to HTTPS for use in Telegram inline keyboard buttons.
 * Telegram's Bot API rejects `http://` URLs in `url:` button fields with
 * "Wrong HTTP URL" — only https is allowed. For text-body links this isn't
 * enforced, but for safety we also normalize there when the caller wants.
 */
export function toHttpsUrl(url: string): string {
  return url.replace(/^http:\/\//, "https://");
}

/**
 * True if the URL points to a private/local network host (localhost, 127.x,
 * 10.x, 192.168.x, 172.16-31.x). Telegram rejects such URLs in inline
 * keyboard buttons with "Wrong HTTP URL" because it cannot validate them.
 * Use this to decide whether to attach an inline button or fall back to
 * a plain text link in the message body.
 */
export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "0.0.0.0") return true;
    if (h === "127.0.0.1" || /^127\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
    if (h.endsWith(".local") || h.endsWith(".internal")) return true;
    return false;
  } catch {
    return true; // unparseable → treat as local to be safe
  }
}
