import { NextResponse } from "next/server";
import os from "node:os";

export const dynamic = "force-dynamic";

export async function GET() {
  const mem = process.memoryUsage();
  return NextResponse.json({
    ok: true,
    uptime: process.uptime(),
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    cpus: os.cpus().length,
    loadavg: os.loadavg(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  });
}
