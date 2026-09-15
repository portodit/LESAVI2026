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
