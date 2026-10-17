"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  Cpu,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "./status-badge";
import type { BotDTO } from "@/lib/types";

interface BotCardProps {
  bot: BotDTO;
  onMutated?: () => void;
}

function fmtUptime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function BotCard({ bot, onMutated }: BotCardProps) {
  const [busy, setBusy] = useState<"start" | "stop" | "restart" | "redeploy" | "delete" | null>(null);
  const router = useRouter();

  const uptime = useMemo(() => {
    if (!bot.runtime?.startedAt) return null;
    return Date.now() - bot.runtime.startedAt;
  }, [bot.runtime?.startedAt]);

  const isRunning = bot.runtime?.status === "running" || bot.status === "running";
  const isBusy = ["cloning", "installing"].includes(bot.runtime?.status ?? bot.status);

  async function act(kind: "start" | "stop" | "restart" | "redeploy") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/bots/${bot.id}/${kind}`, { method: "POST" });
      if (!res.ok) throw new Error(`${kind} failed`);
      toast.success(`${kind} → ${bot.name}`);
      router.refresh();
      onMutated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function del() {
    setBusy("delete");
    try {
      const res = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      toast.success(`Deleted ${bot.name}`);
      router.refresh();
      onMutated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="overflow-hidden transition-shadow hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/bots/${bot.id}`}
                  className="font-semibold truncate hover:underline"
                  title={bot.name}
                >
                  {bot.name}
                </Link>
                <StatusBadge status={(bot.runtime?.status ?? bot.status) as BotDTO["status"]} />
              </div>
              <a
                href={bot.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate"
              >
                <ExternalLink className="size-3 shrink-0" />
                <span className="truncate">{repoSlug(bot.githubUrl)}</span>
                <span className="inline-flex items-center gap-0.5">
                  <GitBranch className="size-3" />
                  {bot.branch}
                </span>
              </a>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 shrink-0">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => act("start")} disabled={isRunning || isBusy}>
                  <Play className="size-4" /> Start
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => act("stop")} disabled={!isRunning || isBusy}>
                  <Square className="size-4" /> Stop
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => act("restart")} disabled={isBusy}>
                  <RefreshCw className="size-4" /> Restart
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => act("redeploy")} disabled={isBusy}>
                  <RefreshCw className="size-4" /> Redeploy (re-clone)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem
                      onSelect={(e) => e.preventDefault()}
                      className="text-rose-600 focus:text-rose-700"
                    >
                      <Trash2 className="size-4" /> Delete
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will stop the bot (if running), remove its working directory and delete its config. This cannot be undone.
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Field label="PID" value={bot.runtime?.pid?.toString() ?? bot.pid?.toString() ?? "—"} />
            <Field label="Uptime" value={fmtUptime(uptime ?? null)} />
            <Field label="Restarts" value={(bot.runtime?.restartCount ?? bot.restartCount).toString()} />
            <Field
              label="Created"
              value={formatDistanceToNow(new Date(bot.createdAt), { addSuffix: true })}
            />
          </div>

          {bot.runtime?.lastError || bot.lastError ? (
            <div className="flex items-start gap-2 rounded-md bg-rose-500/10 border border-rose-500/30 p-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-words line-clamp-2">
                {bot.runtime?.lastError ?? bot.lastError}
              </span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cpu className="size-3" />
            <code className="truncate" title={bot.startCommand}>{bot.startCommand}</code>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant={isRunning ? "outline" : "default"}
              className="flex-1"
              disabled={busy !== null || isBusy || isRunning}
              onClick={() => act("start")}
            >
              <Play className="size-3.5" /> Start
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy !== null || isBusy || !isRunning}
              onClick={() => act("stop")}
            >
              <Square className="size-3.5" /> Stop
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy !== null || isBusy}
              onClick={() => act("redeploy")}
            >
              <RefreshCw className={busy === "redeploy" ? "size-3.5 animate-spin" : "size-3.5"} />
              Redeploy
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

function repoSlug(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\.git$/, "").replace(/^\//, "");
  } catch {
    return url;
  }
}
