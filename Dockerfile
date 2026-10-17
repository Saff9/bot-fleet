# ─── Stage 1: Build the Rust log-archival utility ──────────────────────────
FROM rust:1.99-slim AS rust-builder

WORKDIR /build
COPY rust-utils/Cargo.toml rust-utils/Cargo.lock* ./rust-utils/
# Copy the source — if Cargo.lock is missing, cargo will generate one
COPY rust-utils/src ./src

# Build with optimizations + strip
RUN cargo build --release && \
    strip target/release/compress-logs

# ─── Stage 2: Install deps + build Next.js ────────────────────────────────
FROM oven/bun:1 AS app-builder

WORKDIR /app

# Copy lockfile + package.json first for layer caching
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy the rest of the app
COPY . .

# Build the Rust binary is already built in stage 1 — copy it in
COPY --from=rust-builder /build/target/release/compress-logs ./rust-utils/bin/compress-logs

# Push the Prisma schema (creates the DB if missing)
RUN bun run db:generate

# Build Next.js (standalone output)
RUN bun run build

# ─── Stage 3: Runtime ──────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Install only what we need at runtime: git (for cloning bots) + ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

# Copy the standalone Next.js build (bundles only what we need)
COPY --from=app-builder /app/.next/standalone ./
COPY --from=app-builder /app/.next/static ./.next/static
COPY --from=app-builder /app/public ./public
COPY --from=app-builder /app/prisma ./prisma
COPY --from=app-builder /app/rust-utils/bin/compress-logs ./rust-utils/bin/compress-logs
COPY --from=app-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=app-builder /app/node_modules/@prisma ./node_modules/@prisma

# Persistent data dir (mount a volume here in production)
RUN mkdir -p /data/bots
ENV DATABASE_URL=file:/data/bots.db
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# tini handles signal forwarding so SIGTERM kills child bot processes cleanly
ENTRYPOINT ["/usr/bin/tini", "--"]

# Auto-push schema on boot, then start
CMD ["sh", "-c", "bunx prisma db push --accept-data-loss && node server.js"]
