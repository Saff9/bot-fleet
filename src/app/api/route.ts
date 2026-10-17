import { NextResponse } from "next/server";

/**
 * API index — lists every endpoint so users can discover the API surface.
 * Public (no auth) so it doubles as a sanity-check ping.
 */
export async function GET() {
  return NextResponse.json({
    name: "Bot Fleet API",
    version: "2.0",
    docs: "/api/health, /api/bots, /api/bots/:id, /api/bots/:id/logs (SSE), /api/bots/:id/{start,stop,restart,redeploy}, /api/auth/login, /api/auth/logout, /api/audit",
    auth: "POST /api/auth/login with { password } → signed HTTP-only cookie (30d)",
  });
}
