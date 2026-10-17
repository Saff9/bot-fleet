import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { db } from "@/lib/db";
import { cloneRepo, detectInstallCommand, botWorkDir } from "@/lib/git";
import { decryptEnvVars } from "@/lib/crypto";
import type { Bot, BotStatus, LogLine } from "@/lib/types";

const MAX_LOG_LINES = 2000; // ring buffer size per bot
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_MS = 2000;

interface ManagedBot {
  botId: string;
  child: ChildProcessWithoutNullStreams | null;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  restartCount: number;
  status: BotStatus;
  logs: LogLine[];
  /** backpressure-safe listener set */
  listeners: Set<(line: LogLine) => void>;
  /** prevents infinite restart loops */
  restartTimer: NodeJS.Timeout | null;
}

/**
 * Singleton bot process supervisor.
 * - Spawns child processes for each deployed bot
 * - Streams stdout/stderr into a ring buffer
 * - Notifies SSE subscribers in real time
 * - Auto-restarts on crash with exponential backoff
 *
 * Persisted across Next.js HMR via globalThis.
 */
class BotManager extends EventEmitter {
  private bots = new Map<string, ManagedBot>();
  private booted = false;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Called once on first access: walks every bot in DB and marks any
   * previously-"running" bots as "stopped" (since their child is gone
   * after a server restart). Does NOT auto-start them — user can
   * manually start, which prevents a thundering herd of restarts
   * on a tight-RAM container.
   */
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    try {
      const bots = await db.bot.findMany();
      for (const bot of bots) {
        const m = this.ensureManaged(bot.id);
        m.status = bot.status === "running" ? "stopped" : (bot.status as BotStatus);
        if (bot.lastError) m.lastError = bot.lastError;
        if (bot.lastExitCode !== null) m.lastExitCode = bot.lastExitCode;
        m.restartCount = bot.restartCount;
        this.notifyStatus(bot.id);
        this.pushLog(m, { level: "system", msg: `Recovered after server restart (status: ${m.status})` });
        // If the bot was running before, persist new status to DB
        if (bot.status === "running") {
          await db.bot.update({
            where: { id: bot.id },
            data: { status: "stopped", pid: null, startedAt: null },
          });
        }
      }
      this.emit("booted", bots.length);
    } catch (err) {
      // If DB isn't ready, fail soft — UI will show no bots
      console.error("[BotManager] boot failed:", err);
    }
  }

  /** Emit a status-change event so SSE subscribers can push updates to clients. */
  private notifyStatus(botId: string): void {
    this.emit("status", botId);
  }

  private ensureManaged(botId: string): ManagedBot {
    let m = this.bots.get(botId);
    if (!m) {
      m = {
        botId,
        child: null,
        startedAt: null,
        lastExitCode: null,
        lastError: null,
        restartCount: 0,
        status: "pending",
        logs: [],
        listeners: new Set(),
        restartTimer: null,
      };
      this.bots.set(botId, m);
    }
    return m;
  }

  private pushLog(m: ManagedBot, line: Omit<LogLine, "ts">): void {
    const full: LogLine = { ...line, ts: Date.now() };
    m.logs.push(full);
    if (m.logs.length > MAX_LOG_LINES) {
      m.logs.splice(0, m.logs.length - MAX_LOG_LINES);
    }
    for (const cb of m.listeners) {
      try {
        cb(full);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  /** Public SSE-friendly subscription. Returns an unsubscribe fn. */
  subscribe(botId: string, cb: (line: LogLine) => void): () => void {
    const m = this.ensureManaged(botId);
    m.listeners.add(cb);
    return () => m.listeners.delete(cb);
  }

  getLogs(botId: string): LogLine[] {
    return this.ensureManaged(botId).logs;
  }

  getRuntimeState(botId: string) {
    const m = this.ensureManaged(botId);
    return {
      status: m.status,
      pid: m.child?.pid ?? null,
      startedAt: m.startedAt,
      lastExitCode: m.lastExitCode,
      lastError: m.lastError,
      restartCount: m.restartCount,
      uptimeMs: m.startedAt ? Date.now() - m.startedAt : null,
    };
  }

  /**
   * Full deploy: clone → install → start.
   * Updates DB status at each phase so the UI reflects progress.
   */
  async deploy(botId: string, opts?: { skipClone?: boolean }): Promise<void> {
    const bot = await db.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error("Bot not found");

    const m = this.ensureManaged(botId);
    // kill any existing child first
    this.killChild(m);

    try {
      // 1. Clone
      m.status = "cloning";
      m.lastError = null;
      this.notifyStatus(botId);
      await db.bot.update({
        where: { id: botId },
        data: { status: "cloning", lastError: null },
      });
      this.pushLog(m, { level: "system", msg: `Cloning ${bot.githubUrl} (branch: ${bot.branch})...` });
      const workDir = opts?.skipClone
        ? botWorkDir(botId)
        : await cloneRepo(botId, bot.githubUrl, bot.branch);
      this.pushLog(m, { level: "system", msg: `Cloned to ${workDir}` });

      // 2. Install
      const installCmd =
        bot.installCommand?.trim() || (await detectInstallCommand(workDir)) || "";
      if (installCmd) {
        m.status = "installing";
        this.notifyStatus(botId);
        await db.bot.update({ where: { id: botId }, data: { status: "installing", workDir } });
        this.pushLog(m, { level: "system", msg: `Running install: ${installCmd}` });
        await this.runToCompletion(m, installCmd, workDir, decryptEnvVars(bot.envVars));
        this.pushLog(m, { level: "system", msg: `Install complete` });
      }

      // 3. Start
      m.status = "running";
      m.startedAt = Date.now();
      m.restartCount = 0;
      this.notifyStatus(botId);
      await db.bot.update({
        where: { id: botId },
        data: { status: "running", workDir, startedAt: new Date(m.startedAt), restartCount: 0, lastError: null },
      });
      this.spawnBot(m, bot, workDir);
      this.pushLog(m, { level: "system", msg: `Bot started (pid: ${m.child?.pid})` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      m.status = "error";
      m.lastError = msg;
      this.notifyStatus(botId);
      this.pushLog(m, { level: "system", msg: `Deploy failed: ${msg}` });
      await db.bot.update({
        where: { id: botId },
        data: { status: "error", lastError: msg },
      });
    }
  }

  /** Spawns the bot's startCommand, wires stdout/stderr to the log ring buffer. */
  private spawnBot(m: ManagedBot, bot: Bot, workDir: string): void {
    const env = {
      ...process.env,
      ...decryptEnvVars(bot.envVars),
      // critical so child node processes don't try to bind to our port
      PORT: undefined as unknown as string,
    };

    const child = spawn(bot.startCommand, {
      cwd: workDir,
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    m.child = child;

    const stdoutBuf: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutBuf.push(text);
      // split by lines so each line becomes its own LogLine
      const combined = stdoutBuf.join("");
      const idx = combined.lastIndexOf("\n");
      if (idx >= 0) {
        const lines = combined.slice(0, idx).split("\n");
        stdoutBuf.length = 0;
        stdoutBuf.push(combined.slice(idx + 1));
        for (const line of lines) {
          if (line.length) this.pushLog(m, { level: "stdout", msg: line });
        }
      }
    });

    const stderrBuf: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf.push(text);
      const combined = stderrBuf.join("");
      const idx = combined.lastIndexOf("\n");
      if (idx >= 0) {
        const lines = combined.slice(0, idx).split("\n");
        stderrBuf.length = 0;
        stderrBuf.push(combined.slice(idx + 1));
        for (const line of lines) {
          if (line.length) this.pushLog(m, { level: "stderr", msg: line });
        }
      }
    });

    child.on("error", (err) => {
      this.pushLog(m, { level: "system", msg: `Spawn error: ${err.message}` });
      m.status = "error";
      m.lastError = err.message;
      this.notifyStatus(bot.id);
      void db.bot.update({
        where: { id: bot.id },
        data: { status: "error", lastError: err.message },
      });
    });

    child.on("exit", (code, signal) => {
      m.lastExitCode = code;
      this.pushLog(
        m,
        { level: "system", msg: `Process exited (code: ${code}, signal: ${signal})` }
      );
      m.child = null;
      const wasRunning = m.status === "running";
      m.status = code === 0 ? "stopped" : "error";
      this.notifyStatus(bot.id);

      void db.bot.update({
        where: { id: bot.id },
        data: {
          status: m.status,
          pid: null,
          lastExitCode: code,
          startedAt: null,
          lastError: code === 0 ? null : `Exited with code ${code}`,
        },
      });

      // Auto-restart only if it crashed (non-zero) and was running before
      if (wasRunning && code !== 0 && bot.autoRestart && m.restartCount < MAX_RESTART_ATTEMPTS) {
        m.restartCount += 1;
        const delay = RESTART_BACKOFF_MS * Math.pow(2, m.restartCount - 1);
        this.pushLog(
          m,
          {
            level: "system",
            msg: `Auto-restart in ${delay}ms (attempt ${m.restartCount}/${MAX_RESTART_ATTEMPTS})`,
          }
        );
        if (m.restartTimer) clearTimeout(m.restartTimer);
        m.restartTimer = setTimeout(() => {
          void this.deploy(bot.id, { skipClone: true }).catch(() => {});
        }, delay);
      } else if (m.restartCount >= MAX_RESTART_ATTEMPTS) {
        this.pushLog(m, { level: "system", msg: `Giving up after ${MAX_RESTART_ATTEMPTS} restart attempts` });
      }
    });
  }

  /** Run a command to completion, throwing on non-zero exit. Used for install. */
  private runToCompletion(
    m: ManagedBot,
    command: string,
    workDir: string,
    env: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: workDir,
        env: { ...process.env, ...env },
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const lineify = (buf: string[], chunk: Buffer, level: "stdout" | "stderr") => {
        buf.push(chunk.toString());
        const combined = buf.join("");
        const idx = combined.lastIndexOf("\n");
        if (idx >= 0) {
          const lines = combined.slice(0, idx).split("\n");
          buf.length = 0;
          buf.push(combined.slice(idx + 1));
          for (const line of lines) if (line.length) this.pushLog(m, { level, msg: line });
        }
      };
      const out: string[] = [];
      const err: string[] = [];
      child.stdout.on("data", (c: Buffer) => lineify(out, c, "stdout"));
      child.stderr.on("data", (c: Buffer) => lineify(err, c, "stderr"));

      child.on("error", reject);
      child.on("exit", (code) => {
        // flush remaining buffered text
        if (out.length) this.pushLog(m, { level: "stdout", msg: out.join("") });
        if (err.length) this.pushLog(m, { level: "stderr", msg: err.join("") });
        if (code === 0) resolve();
        else reject(new Error(`Install command exited with code ${code}`));
      });
    });
  }

  /** Force-kill the bot's child process. */
  stop(botId: string): void {
    const m = this.ensureManaged(botId);
    this.killChild(m);
    m.status = "stopped";
    m.startedAt = null;
    this.notifyStatus(botId);
    this.pushLog(m, { level: "system", msg: `Stopped by user` });
    void db.bot.update({
      where: { id: botId },
      data: { status: "stopped", pid: null, startedAt: null },
    });
  }

  /** Stop + start (without re-cloning). */
  async restart(botId: string): Promise<void> {
    const bot = await db.bot.findUnique({ where: { id: botId } });
    if (!bot) throw new Error("Bot not found");
    const m = this.ensureManaged(botId);
    this.killChild(m);
    m.restartCount = 0;
    await this.deploy(botId, { skipClone: true });
  }

  /** Full re-clone + redeploy. */
  async redeploy(botId: string): Promise<void> {
    await this.deploy(botId, { skipClone: false });
  }

  private killChild(m: ManagedBot): void {
    if (m.restartTimer) {
      clearTimeout(m.restartTimer);
      m.restartTimer = null;
    }
    if (m.child && m.child.pid) {
      try {
        // try graceful SIGTERM first, then SIGKILL after 2s
        process.kill(m.child.pid, "SIGTERM");
        const pid = m.child.pid;
        setTimeout(() => {
          try {
            process.kill(pid!, "SIGKILL");
          } catch {
            /* already dead */
          }
        }, 2000);
      } catch {
        /* already dead */
      }
    }
    m.child = null;
  }

  /** Snapshot of all bots' runtime states for the dashboard. */
  getAllRuntimeStates() {
    const out: Record<string, ReturnType<BotManager["getRuntimeState"]>> = {};
    for (const [id] of this.bots) {
      out[id] = this.getRuntimeState(id);
    }
    return out;
  }
}

// Persist across Next.js HMR
const globalForBots = globalThis as unknown as { __botManager?: BotManager };

export const botManager: BotManager =
  globalForBots.__botManager ?? new BotManager();

if (!globalForBots.__botManager) {
  globalForBots.__botManager = botManager;
  // Kick off boot asynchronously — don't block module load
  void botManager.boot();
}
