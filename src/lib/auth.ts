import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

/**
 * Stateless session system: signed HTTP-only cookies.
 *
 * Cookie value: `<sessionId>.<hmac>` where hmac = HMAC-SHA256(sessionId, secret)
 * The session ID encodes: `<userId>:<expiresAt>` (base64url).
 *
 * Why stateless: no DB lookups per request, no session table to manage.
 * Why HMAC: tamper-proof. Forging a cookie requires the secret.
 *
 * The secret comes from BOT_FLEET_SESSION_SECRET env var. If missing,
 * one is auto-generated (and lost on restart, invalidating all sessions —
 * which is the safest default for a dev environment).
 *
 * Auth flow:
 *   1. User POSTs {password} to /api/auth/login
 *   2. We verify against BOT_FLEET_ADMIN_PASSWORD (constant-time)
 *   3. We set a signed HTTP-only cookie (30 day expiry)
 *   4. Middleware reads the cookie on every protected route
 *
 * Rate limiting: in-memory token bucket per IP. 60/min for unauth,
 * 300/min for auth. Resets every minute.
 */

const COOKIE_NAME = "botfleet_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cachedSecret: string | null = null;

function getSecret(): string {
  if (cachedSecret) return cachedSecret;
  const env = process.env.BOT_FLEET_SESSION_SECRET;
  if (env) {
    cachedSecret = env;
    return env;
  }
  // Auto-generate (per-process — sessions won't survive restarts)
  const generated = randomBytes(32).toString("hex");
  cachedSecret = generated;
  return generated;
}

function getAdminPassword(): string | null {
  return process.env.BOT_FLEET_ADMIN_PASSWORD ?? null;
}

interface SessionPayload {
  uid: string;
  exp: number;
}

function encodePayload(p: SessionPayload): string {
  const json = JSON.stringify(p);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodePayload(s: string): SessionPayload | null {
  try {
    const json = Buffer.from(s, "base64url").toString("utf8");
    const p = JSON.parse(json) as SessionPayload;
    if (typeof p?.uid !== "string" || typeof p?.exp !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

function hmac(payload: string): string {
  return createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
}

export interface VerifiedSession {
  uid: string;
  exp: number;
}

/** Verify a session cookie value. Returns null if invalid/expired. */
export function verifySession(cookieValue: string | undefined | null): VerifiedSession | null {
  if (!cookieValue) return null;
  const dotIdx = cookieValue.lastIndexOf(".");
  if (dotIdx < 0) return null;
  const payload = cookieValue.slice(0, dotIdx);
  const signature = cookieValue.slice(dotIdx + 1);

  // Constant-time compare on the signature
  const expected = hmac(payload);
  if (!safeEqual(signature, expected)) return null;

  const decoded = decodePayload(payload);
  if (!decoded) return null;
  if (Date.now() > decoded.exp) return null;

  return decoded;
}

/** Build the cookie value + cookie attributes for a freshly-authed session. */
export function createSessionCookie(): { value: string; attributes: string } {
  const uid = "admin";
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = encodePayload({ uid, exp });
  const signature = hmac(payload);
  const value = `${payload}.${signature}`;

  const attrs = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return { value, attributes: attrs };
}

export function clearCookieAttributes(): string {
  return ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"].join("; ");
}

export const COOKIE_NAME_OUT = COOKIE_NAME;

/** Verify admin password (constant-time). Returns true on match. */
export function verifyAdminPassword(submitted: string): boolean {
  const expected = getAdminPassword();
  if (!expected) return false;
  return safeEqual(submitted, expected);
}

/** Returns true if auth is enabled (i.e. a password is configured). */
export function isAuthEnabled(): boolean {
  return !!getAdminPassword();
}

/** Read session from a request's cookie header. */
export function readSessionFromRequest(req: Request): VerifiedSession | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.slice(`${COOKIE_NAME}=`.length);
  return verifySession(value);
}

// ─── Rate limiter ────────────────────────────────────────────────────────────

interface RateBucket {
  tokens: number;
  last: number;
}

const RATE_WINDOW_MS = 60_000; // 1 min
const RATE_UNAUTH = 60; // req/min unauthenticated
const RATE_AUTH = 300; // req/min authenticated
const RATE_LOGIN = 10; // req/min for /api/auth/login (brute-force protection)

const buckets = new Map<string, RateBucket>();

function takeToken(ip: string, capacity: number): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b) {
    buckets.set(ip, { tokens: capacity - 1, last: now });
    return true;
  }
  // Refill based on elapsed time
  const elapsed = now - b.last;
  const refill = (elapsed / RATE_WINDOW_MS) * capacity;
  b.tokens = Math.min(capacity, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// Periodic cleanup every 5 min to avoid memory bloat from one-off IPs
setInterval(() => {
  const cutoff = Date.now() - 5 * RATE_WINDOW_MS;
  for (const [ip, b] of buckets) {
    if (b.last < cutoff) buckets.delete(ip);
  }
}, 5 * RATE_WINDOW_MS).unref?.();

export function rateLimitOk(ip: string, kind: "auth" | "unauth"): boolean {
  if (kind === "auth") return takeToken(ip, RATE_AUTH);
  if (kind === "unauth") return takeToken(ip, RATE_UNAUTH);
  return takeToken(ip, RATE_LOGIN);
}

export function loginRateLimitOk(ip: string): boolean {
  return takeToken(ip, RATE_LOGIN);
}

/** Extract client IP from a request (handles proxies). */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export type AuditLevel = "info" | "warn" | "error";
export type AuditEvent =
  | "login.success"
  | "login.failed"
  | "logout"
  | "bot.create"
  | "bot.update"
  | "bot.delete"
  | "bot.start"
  | "bot.stop"
  | "bot.restart"
  | "bot.redeploy"
  | "rate_limit.exceeded";

export async function recordAudit(
  db: import("@/lib/db").PrismaClient["auditEvent"],
  event: AuditEvent,
  level: AuditLevel,
  message: string,
  botId?: string
): Promise<void> {
  try {
    await db.create({
      data: { event, level, message, botId: botId ?? null },
    });
  } catch {
    // best-effort: never fail the request because of audit logging
  }
}

// Re-export for the middleware's cookie-name needs
void timingSafeEqual; // keep import for tree-shaking clarity
