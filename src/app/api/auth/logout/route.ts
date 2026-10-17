import { NextResponse } from "next/server";
import { clearCookieAttributes, recordAudit } from "@/lib/auth";
import { db } from "@/lib/db";
import { readSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = readSessionFromRequest(req);
  if (session) {
    await recordAudit(db.auditEvent, "logout", "info", `Logout (uid=${session.uid})`);
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", `botfleet_session=; ${clearCookieAttributes()}`);
  return res;
}
