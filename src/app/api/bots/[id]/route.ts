import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botManager } from "@/lib/bot-manager";
import { botToDTO } from "@/lib/dto";
import { removeWorkDir } from "@/lib/git";
import { encryptEnvVars } from "@/lib/crypto";
import { recordAudit, readSessionFromRequest, isAuthEnabled } from "@/lib/auth";
import type { UpdateBotInput } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(botToDTO(bot));
}

export async function PATCH(req: Request, { params }: Params) {
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as UpdateBotInput;
  const updated = await db.bot.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.branch !== undefined ? { branch: body.branch.trim() } : {}),
      ...(body.startCommand !== undefined ? { startCommand: body.startCommand.trim() } : {}),
      ...(body.installCommand !== undefined ? { installCommand: body.installCommand?.trim() || null } : {}),
      // Re-encrypt env vars whenever they're updated
      ...(body.envVars !== undefined ? { envVars: encryptEnvVars(body.envVars) } : {}),
      ...(body.autoRestart !== undefined ? { autoRestart: body.autoRestart } : {}),
    },
  });
  await recordAudit(db.auditEvent, "bot.update", "info", `Updated bot "${updated.name}"`, updated.id);
  return NextResponse.json(botToDTO(updated));
}

export async function DELETE(req: Request, { params }: Params) {
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot) return NextResponse.json({ error: "Not found" }, { status: 404 });

  botManager.stop(id);
  await db.bot.delete({ where: { id } });
  await removeWorkDir(id).catch(() => {});
  await recordAudit(db.auditEvent, "bot.delete", "warn", `Deleted bot "${bot.name}"`, bot.id);
  return NextResponse.json({ ok: true });
}
