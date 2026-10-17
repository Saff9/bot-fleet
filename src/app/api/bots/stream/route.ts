import { botManager } from "@/lib/bot-manager";
import { db } from "@/lib/db";
import { botToDTO } from "@/lib/dto";
import { readSessionFromRequest, isAuthEnabled, rateLimitOk, getClientIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of all bot runtime state.
 * Replaces the 3-second polling — clients get instant updates
 * the moment a bot's status changes.
 *
 * The BotManager emits "status:<id>" events whenever a child
 * transitions states (cloning → installing → running → stopped/error).
 * We subscribe to those events and push the full snapshot.
 *
 * Snapshot payload is intentionally small (~500 bytes per bot), and we
 * only emit when state changes (not on every log line — that's a
 * separate SSE stream at /api/bots/[id]/logs).
 */
export async function GET(req: Request) {
  const ip = getClientIp(req);
  if (isAuthEnabled()) {
    const session = readSessionFromRequest(req);
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!rateLimitOk(ip, "auth")) {
      return new Response("Too Many Requests", { status: 429 });
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller closed */
        }
      };

      const emitSnapshot = async () => {
        const bots = await db.bot.findMany({ orderBy: { createdAt: "desc" } });
        const dtos = bots.map(botToDTO);
        send({ type: "snapshot", bots: dtos });
      };
      void emitSnapshot();

      const onStatusChange = (botId: string) => {
        db.bot
          .findUnique({ where: { id: botId } })
          .then((bot) => {
            if (bot) send({ type: "update", bot: botToDTO(bot) });
          })
          .catch(() => {});
      };
      botManager.on("status", onStatusChange);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        botManager.off("status", onStatusChange);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };
      req.signal?.addEventListener("abort", cleanup);
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
