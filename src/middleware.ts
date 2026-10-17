import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware: protects every privileged route when auth is enabled.
 *
 * Runs on the edge runtime by default, so we use the Web Crypto API
 * (`crypto.subtle`) instead of node:crypto for HMAC-SHA256 verification.
 * We deliberately avoid importing @/lib/auth (which uses node:crypto)
 * to keep this edge-safe.
 *
 * Defense-in-depth: API routes re-verify the session via @/lib/auth
 * (which uses node:crypto on the Node.js runtime).
 */

const SESSION_COOKIE_NAME = "botfleet_session";
const encoder = new TextEncoder();

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
]);

function getSecret(): string {
  return process.env.BOT_FLEET_SESSION_SECRET ?? "";
}

function isAuthEnabled(): boolean {
  return !!process.env.BOT_FLEET_ADMIN_PASSWORD;
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/static/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/logo.svg") return true;
  return false;
}

/** base64url → Uint8Array */
function b64urlDecode(s: string): Uint8Array {
  // polyfill for atob in edge runtime
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Verify signed cookie using Web Crypto API (HMAC-SHA256). */
async function verifyCookie(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const secret = getSecret();
  if (!secret) return false;
  const dotIdx = cookieValue.lastIndexOf(".");
  if (dotIdx < 0) return false;
  const payload = cookieValue.slice(0, dotIdx);
  const signature = cookieValue.slice(dotIdx + 1);
  let sigBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(signature);
  } catch {
    return false;
  }
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const payloadBytes = encoder.encode(payload);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as unknown as BufferSource,
    payloadBytes as unknown as BufferSource
  );
  if (!ok) return false;
  // Check expiry embedded in payload
  try {
    const json = new TextDecoder().decode(b64urlDecode(payload));
    const parsed = JSON.parse(json) as { exp?: number };
    if (typeof parsed.exp !== "number") return false;
    if (Date.now() > parsed.exp) return false;
    return true;
  } catch {
    return false;
  }
}

// In-memory token-bucket rate limiter
const buckets = new Map<string, { tokens: number; last: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_UNAUTH = 60;
const RATE_AUTH = 300;

function rateLimitOk(ip: string, authed: boolean): boolean {
  const cap = authed ? RATE_AUTH : RATE_UNAUTH;
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b) {
    buckets.set(ip, { tokens: cap - 1, last: now });
    return true;
  }
  const elapsed = now - b.last;
  b.tokens = Math.min(cap, b.tokens + (elapsed / RATE_WINDOW_MS) * cap);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// setInterval isn't available in edge runtime; instead we lazy-clean
// on every rate-limit check (cheap because the Map is small).
function gcBuckets(): void {
  const cutoff = Date.now() - 5 * RATE_WINDOW_MS;
  for (const [ip, b] of buckets) {
    if (b.last < cutoff) buckets.delete(ip);
  }
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = getClientIp(req);

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await verifyCookie(cookie);
  gcBuckets();

  if (!rateLimitOk(ip, authed)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again in a minute." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    return NextResponse.redirect(new URL("/login?reason=rate_limit", req.url));
  }

  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
