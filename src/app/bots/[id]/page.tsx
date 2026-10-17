"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Cpu,
  ExternalLink,
  GitBranch,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/bot-fleet/status-badge";
import { LogViewer } from "@/components/bot-fleet/log-viewer";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { BotDTO } from "@/lib/types";

export default function BotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const query = useQuery({
    queryKey: ["bot", id],
    queryFn: async () => {
      const res = await fetch(`/api/bots/${id}`);
      if (!res.ok) throw new Error("Not found");
      return (await res.json()) as BotDTO;
    },
    refetchInterval: 3000,
  });

  const [busy, setBusy] = useState<"start" | "stop" | "restart" | "redeploy" | "delete" | null>(null);

  const bot = query.data;

  async function act(kind: "start" | "stop" | "restart" | "redeploy") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/bots/${id}/${kind}`, { method: "POST" });
      if (!res.ok) throw new Error(`${kind} failed`);
      toast.success(`${kind} succeeded`);
      await query.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/bots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      toast.success("Deleted");
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!bot) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Bot not found.</p>
        <Link href="/">
          <Button variant="outline">← Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const status = (bot.runtime?.status ?? bot.status) as BotDTO["status"];
  const isRunning = status === "running";
  const isBusy = ["cloning", "installing"].includes(status);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/">
              <Button variant="ghost" size="icon" className="size-8">
                <ArrowLeft className="size-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-semibold truncate" title={bot.name}>
                  {bot.name}
                </h1>
                <StatusBadge status={status} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              disabled={busy !== null || isBusy || isRunning}
              onClick={() => act("start")}
            >
              <Play className="size-3.5" /> Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || isBusy || !isRunning}
              onClick={() => act("stop")}
            >
              <Square className="size-3.5" /> Stop
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || isBusy}
              onClick={() => act("restart")}
            >
              <RefreshCw className={busy === "restart" ? "size-3.5 animate-spin" : "size-3.5"} />
              <span className="hidden sm:inline">Restart</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || isBusy}
              onClick={() => act("redeploy")}
            >
              <RefreshCw className={busy === "redeploy" ? "size-3.5 animate-spin" : "size-3.5"} />
              <span className="hidden sm:inline">Redeploy</span>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700">
                  <Trash2 className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Stops the bot, removes its working directory and deletes its config. Cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={del}
                    className="bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={async () => {
                try {
                  await fetch("/api/auth/logout", { method: "POST" });
                  toast.success("Signed out");
                  router.push("/login");
                  router.refresh();
                } catch {
                  toast.error("Failed to sign out");
                }
              }}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-7rem)]">
          {/* Left: info panel */}
          <Card className="lg:col-span-1 overflow-hidden flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings className="size-4" /> Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm overflow-y-auto">
              <Field label="Repository">
                <a
                  href={bot.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1 break-all"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  {bot.githubUrl}
                </a>
              </Field>
              <Field label="Branch">
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="size-3" />
                  {bot.branch}
                </span>
              </Field>
              <Field label="Install command">
                <code className="block rounded bg-muted px-2 py-1 text-xs">
                  {bot.installCommand || "(auto-detected)"}
                </code>
              </Field>
              <Field label="Start command">
                <code className="block rounded bg-muted px-2 py-1 text-xs break-all">
                  {bot.startCommand}
                </code>
              </Field>
              <Field label="Working dir">
                <code className="block rounded bg-muted px-2 py-1 text-xs break-all">
                  {bot.workDir ?? "(not deployed yet)"}
                </code>
              </Field>
              <Field label="Auto-restart">
                <span>{bot.autoRestart ? "Yes (up to 5 attempts)" : "No"}</span>
              </Field>

              <Field label="Env vars">
                {Object.keys(bot.envVars).length === 0 ? (
                  <span className="text-muted-foreground text-xs">(none)</span>
                ) : (
                  <ul className="space-y-1">
                    {Object.keys(bot.envVars).map((k) => (
                      <li
                        key={k}
                        className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1 text-xs"
                      >
                        <span className="font-mono">{k}</span>
                        <span className="font-mono text-muted-foreground">
                          {"•".repeat(Math.min(10, bot.envVars[k].length))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              <hr className="border-border" />

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="PID" value={bot.runtime?.pid?.toString() ?? "—"} />
                <Stat
                  label="Restarts"
                  value={(bot.runtime?.restartCount ?? bot.restartCount).toString()}
                />
                <Stat
                  label="Exit code"
                  value={bot.runtime?.lastExitCode?.toString() ?? bot.lastExitCode?.toString() ?? "—"}
                />
                <Stat
                  label="Created"
                  value={formatDistanceToNow(new Date(bot.createdAt), { addSuffix: true })}
                />
              </div>

              {(bot.runtime?.lastError || bot.lastError) && (
                <Field label="Last error">
                  <div className="rounded bg-rose-500/10 border border-rose-500/30 p-2 text-xs text-rose-700 dark:text-rose-300 break-words">
                    {bot.runtime?.lastError ?? bot.lastError}
                  </div>
                </Field>
              )}
            </CardContent>
          </Card>

          {/* Right: log viewer */}
          <Card className="lg:col-span-2 overflow-hidden flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="size-4" /> Live logs
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
              <LogViewer botId={id} className="h-full min-h-0" />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}
