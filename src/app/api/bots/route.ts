import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botManager } from "@/lib/bot-manager";
import { botToDTO } from "@/lib/dto";
import { parseGithubUrl } from "@/lib/git";
import { encryptEnvVars } from "@/lib/crypto";
import { recordAudit, readSessionFromRequest, isAuthEnabled } from "@/lib/auth";
import type { CreateBotInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Note: middleware already gates auth — this is defense-in-depth
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const bots = await db.bot.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    bots: bots.map(botToDTO),
    runtime: botManager.getAllRuntimeStates(),
  });
}

export async function POST(req: Request) {
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBotInput;
  try {
    body = (await req.json()) as CreateBotInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!body.githubUrl?.trim()) return NextResponse.json({ error: "GitHub URL is required" }, { status: 400 });
  if (!body.startCommand?.trim()) return NextResponse.json({ error: "Start command is required" }, { status: 400 });

  let parsed;
  try {
    parsed = parseGithubUrl(body.githubUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid GitHub URL" },
      { status: 400 }
    );
  }

  const branch = body.branch?.trim() || parsed.branch || "main";

  // Encrypt env vars at rest — AES-256-GCM with scrypt-derived key
  const envVarsCipher = encryptEnvVars(body.envVars ?? {});

  const bot = await db.bot.create({
    data: {
      name: body.name.trim(),
      githubUrl: body.githubUrl.trim(),
      branch,
      startCommand: body.startCommand.trim(),
      installCommand: body.installCommand?.trim() || null,
      envVars: envVarsCipher,
      autoRestart: body.autoRestart ?? true,
      status: "pending",
    },
  });

  await recordAudit(db.auditEvent, "bot.create", "info", `Created bot "${bot.name}" (${bot.githubUrl})`, bot.id);

  // kick off deploy in background so the UI shows progress
  void botManager.deploy(bot.id).catch((err) => {
    console.error(`Background deploy failed for ${bot.id}:`, err);
  });

  return NextResponse.json(botToDTO(bot), { status: 201 });
}
