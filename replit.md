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
- **Sub-admin accounts** with per-module read/write permissions (see Sub-Admin System below)
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

### Ludo Game

- **Lobby** (`/ludo`) — browse open challenges, create new challenge (entry fee in coins), waiting screen with cancel/refund
- **Game screen** (`/ludo/game/:id`) — full 2-player Ludo on a 15×15 SVG board
  - Animated dice (`DiceFace` component) with rolling animation
  - Real-time updates via SSE (`EventSource`) — token passed as `?token=<jwt>` query param (EventSource cannot set headers)
  - Valid moves highlighted with a pulsing gold ring animation
  - Piece capture toast, "reached home" toast
  - Forfeit with confirmation overlay
  - Win/lose modal with payout breakdown (10% house fee, 90% to winner)
  - Wallet balance auto-refreshes after game ends
  - **Live voice chat** (WebRTC P2P audio) via floating mic button — hidden for bot games; signalling via `POST /api/ludo/games/:id/signal` relayed through SSE
- **Board layout**: TRACK_CELLS[52] defines the clockwise 15×15 path; RED_HOME_COL/BLUE_HOME_COL define progress 52-57 home column cells
- **Entry points**: Red=0 (row 6, col 1), Blue=26 (row 8, col 13); SAFE_SQUARES={0,8,13,21,26,34,39,47}
- **API**: plain fetch (not OpenAPI-generated) via `src/lib/ludoApi.ts`
- **SSE auth fix**: `ludo.ts` SSE route promotes `?token=` query param to `Authorization` header before inline auth

### Trivia Quiz Game

- **Lobby** (`/trivia`) — mode selector (vs Bot / vs Player), entry fee input with presets, open PvP challenges list, How to Play section, recent history
- **Game screen** (`/trivia/game/:id`) — 10 questions per game, 15-second countdown timer per question, A/B/C/D answer buttons, score counter
- **Bot mode**: starts immediately, bot pre-programmed at ~65% accuracy (answers generated at game creation)
- **PvP mode**: creator deducts entry fee → challenge created → opponent accepts (deducts fee) → both answer independently → scores compared at end
- **Settlement**: winner gets full pot minus platform fee (5% default); ties refund both minus fee
- **SSE**: `GET /api/trivia/events/:id` — notifies players when game completes
- **Admin config keys**: `trivia_enabled`, `trivia_min_fee` (50), `trivia_max_fee` (50000), `trivia_fee_pct` (5)
- **Questions**: 48 seeded across 8 categories: Bitcoin, Ethereum, DeFi, Mining, Altcoins, Blockchain Basics, NFTs, Exchanges
- **API routes**: all in `artifacts/api-server/src/routes/trivia.ts`
- **Frontend helpers**: `artifacts/minenova/src/lib/triviaApi.ts`

### WHOT Game

- **Lobby** (`/whot`) — same challenge/lobby pattern as Ludo
- **Game screen** (`/whot/game/:id`) — 2-player WHOT card game
  - Real-time updates via per-user sanitized SSE (each player only sees their own hand)
  - **Live voice chat** (WebRTC P2P audio) via floating mic button — hidden for bot games; signalling via `POST /api/whot/games/:id/signal`

### Voice Chat Architecture

- **Hook**: `artifacts/minenova/src/hooks/useVoiceChat.ts` — manages `RTCPeerConnection`, `getUserMedia`, offer/answer/ICE flow
- **UI**: `artifacts/minenova/src/components/VoiceChatButton.tsx` — floating fixed button (bottom-right, above nav)
- **Signal relay**: SSE carries `{ type:"signal", signalType, from:userId, payload }` events; frontend filters by `from !== myUserId`
- **Initiator rule**: player with lower userId always sends the offer (deterministic, avoids race conditions)
- **States**: idle → incoming → requesting → connecting → connected | denied | error
- **Remote speaking indicator**: `AudioContext` AnalyserNode samples remote stream level via rAF loop; renders pulsing dot when voice detected
- STUN: `stun:stun.l.google.com:19302`; no TURN server (works on same LAN or most public networks)

### Sub-Admin System

- **Token format**: `SAT_{base64(id:timestamp:hmac)}` — 24-hour TTL, HMAC-SHA256 with `SESSION_SECRET`
- **`requireAdmin` middleware**: accepts superadmin password OR SAT token; sets `req.isSuperAdmin` or `req.subAdmin`
- **`requireSuperAdmin` middleware**: superadmin password only
- **`requirePermission(module, type)`**: no-op for superadmin; checks `req.subAdmin.permissions[module]` for sub-admin
- **Modules**: dashboard, reports, users, withdrawals, transactions, mining, referrals, upgrades, settings, share, ads, scripts, trivia
- **Login flow**: `POST /api/admin/sub-admins/login` → SAT token → `GET /api/admin/sub-admins/me` → PermMap loaded into frontend state
- **Tab filtering**: `isSubAdmin` → TABS filtered to `subAdminPermissions[id]?.canRead`, `superAdminOnly` tabs always hidden
- **Read-only indicator**: lock icon in sidebar + amber banner in tab content when `canRead && !canWrite`
- **Sub-admin self-service**: `POST /api/admin/sub-admins/me/change-password` (current + new password)
- **Admin routes** (all `requireSuperAdmin`): GET/POST/PATCH/DELETE `/admin/sub-admins`, PUT `/admin/sub-admins/:id/permissions`
- **Audit logging**: all create/update/delete/permissions actions written to `admin_audit_log`
- **DB tables**: `sub_admins`, `sub_admin_permissions` (composite PK: subAdminId + module)
- **Schema file**: `lib/db/src/schema/sub_admins.ts`
- **Token helpers**: `artifacts/api-server/src/lib/auth.ts` — `generateSubAdminToken`, `verifySubAdminToken`, `isSubAdminToken`
- **Frontend component**: `SubAdminsTab` in `artifacts/minenova/src/pages/Admin.tsx` — list, create, edit (isActive + password + permissions), delete with confirmation modal
- **PermissionMatrix**: all modules × read/write checkboxes, select-all row per type

### Global Chat

- **Socket.IO** — real-time bidirectional chat via `socket.io` on the server and `socket.io-client` in the frontend
- **Connection path**: `/api/socket.io` — same HTTP server, no extra port
- **Auth**: JWT token passed in `socket.handshake.auth.token` (same token as REST API)
- **Features**: 50-message history sent on connect, 200-char limit, 3s rate limit, server-side XSS strip, banned-phrase rejection
- **Online count**: `online_users_count` event broadcast on every connect/disconnect
- **DB tables**: `chat_messages` (id, userId, username, message, createdAt), `chat_banned_words` (id, phrase, createdAt)
- **Chat toggle**: `chat_enabled` key in `admin_config` — when false, server emits `chat_disabled` and disconnects the socket
- **Frontend**: `Chat.tsx` — floating FAB button (bottom-right, above nav bar); slide-up panel with message bubbles, input, online count badge
- **Admin controls**: Settings tab → Global Chat section — enable/disable toggle + banned phrases CRUD (`/api/admin/chat/banned-words`)
- **Socket handler**: `artifacts/api-server/src/socket/chat.ts`
- **Admin routes**: `GET/POST/DELETE /api/admin/chat/banned-words`, `GET/DELETE /api/admin/chat/messages`
- **Message pruning**: DB keeps latest 200 messages (pruned async after each insert)

### Database Schema Key Tables
- `users` — emailVerified, verificationToken, verificationTokenExpiry added
- `admin_config` — key/value store for settings, scripts, SMTP, TOTP secret
- `mining_sessions` — active and historical sessions
- `referrals`, `referral_transactions` — multi-tier referral tracking
- `withdrawals`, `transactions` — financial records
- `upgrades`, `user_upgrades` — rig upgrade catalog and purchases
- `ads`, `tasks` — admin-managed content
- `ludo_challenges` — open/matched/cancelled challenges with entry fees
- `ludo_games` — active/completed games with full board state (JSONB)
- `ludo_moves` — individual move log per game
- `trivia_questions` — crypto trivia question bank (48+ questions seeded at startup)
- `trivia_challenges` — open PvP challenges with entry fee
- `trivia_games` — bot/pvp games with question IDs, answers (JSONB), scores, winner
- `chat_messages` — global chat message history (capped at 200 rows)
- `chat_banned_words` — admin-managed blocked phrases (case-insensitive match)
