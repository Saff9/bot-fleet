import type { Bot } from "@prisma/client";
import type { BotDTO } from "@/lib/types";
import { botManager } from "@/lib/bot-manager";
import { decryptEnvVars } from "@/lib/crypto";

/** Convert a DB Bot row to a BotDTO with runtime overlay. */
export function botToDTO(bot: Bot): BotDTO {
  return {
    id: bot.id,
    name: bot.name,
    githubUrl: bot.githubUrl,
    branch: bot.branch,
    startCommand: bot.startCommand,
    installCommand: bot.installCommand,
    // Decrypt env vars on read — they are stored as "enc:v1:..." in DB.
    // For legacy plaintext rows, decryptEnvVars falls back to JSON.parse.
    envVars: decryptEnvVars(bot.envVars),
    status: bot.status as BotDTO["status"],
    pid: bot.pid,
    startedAt: bot.startedAt ? bot.startedAt.toISOString() : null,
    lastExitCode: bot.lastExitCode,
    lastError: bot.lastError,
    restartCount: bot.restartCount,
    autoRestart: bot.autoRestart,
    workDir: bot.workDir,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
    runtime: botManager.getRuntimeState(bot.id),
  };
}
