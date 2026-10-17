import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BotStatus } from "@/lib/types";

const STATUS_CONFIG: Record<
  BotStatus,
  { label: string; className: string; dot: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  cloning: {
    label: "Cloning",
    className: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300",
    dot: "bg-sky-500 animate-pulse",
  },
  installing: {
    label: "Installing",
    className: "bg-violet-500/10 text-violet-700 border-violet-500/30 dark:text-violet-300",
    dot: "bg-violet-500 animate-pulse",
  },
  running: {
    label: "Running",
    className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  stopped: {
    label: "Stopped",
    className: "bg-zinc-500/10 text-zinc-700 border-zinc-500/30 dark:text-zinc-300",
    dot: "bg-zinc-500",
  },
  error: {
    label: "Error",
    className: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

export function StatusBadge({ status }: { status: BotStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge variant="outline" className={cn("font-medium gap-1.5", cfg.className)}>
      <span className={cn("size-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </Badge>
  );
}
