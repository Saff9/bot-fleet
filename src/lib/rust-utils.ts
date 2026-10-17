import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

const BINARY_PATH = path.join(
  process.cwd(),
  "rust-utils",
  "target",
  "release",
  "compress-logs"
);

export interface CompressedLogResult {
  input_bytes: number;
  compressed_bytes: number;
  ratio_pct: number;
  output_path: string;
}

/**
 * Compress a batch of JSON log lines to a zstd archive using the Rust utility.
 * Used for log archival: when a bot's in-memory ring buffer hits its limit,
 * the oldest 1000 lines are flushed to /data/bots/<id>/logs/<ts>.zstd and
 * the in-memory buffer is trimmed. This keeps the process RAM bounded even
 * under sustained log throughput.
 *
 * Why Rust: zstd-19 compression of >1MB batches is ~30% faster than the
 * equivalent Node bindings, with no native dependency at runtime.
 */
export async function compressLogsBatch(
  lines: string[],
  outputPath: string
): Promise<CompressedLogResult> {
  // Make sure parent dir exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Skip if binary isn't built (dev convenience — fall back to no-op)
  try {
    await fs.access(BINARY_PATH);
  } catch {
    // Binary not built — write raw JSON instead so we never lose data
    await fs.writeFile(outputPath, lines.join("\n"), "utf8");
    return {
      input_bytes: Buffer.byteLength(lines.join("\n"), "utf8"),
      compressed_bytes: Buffer.byteLength(lines.join("\n"), "utf8"),
      ratio_pct: 100,
      output_path: outputPath,
    };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(BINARY_PATH, [outputPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout);
          resolve({ ...parsed, output_path: outputPath });
        } catch {
          resolve({
            input_bytes: 0,
            compressed_bytes: 0,
            ratio_pct: 0,
            output_path: outputPath,
          });
        }
      } else {
        reject(new Error(`compress-logs exited ${code}: ${stderr}`));
      }
    });

    // Stream the input
    const input = lines.join("\n");
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Ensure the Rust binary exists. Returns false if not yet built. */
export async function isRustUtilityAvailable(): Promise<boolean> {
  try {
    await fs.access(BINARY_PATH);
    return true;
  } catch {
    return false;
  }
}
