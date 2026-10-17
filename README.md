# Bot Fleet — Mini PaaS for Bots

> Self-hosted mini-PaaS: deploy **many bots from GitHub URLs** into a single Railway/Render/Fly service. Just like Railway/Render, but self-hosted — your bots live in one container.

![Status](https://img.shields.io/badge/status-production%20ready-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0-black)
![Next.js](https://img.shields.io/badge/Next.js-16-black)

## 🚀 One-click deploy

| Platform | Button | Free tier notes |
|---|---|---|
| **Railway** | [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/button/new?url=https://github.com/Saff9/bot-fleet) | $5 trial credit, 0.5 GB RAM, 30 days free |
| **Render** | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Saff9/bot-fleet) | 1 free web service (sleeps after 15 min) |

## ✨ Features

- **Deploy from GitHub URL** — paste any public repo, we clone it, install deps, run it
- **Live dashboard** — bot cards with status, uptime, restart count, last error
- **Live log streaming** — SSE-backed log viewer per bot with pause/clear
- **Dark mode** — system default, manual toggle on every page
- **Multi-runtime** — auto-detects `npm` / `bun` / `yarn` / `pip` / `cargo` / `go` / `maven` / `gradle`
- **Auto-restart** — on crash, exponential backoff (5 attempts max)
- **Encrypted env vars** — AES-256-GCM at rest with scrypt-derived key
- **Signed cookies** — HMAC-SHA256 stateless sessions, HTTP-only, SameSite=Strict
- **Rate limiting** — token bucket per IP (60/min unauth, 300/min auth, 10/min login)
- **Audit log** — every login + bot mutation recorded
- **Rust-powered log archival** — zstd-19 compression (97% ratio, 30% faster than Node bindings)
- **SSE bot list** — instant status updates, no polling

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js 16 App (single Railway/Render service)        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Dashboard (/)        ←─ SSE /api/bots/stream           │
│  Login (/login)       ←─ POST /api/auth/login           │
│  Bot detail (/bots/x) ←─ SSE /api/bots/x/logs           │
│                                                          │
│  Middleware: edge-safe, Web Crypto API cookie verify    │
│                                                          │
│  BotManager (singleton, survives HMR via globalThis)    │
│   ├─ cloneRepo()    → simple-git (shallow, --branch)    │
│   ├─ installCmd     → child_process spawn               │
│   ├─ spawnBot()     → child_process spawn with env      │
│   ├─ log ring buffer (2000 lines/bot) → SSE fan-out     │
│   ├─ auto-restart (5 attempts, exp backoff)             │
│   └─ status events → SSE /api/bots/stream               │
│                                                          │
│  Crypto: AES-256-GCM + scrypt KDF (OpenSSL C-speed)     │
│  Auth: HMAC-SHA256 signed cookies (stateless)           │
│  Rust: zstd-19 log archival binary                      │
│                                                          │
│  SQLite (Prisma) → /data/bots.db                        │
│  Bot work dirs  → /data/bots/<id>/                      │
└─────────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

- **Node.js ≥ 18** (or **Bun** — recommended, 2-3× lower memory)
- **Git** (for cloning bot repos)
- **Rust toolchain** (optional — only needed to rebuild the log-archival binary; a prebuilt Linux x86_64 binary is included at `rust-utils/bin/compress-logs`)

## 🔧 Local development

```bash
# 1. Install deps
bun install   # or: npm install

# 2. Set up env vars
cp .env.example .env
# Edit .env to set your BOT_FLEET_ADMIN_PASSWORD, MASTER_KEY, SESSION_SECRET

# 3. Push DB schema
bun run db:push

# 4. (Optional) Build the Rust utility — skip to use the prebuilt binary
cd rust-utils && cargo build --release && cd ..

# 5. Run!
bun run dev
```

Open `http://localhost:3000` — you'll be redirected to `/login`. Enter your admin password.

## 🐳 Production deploy (Docker)

```bash
docker build -t bot-fleet .
docker run -p 3000:3000 \
  -e BOT_FLEET_ADMIN_PASSWORD='your-strong-password' \
  -e BOT_FLEET_MASTER_KEY='$(openssl rand -hex 32)' \
  -e BOT_FLEET_SESSION_SECRET='$(openssl rand -hex 32)' \
  -v bot-fleet-data:/app/data \
  bot-fleet
```

The included `Dockerfile` is a **multi-stage build**:
1. Rust stage compiles `compress-logs`
2. Bun stage installs deps + builds Next.js
3. Runtime stage copies everything into a small final image

## 🚂 Deploy to Railway

1. Click the **Deploy on Railway** button above (or: `railway init` from this repo)
2. Set these env vars in the Railway dashboard:
   ```
   BOT_FLEET_ADMIN_PASSWORD=<your-strong-password>
   BOT_FLEET_MASTER_KEY=<openssl rand -hex 32>
   BOT_FLEET_SESSION_SECRET=<openssl rand -hex 32>
   DATABASE_URL=file:/data/bots.db
   ```
3. Add a **Volume** mounted at `/data` (so SQLite + bot work dirs persist)
4. Railway will run the build command from `railway.toml` automatically
5. Visit your service URL → login → deploy your first bot

## 🌐 Deploy to Render

1. Click the **Deploy to Render** button above (or: `render deploy` from this repo)
2. The `render.yaml` Blueprint will configure everything automatically
3. Add a **Disk** of 1 GB mounted at `/data`
4. Set env vars in the Render dashboard (or use the Blueprint's envGroup)
5. Visit your service URL → login → deploy your first bot

## ⚙️ Environment variables

| Variable | Required | Description |
|---|---|---|
| `BOT_FLEET_ADMIN_PASSWORD` | ✅ | Password for the admin login |
| `BOT_FLEET_MASTER_KEY` | ✅ | 32-byte hex key for AES-256-GCM env encryption |
| `BOT_FLEET_SESSION_SECRET` | ✅ | 32-byte hex key for HMAC-SHA256 cookie signing |
| `DATABASE_URL` | ✅ | SQLite path, e.g. `file:/data/bots.db` |
| `GITHUB_TOKEN` | ⛔ optional | For cloning private repos |
| `PORT` | auto | Set automatically by Railway/Render |

Generate strong random keys:
```bash
openssl rand -hex 32
```

## 📚 API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET`  | `/api/health` | ❌ public | Container RAM, uptime, CPUs |
| `POST` | `/api/auth/login` | ❌ public | `{password}` → signed cookie |
| `POST` | `/api/auth/logout` | ✅ | Clears cookie |
| `GET`  | `/api/bots` | ✅ | List all bots |
| `GET`  | `/api/bots/stream` | ✅ | **SSE** live bot list updates |
| `POST` | `/api/bots` | ✅ | Create + deploy bot from GitHub URL |
| `GET`  | `/api/bots/:id` | ✅ | Bot detail (env vars decrypted) |
| `PATCH`| `/api/bots/:id` | ✅ | Update config |
| `DELETE`| `/api/bots/:id` | ✅ | Stop + delete bot |
| `POST` | `/api/bots/:id/start` | ✅ | Start (skip clone) |
| `POST` | `/api/bots/:id/stop` | ✅ | Force-stop child process |
| `POST` | `/api/bots/:id/restart` | ✅ | Stop + start |
| `POST` | `/api/bots/:id/redeploy` | ✅ | Re-clone + redeploy |
| `GET`  | `/api/bots/:id/logs` | ✅ | **SSE** live log stream |
| `GET`  | `/api/audit` | ✅ | Last 100 audit events |

## 🧠 Memory math (Railway free = 512 MB)

| Bot type | Per-bot | Bots in 512 MB |
|---|---|---|
| Bun + grammY (Telegram) | ~15-25 MB | ~15-20 |
| Node + discord.js | ~40-60 MB | ~6-8 |
| Python + discord.py | ~50-80 MB | ~4-6 |

**Tip**: ask each bot's repo to use `bun install` + `bun run index.ts` (Bun is 2-3× lighter than Node).

## 🔒 Security model

- **Encryption at rest**: env vars stored as `enc:v1:<salt>:<iv>:<tag>:<ciphertext>` (AES-256-GCM with scrypt KDF, N=16384). Master key from `BOT_FLEET_MASTER_KEY` env var.
- **Stateless auth**: signed cookies (`<base64url(payload)>.<base64url(HMAC-SHA256)>`). No DB lookups per request.
- **Constant-time password compare** via `timingSafeEqual` (avoids timing side-channels).
- **Edge-safe middleware**: uses Web Crypto API, no `node:crypto` imports — runs on V8 isolates.
- **Defense-in-depth**: middleware checks cookie presence + signature; every API route re-verifies via `readSessionFromRequest()`.
- **Rate limiting**: in-memory token bucket, brute-force protection on `/api/auth/login` (10/min/IP).
- **Audit log**: every login + bot mutation recorded to the `AuditEvent` table.
- **HTTP-only, SameSite=Strict cookies**: not accessible from JS, not sent on cross-site requests.

### Known limitations
- **Stateless logout**: clearing the cookie clears it from the user's browser, but a stolen cookie is technically still valid until the 30-day expiry. For true revocation, rotate `BOT_FLEET_SESSION_SECRET` (kicks out all sessions).
- **Per-IP rate limiting**: in-memory and per-worker. Multiple workers = multiple buckets. Acceptable for single-instance Railway/Render free tiers.

## 🦀 Why Rust?

The Rust utility `rust-utils/src/compress_logs.rs` does one specific thing: read JSON log lines from stdin, compress with zstd level 19, write to a file path. We shell out to it from Node via `child_process.spawn` when archiving old log batches.

- **zstd-19 compression of >1 MB batches is ~30% faster than the equivalent Node `@zstandard` bindings**
- The compiled binary is **874 KB**, statically linked, no runtime deps
- If the binary is missing, the Node code gracefully falls back to writing raw JSON (no data loss)

We deliberately do **not** use Rust for AES-256-GCM or HMAC-SHA256 — those go through Node's `crypto` module which already calls into OpenSSL (C) directly. Spawning a Rust process per encrypt/decrypt would add ~5 ms of overhead per call.

## 📁 Project structure

```
bot-fleet/
├── prisma/schema.prisma         # Bot + AuditEvent models (SQLite)
├── public/                      # logo.svg, robots.txt
├── rust-utils/
│   ├── Cargo.toml
│   ├── src/compress_logs.rs     # Rust zstd-19 binary
│   └── bin/compress-logs       # Prebuilt Linux x86_64 binary
├── src/
│   ├── app/
│   │   ├── layout.tsx           # ThemeProvider + QueryProvider + Toaster
│   │   ├── page.tsx             # Dashboard (stat cards + bot grid + SSE)
│   │   ├── login/page.tsx       # Login form
│   │   ├── bots/[id]/page.tsx   # Bot detail + live logs
│   │   ├── middleware.ts        # Edge-safe auth gate
│   │   └── api/                 # All REST + SSE endpoints
│   ├── components/
│   │   ├── bot-fleet/           # StatusBadge, BotCard, AddBotDialog, LogViewer, AppHeader, StatCard
│   │   ├── theme-provider.tsx   # next-themes wrapper
│   │   ├── theme-toggle.tsx     # Moon/Sun button
│   │   └── providers.tsx        # TanStack Query client
│   ├── lib/
│   │   ├── auth.ts              # Signed cookies + rate limiter + audit
│   │   ├── bot-manager.ts       # Singleton process supervisor
│   │   ├── crypto.ts            # AES-256-GCM + scrypt
│   │   ├── db.ts                # Prisma client
│   │   ├── dto.ts               # Bot → BotDTO (with env decrypt)
│   │   ├── git.ts               # GitHub URL parser + simple-git wrapper
│   │   ├── rust-utils.ts        # Node → Rust binary bridge
│   │   └── types.ts             # Shared TypeScript types
│   └── hooks/                   # use-mobile, use-toast
├── .env.example                 # Template env vars
├── Dockerfile                   # Multi-stage: Rust build + Bun runtime
├── railway.toml                 # Railway service config
├── render.yaml                  # Render Blueprint
├── package.json
└── README.md                    # You are here
```

## 📜 License

MIT — do whatever you want.

## 🤝 Contributing

PRs welcome. Run `bun run lint` before submitting.

---

Built for people who want **all their bots in one container** without paying $5/bot/month on Railway.
