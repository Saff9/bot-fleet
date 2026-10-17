import { NextResponse } from "next/server";
import { verifyAdminPassword, createSessionCookie, loginRateLimitOk, getClientIp, recordAudit } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);

  // Hard rate-limit on login attempts: 10 per minute per IP
  if (!loginRateLimitOk(ip)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    await recordAudit(db.auditEvent, "login.failed", "warn", `Failed login from ${ip}`);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const { value, attributes } = createSessionCookie();
  await recordAudit(db.auditEvent, "login.success", "info", `Login from ${ip}`);

  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", `botfleet_session=${value}; ${attributes}`);
  return res;
}
