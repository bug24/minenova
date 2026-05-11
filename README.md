# MineNova

A full-stack gamified crypto mining engagement web app built with Express 5, React/Vite, Drizzle ORM, and PostgreSQL.

## Features

- **Mining** — 12-hour sessions with coin accumulation and auto-restart
- **Boost System** — 2×/3×/5× multipliers with ad-funded boosts
- **Rig Upgrades** — 8 sequential tiers with bundle skip pricing and discounts
- **Daily Tasks** — login streaks, social sharing, invite friend rewards
- **Referral System** — multi-tier commissions
- **USDT Withdrawals** — coin-to-USDT conversion (1000:1 rate)
- **Leaderboard** — global rankings
- **Global Chat** — real-time Socket.IO chat with moderation
- **Push Notifications** — VAPID-based web push
- **Dark / Light Theme**

## Games

| Game | Description |
|------|-------------|
| **Ludo** | 2-player Ludo on a 15×15 SVG board with real-time SSE updates and live voice chat |
| **WHOT** | 2-player card game with per-user sanitized SSE and live voice chat |
| **Trivia Quiz** | 10-question crypto trivia vs Bot or PvP, 15-second countdown |

## Admin Panel (`/admin`)

- Dashboard analytics and user management
- Withdrawal approval workflow
- Mining controls, referral management, upgrade management
- Sub-admin accounts with per-module read/write permissions
- Ad management (placement-based with tier targeting)
- Body script injection for ad networks
- SMTP settings for transactional email
- Two-Factor Authentication (TOTP)
- Share link message templates
- Global chat moderation (enable/disable, banned phrases)

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 |
| Package Manager | pnpm workspaces |
| Backend | Express 5 + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4, drizzle-zod |
| Frontend | React + Vite |
| API Contract | OpenAPI → Orval codegen |
| Real-time | Socket.IO (chat), SSE (games) |
| Auth | JWT + TOTP (admin 2FA) |
| Storage | Replit Object Storage (avatars) |
| Build | esbuild (CJS bundle) |

## Project Structure

```
├── artifacts/
│   ├── api-server/      # Express 5 backend (port 8080)
│   └── minenova/        # React + Vite frontend
├── lib/
│   ├── api-spec/        # OpenAPI spec + Orval codegen config
│   ├── api-zod/         # Generated Zod schemas
│   ├── api-client-react/# Generated React Query hooks
│   └── db/              # Drizzle ORM schema + migrations
└── scripts/             # Utility scripts
```

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm
- PostgreSQL database

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret for JWT signing |
| `VAPID_PRIVATE_KEY` | Web push VAPID private key |
| `VAPID_SUBJECT` | Web push subject (mailto:) |

### Development

```bash
# Install dependencies
pnpm install

# Push database schema
pnpm --filter @workspace/db run push

# Start API server (also builds the frontend)
pnpm --filter @workspace/api-server run dev

# Start frontend dev server (hot reload)
pnpm --filter @workspace/minenova run dev
```

### Codegen (after editing OpenAPI spec)

```bash
pnpm --filter @workspace/api-spec run codegen
```

### Typecheck

```bash
pnpm run typecheck
```

## License

MIT
