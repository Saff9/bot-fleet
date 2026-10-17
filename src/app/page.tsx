"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertOctagon,
  Boxes,
  Cpu,
  HardDrive,
  Pause,
  Rocket,
  Search,
} from "lucide-react";

import { StatCard } from "@/components/bot-fleet/stat-card";
import { BotCard } from "@/components/bot-fleet/bot-card";
import { AddBotDialog } from "@/components/bot-fleet/add-bot-dialog";
import { AppHeader } from "@/components/bot-fleet/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BotDTO, BotStatus } from "@/lib/types";

interface BotsResponse {
  bots: BotDTO[];
}

async function fetchBots(): Promise<BotDTO[]> {
  const res = await fetch("/api/bots");
  if (!res.ok) throw new Error("Failed to load bots");
  const data = (await res.json()) as BotsResponse;
  return data.bots;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BotStatus | "all">("all");

  const query = useQuery({
    queryKey: ["bots"],
    queryFn: fetchBots,
    refetchInterval: 5000, // safety-net poll every 5s (SSE drives instant updates)
  });

  // Live SSE stream: triggers instant refetch on every status change
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/bots/stream");
      es.onmessage = () => {
        // any message = a status changed somewhere → refetch now
        void query.refetch();
      };
      es.onerror = () => {
        // browser auto-reconnects; nothing to do here
      };
    } catch {
      // SSE not supported — polling is enough
    }
    return () => {
      es?.close();
    };
  }, [query]);

  const bots = query.data ?? [];

  const counts = useMemo(() => {
    const c: Record<BotStatus, number> = {
      pending: 0,
      cloning: 0,
      installing: 0,
      running: 0,
      stopped: 0,
      error: 0,
    };
    for (const b of bots) {
      const s = (b.runtime?.status ?? b.status) as BotStatus;
      c[s] += 1;
    }
    return c;
  }, [bots]);

  const filtered = useMemo(() => {
    return bots.filter((b) => {
      const s = (b.runtime?.status ?? b.status) as BotStatus;
      const matchesSearch =
        !search ||
        b.name.toLowerCase().includes(search.toLowerCase()) ||
        b.githubUrl.toLowerCase().includes(search.toLowerCase()) ||
        b.startCommand.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === "all" || s === filter;
      return matchesSearch && matchesFilter;
    });
  }, [bots, search, filter]);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Stats grid */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Total bots"
            value={bots.length}
            icon={Boxes}
            accent="bg-primary/10 text-primary"
          />
          <StatCard
            label="Running"
            value={counts.running}
            icon={Activity}
            accent="bg-emerald-500/10 text-emerald-600"
          />
          <StatCard
            label="Busy"
            value={counts.cloning + counts.installing}
            icon={Cpu}
            accent="bg-sky-500/10 text-sky-600"
          />
          <StatCard
            label="Stopped"
            value={counts.stopped}
            icon={Pause}
            accent="bg-zinc-500/10 text-zinc-600"
          />
          <StatCard
            label="Errors"
            value={counts.error}
            icon={AlertOctagon}
            accent="bg-rose-500/10 text-rose-600"
          />
          <HealthStat />
        </section>

        {/* Toolbar */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex items-center gap-2 flex-1 max-w-md relative">
            <Search className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, repo, or command..."
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            {(Object.keys(counts) as BotStatus[]).map((s) =>
              counts[s] > 0 ? (
                <FilterChip
                  key={s}
                  label={s}
                  active={filter === s}
                  onClick={() => setFilter(s)}
                />
              ) : null
            )}
            <AddBotDialog onCreated={() => query.refetch()} />
          </div>
        </section>

        {/* Bot grid */}
        {bots.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            No bots match your filters.
          </div>
        ) : (
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((bot) => (
              <BotCard key={bot.id} bot={bot} onMutated={() => query.refetch()} />
            ))}
          </section>
        )}
      </main>

      <Footer counts={counts} total={bots.length} />
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "h-8 px-3 rounded-full text-xs font-medium capitalize border transition-colors " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:bg-muted")
      }
    >
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
        <Rocket className="size-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">Deploy your first bot</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        Paste a GitHub URL, set a start command, and we&apos;ll clone, install and run
        your bot inside this Railway service. Add as many as your RAM allows.
      </p>
      <div className="mt-5">
        <AddBotDialog />
      </div>
    </div>
  );
}

function HealthStat() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("health");
      return res.json() as Promise<{
        rss: number;
        heapUsed: number;
        loadavg: number[];
        cpus: number;
      }>;
    },
    refetchInterval: 5000,
  });

  return (
    <StatCard
      label="Container RAM"
      value={data ? fmtBytes(data.rss) : "—"}
      icon={HardDrive}
      accent="bg-violet-500/10 text-violet-600"
      hint={data ? `${data.cpus} CPU · load ${data.loadavg[0]?.toFixed(2)}` : undefined}
    />
  );
}

function Footer({
  counts,
  total,
}: {
  counts: Record<BotStatus, number>;
  total: number;
}) {
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
          <span>
            <strong className="text-foreground">{total}</strong> bots ·{" "}
            <strong className="text-emerald-600">{counts.running}</strong> running
            {counts.error > 0 && (
              <>
                {" "}· <strong className="text-rose-600">{counts.error}</strong> errors
              </>
            )}
          </span>
        </div>
        <p className="text-center">
          Bot Fleet · self-hosted mini PaaS · runs as a single service on Railway / Render / Fly
        </p>
      </div>
    </footer>
  );
}
