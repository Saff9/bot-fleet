"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/lib/types";

interface LogViewerProps {
  botId: string;
  className?: string;
}

/**
 * Live log viewer: opens an SSE connection to /api/bots/[id]/logs,
 * appends new lines, auto-scrolls to bottom (unless paused).
 */
export function LogViewer({ botId, className }: LogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const linesRef = useRef<LogLine[]>([]);

  // keep ref synced so SSE handler can append
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    const es = new EventSource(`/api/bots/${botId}/logs`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as
          | { type: "snapshot"; lines: LogLine[] }
          | { type: "line"; line: LogLine };
        if (data.type === "snapshot") {
          linesRef.current = data.lines;
          setLines(data.lines);
        } else if (data.type === "line") {
          const next = [...linesRef.current, data.line];
          if (next.length > 2000) next.splice(0, next.length - 2000);
          linesRef.current = next;
          setLines(next);
        }
      } catch {
        /* ignore parse errors (e.g. heartbeat comments) */
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [botId]);

  // autoscroll unless paused
  useEffect(() => {
    if (paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  function clearLogs() {
    linesRef.current = [];
    setLines([]);
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "inline-block size-2 rounded-full",
              connected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
            )}
          />
          {connected ? "Live" : "Reconnecting..."}
          <span className="text-zinc-300">·</span>
          <span>{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0"
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume autoscroll" : "Pause autoscroll"}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0"
            onClick={clearLogs}
            title="Clear local view"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed bg-zinc-950 text-zinc-100 custom-scroll"
      >
        {lines.length === 0 ? (
          <div className="text-zinc-500 italic">No logs yet — waiting for output...</div>
        ) : (
          lines.map((line, i) => <LogRow key={i} line={line} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const time = new Date(line.ts).toLocaleTimeString("en-US", { hour12: false });
  const color =
    line.level === "stderr"
      ? "text-rose-400"
      : line.level === "system"
        ? "text-sky-400"
        : "text-zinc-100";
  return (
    <div className="whitespace-pre-wrap break-words">
      <span className="text-zinc-600 select-none">{time} </span>
      <span className={cn("inline-block w-12 shrink-0 select-none", color)}>
        {line.level === "stderr" ? "ERR" : line.level === "system" ? "SYS" : "OUT"}
      </span>
      <span className={color}>{line.msg}</span>
    </div>
  );
}
