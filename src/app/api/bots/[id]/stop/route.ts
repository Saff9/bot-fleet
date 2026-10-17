import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botManager } from "@/lib/bot-manager";
import { recordAudit, readSessionFromRequest, isAuthEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  botManager.stop(id);
  await recordAudit(db.auditEvent, "bot.stop", "info", `Stopped bot "${bot.name}"`, bot.id);
  return NextResponse.json({ ok: true });
}
