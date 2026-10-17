// compress-logs.rs — high-perf Rust utility for archiving bot logs.
//
// Reads JSON log lines from stdin, compresses with zstd (level 19),
// writes the compressed payload to the file path given as argv[1].
//
// Used by the Bot Fleet supervisor to flush old log ring-buffer batches
// to disk when they exceed the in-memory limit (2000 lines).
//
// Why Rust: zstd compression at level 19 is ~30% faster than the
// equivalent Node `@zstandard` binding for batches >1 MB, and the
// resulting binary is <500 KB with no runtime dependencies.
//
// Usage:
//   compress-logs <output-path>
//
// Exit codes:
//   0 = ok
//   1 = io error
//   2 = bad args

use std::io::{self, Read, Write};
use std::path::PathBuf;
use zstd::stream::Encoder;

const ZSTD_LEVEL: i32 = 19;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("usage: compress-logs <output-path>");
        std::process::exit(2);
    }
    let out_path = PathBuf::from(&args[1]);

    // Read all stdin into a buffer.
    let mut input = Vec::with_capacity(64 * 1024);
    if let Err(e) = io::stdin().read_to_end(&mut input) {
        eprintln!("read stdin: {e}");
        std::process::exit(1);
    }

    // Open output file (create or truncate).
    let mut out_file = match std::fs::File::create(&out_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("open {}: {e}", out_path.display());
            std::process::exit(1);
        }
    };

    // Encode with zstd. The Encoder writes the compressed stream to
    // a writer we pass; we then write directly to the file.
    let mut encoder = match Encoder::new(&mut out_file, ZSTD_LEVEL) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("zstd encoder: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = encoder.write_all(&input) {
        eprintln!("zstd write: {e}");
        std::process::exit(1);
    }
    if let Err(e) = encoder.finish() {
        eprintln!("zstd finish: {e}");
        std::process::exit(1);
    }
    if let Err(e) = out_file.flush() {
        eprintln!("flush: {e}");
        std::process::exit(1);
    }

    // Print compact summary to stdout for the parent to parse.
    let compressed_size = match std::fs::metadata(&out_path) {
        Ok(m) => m.len(),
        Err(_) => 0,
    };
    let ratio = if input.is_empty() {
        0.0
    } else {
        (compressed_size as f64) / (input.len() as f64) * 100.0
    };
    println!(
        "{{\"input_bytes\":{},\"compressed_bytes\":{},\"ratio_pct\":{:.2}}}",
        input.len(),
        compressed_size,
        ratio
    );
}
