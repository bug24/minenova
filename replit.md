# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## MineNova Project

A full-stack gamified crypto mining engagement web app.

### Artifacts
- **API Server** (`artifacts/api-server`) — Express + PostgreSQL backend, port 8080
- **MineNova** (`artifacts/minenova`) — React + Vite frontend

### Features
- 12-hour mining sessions with coin accumulation
- Daily tasks (login, social sharing, invite friend)
- Referral system with multi-tier commissions
- USDT withdrawal system (coins → USDT conversion at 1000:1)
- Boost system (2x/3x/5x multipliers) with ad-funded boosts
- Rig upgrades (purchasable with coins)
- Leaderboard
- Push notifications (VAPID-based, requires setup)
- Dark/light theme toggle

### Admin Panel (`/admin`)
- Dashboard analytics, user management, withdrawal approval
- Mining control, referral management, upgrade management
- Settings (mining rate, session duration, referral bonuses)
- Share link message templates
- Ad management (placement-based with tier targeting)
- Body scripts injection (for ad network scripts)
- **Two-Factor Authentication (TOTP)** — optional 2FA for admin login
- **SMTP settings** — configure email sending for verification

### Email Verification
- New users receive a verification token on sign-up
- `GET /api/auth/verify-email?token=xxx` — verifies email
- `POST /api/auth/resend-verification` — resend verification email
- Unverified users see a dismissible banner prompting verification
- In development mode, verification URL is logged to console and returned in API response
- SMTP configured via admin Settings tab → Email/SMTP section

### Admin 2FA (TOTP)
- Set up via Admin → Settings → "Two-Factor Authentication" section
- Uses `otpauth` library with SHA1, 6-digit, 30s TOTP
- QR code generated with `qrcode` package
- Secret stored in `admin_config` table as `admin_totp_secret`
- Login flow: password check → 2FA status check → TOTP step if enabled

### Database Schema Key Tables
- `users` — emailVerified, verificationToken, verificationTokenExpiry added
- `admin_config` — key/value store for settings, scripts, SMTP, TOTP secret
- `mining_sessions` — active and historical sessions
- `referrals`, `referral_transactions` — multi-tier referral tracking
- `withdrawals`, `transactions` — financial records
- `upgrades`, `user_upgrades` — rig upgrade catalog and purchases
- `ads`, `tasks` — admin-managed content
