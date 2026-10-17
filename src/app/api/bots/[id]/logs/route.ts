import { botManager } from "@/lib/bot-manager";
import type { LogLine } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Server-Sent Events stream of new log lines for a bot.
 * Also sends a snapshot of existing logs on first connect.
 *
 * Usage (client):
 *   const es = new EventSource(`/api/bots/${id}/logs`)
 *   es.onmessage = (e) => { const line = JSON.parse(e.data) }
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // 1. send existing snapshot as an array
      const existing = botManager.getLogs(id);
      send({ type: "snapshot", lines: existing });

      // 2. subscribe for live lines
      const unsub = botManager.subscribe(id, (line: LogLine) => {
        try {
          send({ type: "line", line });
        } catch {
          /* controller closed */
        }
      });

      // heartbeat every 25s so the connection isn't killed by proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 25000);

      // 3. cleanup on close
      req.signal?.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
