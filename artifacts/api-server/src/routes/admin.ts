import { Router, type IRouter } from "express";
import {
  db,
  shareMessagesTable,
  adminConfigTable,
  usersTable,
  transactionsTable,
  miningSessionsTable,
  referralsTable,
  referralTransactionsTable,
  referralEarningsTable,
  upgradesTable,
  userUpgradesTable,
  adsTable,
  tasksTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { eq, and, isNull, or, ilike, sql, desc, type SQL } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { sendUpgradeApprovedEmail, sendUpgradeRejectedEmail } from "../lib/email";
import { triggerUpgradeReferralReward } from "../lib/referralReward";

const router: IRouter = Router();

const DEFAULT_PASSWORD = process.env.ADMIN_SECRET || "minenova-admin-2024";
const COINS_PER_USDT = 1000;

async function getAdminPassword(): Promise<string> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "admin_password"))
    .limit(1);
  return row?.value ?? DEFAULT_PASSWORD;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const [existing] = await db
    .select({ key: adminConfigTable.key })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, key))
    .limit(1);
  if (existing) {
    await db.update(adminConfigTable).set({ value }).where(eq(adminConfigTable.key, key));
  } else {
    await db.insert(adminConfigTable).values({ key, value });
  }
}

async function seedAdminConfig() {
  const defaults: Record<string, string> = {
    admin_password: DEFAULT_PASSWORD,
    min_withdrawal_usdt: "5",
    referral_bonus_coins: "250",
    referral_commission_pct: "7",
    maintenance_mode: "false",
    global_base_coins_per_hour: "0.5",
    session_duration_hours: "12",
    referral_disabled: "false",
    mining_disabled: "false",
    ludo_platform_fee_pct: "10",
    ludo_win_pct: "90",
    ludo_min_fee: "10",
    ludo_max_fee: "10000",
    ludo_solo_fee: "100",
    ludo_solo_enabled: "true",
    ludo_timeout_minutes: "5",
    ludo_pvp_enabled: "true",
    ludo_pvp_min_fee: "10",
    ludo_pvp_max_fee: "10000",
    whot_platform_fee_pct: "10",
    whot_win_pct: "90",
    whot_min_fee: "10",
    whot_max_fee: "10000",
    whot_solo_fee: "100",
    whot_solo_enabled: "true",
    whot_timeout_minutes: "5",
    whot_pvp_enabled: "true",
    whot_pvp_min_fee: "10",
    whot_pvp_max_fee: "10000",
  };
  for (const [key, value] of Object.entries(defaults)) {
    const [existing] = await db
      .select({ key: adminConfigTable.key })
      .from(adminConfigTable)
      .where(eq(adminConfigTable.key, key))
      .limit(1);
    if (!existing) {
      await db.insert(adminConfigTable).values({ key, value });
    }
  }
}

const requireAdmin = async (req: any, res: any, next: any) => {
  const secret = req.headers["x-admin-secret"] ?? req.query.secret;
  const currentPassword = await getAdminPassword();
  if (secret !== currentPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

// ─── 2FA helpers ──────────────────────────────────────────────────────────────

async function get2FASecret(): Promise<string | null> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "admin_totp_secret"))
    .limit(1);
  return row?.value ?? null;
}

function verifyTOTP(secret: string, token: string): boolean {
  try {
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm: "SHA1", digits: 6, period: 30 });
    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

// GET /admin/2fa/status
router.get("/admin/2fa/status", async (_req, res): Promise<void> => {
  const secret = await get2FASecret();
  res.json({ enabled: !!secret });
});

// POST /admin/2fa/setup — verifies admin password, generates TOTP secret + QR code (not stored)
router.post("/admin/2fa/setup", async (req, res): Promise<void> => {
  const { secret: adminSecret } = req.body;
  const currentPassword = await getAdminPassword();
  if (adminSecret !== currentPassword) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }
  const totpSecret = new OTPAuth.Secret({ size: 20 });
  const secretBase32 = totpSecret.base32;
  const totp = new OTPAuth.TOTP({
    issuer: "MineNova Admin",
    label: "MineNova",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: totpSecret,
  });
  const otpAuthUrl = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);
  res.json({ secret: secretBase32, qrCodeDataUrl });
});

// POST /admin/2fa/enable — verifies code against new secret, then stores it
router.post("/admin/2fa/enable", async (req, res): Promise<void> => {
  const { secret: adminSecret, totpSecret, totpCode } = req.body;
  const currentPassword = await getAdminPassword();
  if (adminSecret !== currentPassword) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }
  if (!totpSecret || !totpCode) {
    res.status(400).json({ error: "Missing totpSecret or totpCode" });
    return;
  }
  if (!verifyTOTP(totpSecret, String(totpCode))) {
    res.status(400).json({ error: "Invalid authenticator code. Please try again." });
    return;
  }
  await upsertSetting("admin_totp_secret", totpSecret);
  res.json({ success: true });
});

// POST /admin/2fa/verify — used during login to verify TOTP after password check
router.post("/admin/2fa/verify", async (req, res): Promise<void> => {
  const { secret: adminSecret, totpCode } = req.body;
  const currentPassword = await getAdminPassword();
  if (adminSecret !== currentPassword) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }
  const totpSecret = await get2FASecret();
  if (!totpSecret) {
    res.json({ valid: true });
    return;
  }
  const valid = verifyTOTP(totpSecret, String(totpCode));
  if (!valid) {
    res.status(401).json({ error: "Invalid authenticator code" });
    return;
  }
  res.json({ valid: true });
});

// POST /admin/2fa/disable — requires password + TOTP to disable
router.post("/admin/2fa/disable", async (req, res): Promise<void> => {
  const { secret: adminSecret, totpCode } = req.body;
  const currentPassword = await getAdminPassword();
  if (adminSecret !== currentPassword) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }
  const totpSecret = await get2FASecret();
  if (totpSecret && !verifyTOTP(totpSecret, String(totpCode))) {
    res.status(401).json({ error: "Invalid authenticator code" });
    return;
  }
  await db.delete(adminConfigTable).where(eq(adminConfigTable.key, "admin_totp_secret"));
  res.json({ success: true });
});

const DEFAULT_MESSAGES = [
  {
    platform: "general",
    message: "I came across this platform where you mine and actually withdraw your earnings as USDT, no delays, no stress.\n\nIt's simple and it's already paying users.\n\nTry it here:\n{url}",
    sortOrder: 0,
  },
  {
    platform: "general",
    message: "If you're looking for a legit way to earn crypto online, this is it. You mine NovaCoin, withdraw as USDT, and the payments are real.\n\nI've already cashed out. Give it a try:\n{url}",
    sortOrder: 1,
  },
  {
    platform: "general",
    message: "Earning crypto while I sleep? Yes, it's real.\n\nMineNova lets you run a 12-hour mining session and withdraw your earnings as USDT. No complicated setup, no gimmicks.\n\nJoin free:\n{url}",
    sortOrder: 2,
  },
  {
    platform: "twitter",
    message: "Just discovered a platform where you mine crypto and actually withdraw as USDT 💰 No delays, no stress — it's already paying users.\n\nTry it free 👇\n{url}",
    sortOrder: 0,
  },
  {
    platform: "twitter",
    message: "Mining crypto doesn't have to be complicated ⛏️\n\nMineNova: mine for 12 hours, earn coins, withdraw as USDT. Simple as that.\n\nSign up here 👉 {url}",
    sortOrder: 1,
  },
  {
    platform: "whatsapp",
    message: "Hey! I've been using this app called MineNova to mine crypto and withdraw as USDT. It's legit and already paying people out. Check it out here: {url}",
    sortOrder: 0,
  },
  {
    platform: "whatsapp",
    message: "Bro/Sis, you need to try this. It's a crypto mining app that actually pays — USDT withdrawals, no stress. I've been using it and it works. Link: {url}",
    sortOrder: 1,
  },
  {
    platform: "facebook",
    message: "I came across this platform where you mine and actually withdraw your earnings as USDT, no delays, no stress.\n\nIt's simple and it's already paying users.\n\nTry it here: {url}",
    sortOrder: 0,
  },
  {
    platform: "facebook",
    message: "Looking for a real way to earn crypto? MineNova lets you mine for free and withdraw as USDT. I've been using it — it actually works!\n\nJoin here: {url}",
    sortOrder: 1,
  },
];

async function seedDefaultMessages() {
  const existing = await db.select({ id: shareMessagesTable.id }).from(shareMessagesTable).limit(1);
  if (existing.length === 0) {
    await db.insert(shareMessagesTable).values(
      DEFAULT_MESSAGES.map(m => ({ ...m, isActive: true }))
    );
  }
}

const DEFAULT_UPGRADES = [
  { tier: 1, name: "Speed Boost I", description: "Increase your mining speed by 20% permanently", hashRateBoost: 20, dailyCapBoost: 140, coinCost: 500, usdtCost: 5, isAutoMining: false, sortOrder: 1, badge: null, icon: "⚡" },
  { tier: 2, name: "Speed Boost II", description: "Increase mining speed to 1.5x permanently", hashRateBoost: 50, dailyCapBoost: 180, coinCost: 1500, usdtCost: 15, isAutoMining: false, sortOrder: 2, badge: "Popular", icon: "🚀" },
  { tier: 3, name: "Speed Boost III", description: "Double your mining speed permanently (2x base)", hashRateBoost: 100, dailyCapBoost: 250, coinCost: 3000, usdtCost: 30, isAutoMining: false, sortOrder: 3, badge: null, icon: "⛏️" },
  { tier: 4, name: "Mining Level 4", description: "Elite mining tier — 2.5x base mining speed", hashRateBoost: 150, dailyCapBoost: 350, coinCost: 6000, usdtCost: 60, isAutoMining: false, sortOrder: 4, badge: "Best Value", icon: "💎" },
  { tier: 5, name: "Auto Miner Pro", description: "Maximum speed (3x) with automatic mining sessions", hashRateBoost: 200, dailyCapBoost: 500, coinCost: 10000, usdtCost: 100, isAutoMining: true, sortOrder: 5, badge: "Elite", icon: "🤖" },
];

async function seedUpgrades() {
  for (const upgrade of DEFAULT_UPGRADES) {
    const existing = await db
      .select({ id: upgradesTable.id })
      .from(upgradesTable)
      .where(eq(upgradesTable.tier, upgrade.tier))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(upgradesTable).values(upgrade);
    } else {
      await db
        .update(upgradesTable)
        .set({
          name: upgrade.name,
          description: upgrade.description,
          hashRateBoost: upgrade.hashRateBoost,
          dailyCapBoost: upgrade.dailyCapBoost,
          coinCost: upgrade.coinCost,
          usdtCost: upgrade.usdtCost,
          isAutoMining: upgrade.isAutoMining,
          sortOrder: upgrade.sortOrder,
          badge: upgrade.badge,
          icon: upgrade.icon,
        })
        .where(eq(upgradesTable.tier, upgrade.tier));
    }
  }
}

const DEFAULT_TASKS = [
  { taskType: "daily_login", title: "Daily Login", description: "Log in to MineNova to claim your daily login bonus.", reward: 2, sortOrder: 1 },
  { taskType: "watch_video", title: "Watch Video", description: "Watch a short ad video to earn bonus coins.", reward: 3, sortOrder: 2 },
  { taskType: "share_twitter", title: "Share on Twitter", description: "Share MineNova with your Twitter followers and earn coins.", reward: 5, sortOrder: 3 },
  { taskType: "share_facebook", title: "Share on Facebook", description: "Share MineNova on Facebook and earn bonus coins.", reward: 5, sortOrder: 4 },
  { taskType: "share_whatsapp", title: "Share on WhatsApp", description: "Share MineNova via WhatsApp and earn bonus coins.", reward: 5, sortOrder: 5 },
  { taskType: "invite_friend", title: "Invite a Friend", description: "Invite a friend to join MineNova using your referral link.", reward: 10, sortOrder: 6 },
  { taskType: "complete_profile", title: "Complete Profile", description: "Fill in your profile details to earn a one-time bonus.", reward: 2, sortOrder: 7 },
];

async function seedTasks() {
  for (const task of DEFAULT_TASKS) {
    const existing = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.taskType, task.taskType))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(tasksTable).values({ ...task, isActive: true });
    }
  }
}

seedAdminConfig().catch(console.error);
seedDefaultMessages().catch(console.error);
seedUpgrades().catch(console.error);
seedTasks().catch(console.error);

// ─── Share Messages ────────────────────────────────────────────────────────────

router.get("/admin/share-messages", requireAdmin, async (_req, res): Promise<void> => {
  const messages = await db.select().from(shareMessagesTable).orderBy(shareMessagesTable.platform, shareMessagesTable.sortOrder);
  res.json(messages);
});

router.post("/admin/share-messages", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    platform: z.enum(["twitter", "whatsapp", "facebook", "general"]),
    message: z.string().min(1),
    isActive: z.boolean().default(true),
    sortOrder: z.number().default(0),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.message }); return; }
  const [msg] = await db.insert(shareMessagesTable).values(data.data).returning();
  res.json(msg);
});

router.put("/admin/share-messages/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    platform: z.enum(["twitter", "whatsapp", "facebook", "general"]).optional(),
    message: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.message }); return; }
  const [msg] = await db.update(shareMessagesTable).set(data.data).where(eq(shareMessagesTable.id, id)).returning();
  if (!msg) { res.status(404).json({ error: "Not found" }); return; }
  res.json(msg);
});

router.delete("/admin/share-messages/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.delete(shareMessagesTable).where(eq(shareMessagesTable.id, id));
  res.json({ success: true });
});

// ─── Change Password ───────────────────────────────────────────────────────────

router.post("/admin/change-password", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) {
    res.status(400).json({ error: data.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  await db
    .update(adminConfigTable)
    .set({ value: data.data.newPassword })
    .where(eq(adminConfigTable.key, "admin_password"));
  res.json({ success: true });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

router.get("/admin/analytics", requireAdmin, async (_req, res): Promise<void> => {
  const [totalUsersRow] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  const [activeMinersRow] = await db.select({ count: sql<number>`count(*)::int` }).from(miningSessionsTable).where(and(eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)));
  const [coinsRow] = await db.select({ sum: sql<number>`coalesce(sum(total_earned), 0)` }).from(usersTable);
  const [withdrawnRow] = await db.select({ sum: sql<number>`coalesce(sum(amount), 0)` }).from(transactionsTable).where(and(eq(transactionsTable.type, "withdrawal"), eq(transactionsTable.status, "approved")));
  const [refPayoutRow] = await db.select({ sum: sql<number>`coalesce(sum(amount), 0)` }).from(transactionsTable).where(eq(transactionsTable.type, "referral"));
  const [pendingRow] = await db.select({ count: sql<number>`count(*)::int` }).from(transactionsTable).where(and(eq(transactionsTable.type, "withdrawal"), eq(transactionsTable.status, "pending")));

  const [upgradeRevRow] = await db.select({ sum: sql<number>`coalesce(sum(abs(amount)), 0)::float8` }).from(transactionsTable).where(and(eq(transactionsTable.type, "upgrade_payment"), eq(transactionsTable.status, "completed")));
  const [upgradeCommRow] = await db.select({ sum: sql<number>`coalesce(sum(reward_locked_usdt), 0)::float8` }).from(referralEarningsTable);
  const [upgradeCommCoinsRow] = await db.select({ sum: sql<number>`coalesce(sum(reward_coins), 0)::float8` }).from(referralEarningsTable);
  const [gameFeeRow] = await db.select({ sum: sql<number>`coalesce(sum(amount), 0)::float8` }).from(transactionsTable).where(or(eq(transactionsTable.type, "ludo_fee"), eq(transactionsTable.type, "whot_fee")));
  const [rateConfigRow] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable).where(eq(adminConfigTable.key, "coin_usd_rate")).limit(1);
  const parsedConfigRate = rateConfigRow ? parseFloat(rateConfigRow.value) : NaN;
  const configCoinUsdRate = Number.isFinite(parsedConfigRate) && parsedConfigRate > 0 ? parsedConfigRate : 0.001;

  const usdtUpgradeRevenue = Math.round((upgradeRevRow.sum ?? 0) * 100) / 100;
  const totalUsdtWithdrawn = Math.round((withdrawnRow.sum ?? 0) * 100) / 100;
  const upgradeCommUsd = Math.round((upgradeCommRow.sum ?? 0) * 100) / 100;
  const upgradeCommCoinsUsd = Math.round(((upgradeCommCoinsRow.sum ?? 0) * configCoinUsdRate) * 100) / 100;
  const gameFeeUsd = Math.round(((gameFeeRow.sum ?? 0) * configCoinUsdRate) * 100) / 100;
  const referralCoinPayoutsUsd = Math.round(((refPayoutRow.sum ?? 0) * configCoinUsdRate) * 100) / 100;
  const netPnlUsdt = Math.round((usdtUpgradeRevenue + gameFeeUsd - totalUsdtWithdrawn - referralCoinPayoutsUsd - upgradeCommUsd - upgradeCommCoinsUsd) * 100) / 100;

  res.json({
    totalUsers: totalUsersRow.count,
    activeMiners: activeMinersRow.count,
    totalCoinsDistributed: Math.round((coinsRow.sum ?? 0) * 100) / 100,
    totalUsdtWithdrawn,
    totalReferralPayout: Math.round((refPayoutRow.sum ?? 0) * 100) / 100,
    pendingWithdrawals: pendingRow.count,
    usdtUpgradeRevenue,
    netPnlUsdt,
  });
});

// ─── Users ────────────────────────────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  let rows;
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    rows = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        coinBalance: usersTable.coinBalance,
        miningLevel: usersTable.miningLevel,
        totalEarned: usersTable.totalEarned,
        totalWithdrawn: usersTable.totalWithdrawn,
        isSuspended: usersTable.isSuspended,
        referralCode: usersTable.referralCode,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(or(ilike(usersTable.username, q), ilike(usersTable.email, q), ilike(usersTable.referralCode, q)))
      .orderBy(desc(usersTable.createdAt));
  } else {
    rows = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        coinBalance: usersTable.coinBalance,
        miningLevel: usersTable.miningLevel,
        totalEarned: usersTable.totalEarned,
        totalWithdrawn: usersTable.totalWithdrawn,
        isSuspended: usersTable.isSuspended,
        referralCode: usersTable.referralCode,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(desc(usersTable.createdAt));
  }
  res.json(rows.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })));
});

router.get("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [user] = await db.select({
    id: usersTable.id, username: usersTable.username, email: usersTable.email,
    coinBalance: usersTable.coinBalance, miningLevel: usersTable.miningLevel,
    totalEarned: usersTable.totalEarned, totalWithdrawn: usersTable.totalWithdrawn,
    isSuspended: usersTable.isSuspended, referralCode: usersTable.referralCode,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [activeSession] = await db
    .select({ id: miningSessionsTable.id, startedAt: miningSessionsTable.startedAt, endsAt: miningSessionsTable.endsAt, hashRate: miningSessionsTable.hashRate, boostMultiplier: miningSessionsTable.boostMultiplier })
    .from(miningSessionsTable)
    .where(and(eq(miningSessionsTable.userId, id), eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .limit(1);

  const referrals = await db
    .select({ id: referralsTable.id, referredId: referralsTable.referredId, totalEarned: referralsTable.totalEarned, bonusPaid: referralsTable.bonusPaid, createdAt: referralsTable.createdAt })
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, id))
    .orderBy(desc(referralsTable.createdAt));

  const referredUserIds = referrals.map(r => r.referredId);
  const referredUsersMap: Record<number, string> = {};
  if (referredUserIds.length > 0) {
    const referredUsers = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable).where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(referredUserIds.map(i => sql`${i}`), sql`, `)}])`);
    for (const u of referredUsers) referredUsersMap[u.id] = u.username;
  }

  const [referredByRow] = await db
    .select({ referrerId: referralsTable.referrerId })
    .from(referralsTable).where(eq(referralsTable.referredId, id)).limit(1);
  let referredByUsername: string | null = null;
  if (referredByRow) {
    const [refUser] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, referredByRow.referrerId)).limit(1);
    referredByUsername = refUser?.username ?? null;
  }

  const transactions = await db
    .select({ id: transactionsTable.id, type: transactionsTable.type, amount: transactionsTable.amount, status: transactionsTable.status, description: transactionsTable.description, adminNote: transactionsTable.adminNote, createdAt: transactionsTable.createdAt })
    .from(transactionsTable).where(eq(transactionsTable.userId, id)).orderBy(desc(transactionsTable.createdAt)).limit(30);

  const totalReferralEarned = referrals.reduce((s, r) => s + r.totalEarned, 0);

  res.json({
    ...user,
    createdAt: user.createdAt.toISOString(),
    activeSession: activeSession ? { ...activeSession, startedAt: activeSession.startedAt.toISOString(), endsAt: activeSession.endsAt.toISOString() } : null,
    referrals: referrals.map(r => ({ ...r, referredUsername: referredUsersMap[r.referredId] ?? `#${r.referredId}`, createdAt: r.createdAt.toISOString() })),
    referredByUsername,
    totalReferralEarned,
    transactions: transactions.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })),
  });
});

router.post("/admin/users/:id/reset-password", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const newPassword = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const hashed = hashPassword(newPassword);

  const [updated] = await db.update(usersTable).set({ passwordHash: hashed }).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  res.json({ success: true, newPassword });
});

router.post("/admin/users/:id/suspend", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const [user] = await db.select({ isSuspended: usersTable.isSuspended }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const [updated] = await db.update(usersTable).set({ isSuspended: !user.isSuspended }).where(eq(usersTable.id, id)).returning({ id: usersTable.id, isSuspended: usersTable.isSuspended });
  res.json(updated);
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.delete(miningSessionsTable).where(eq(miningSessionsTable.userId, id));
  await db.delete(transactionsTable).where(eq(transactionsTable.userId, id));
  await db.delete(referralsTable).where(or(eq(referralsTable.referrerId, id), eq(referralsTable.referredId, id)));
  await db.delete(userUpgradesTable).where(eq(userUpgradesTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ success: true });
});

router.post("/admin/users/:id/adjust-balance", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    delta: z.number(),
    note: z.string().min(1),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.issues[0]?.message ?? "Invalid input" }); return; }

  const [user] = await db.select({ coinBalance: usersTable.coinBalance, totalEarned: usersTable.totalEarned }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const requestedDelta = data.data.delta;
  const newBalance = Math.max(0, user.coinBalance + requestedDelta);
  const appliedDelta = newBalance - user.coinBalance;
  if (appliedDelta === 0 && requestedDelta !== 0) {
    res.status(400).json({ error: "Debit exceeds available balance; balance would go below zero." });
    return;
  }
  const newTotalEarned = appliedDelta > 0 ? user.totalEarned + appliedDelta : user.totalEarned;

  await db.update(usersTable).set({ coinBalance: newBalance, totalEarned: newTotalEarned }).where(eq(usersTable.id, id));
  await db.insert(transactionsTable).values({
    userId: id,
    type: "adjustment",
    amount: appliedDelta,
    status: "completed",
    description: data.data.note,
  });

  res.json({ success: true, newBalance });
});

// ─── Withdrawals ──────────────────────────────────────────────────────────────

router.get("/admin/withdrawal-stats", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      status: transactionsTable.status,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(amount), 0)`,
    })
    .from(transactionsTable)
    .where(eq(transactionsTable.type, "withdrawal"))
    .groupBy(transactionsTable.status);

  const byStatus: Record<string, { count: number; total: number }> = {};
  for (const r of rows) byStatus[r.status] = { count: r.count, total: r.total };

  res.json({
    pendingCount: byStatus["pending"]?.count ?? 0,
    pendingValue: Math.round((byStatus["pending"]?.total ?? 0) * 100) / 100,
    approvedTotal: Math.round((byStatus["approved"]?.total ?? 0) * 100) / 100,
    rejectedTotal: Math.round((byStatus["rejected"]?.total ?? 0) * 100) / 100,
  });
});

router.get("/admin/withdrawals", requireAdmin, async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;
  const search = (req.query.search as string | undefined)?.trim();
  const conditions: SQL<unknown>[] = [eq(transactionsTable.type, "withdrawal")];
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    conditions.push(eq(transactionsTable.status, status));
  }
  if (search) {
    conditions.push(
      or(
        ilike(usersTable.username, `%${search}%`),
        ilike(transactionsTable.walletAddress, `%${search}%`)
      ) as SQL<unknown>
    );
  }

  const rows = await db
    .select({
      id: transactionsTable.id,
      userId: transactionsTable.userId,
      amount: transactionsTable.amount,
      status: transactionsTable.status,
      walletAddress: transactionsTable.walletAddress,
      paymentTag: transactionsTable.paymentTag,
      adminNote: transactionsTable.adminNote,
      createdAt: transactionsTable.createdAt,
      username: usersTable.username,
      email: usersTable.email,
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(transactionsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(transactionsTable.createdAt));

  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.put("/admin/withdrawals/:id/note", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid withdrawal ID" }); return; }
  const schema = z.object({ adminNote: z.string().nullable() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [tx] = await db.select({ id: transactionsTable.id }).from(transactionsTable)
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "withdrawal"))).limit(1);
  if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  await db.update(transactionsTable).set({ adminNote: data.data.adminNote }).where(eq(transactionsTable.id, id));
  res.json({ success: true });
});

router.post("/admin/withdrawals/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid withdrawal ID" }); return; }
  const schema = z.object({ adminNote: z.string().nullable().optional() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }

  await db.transaction(async (trx) => {
    const [tx] = await trx.select().from(transactionsTable).where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "withdrawal"))).limit(1);
    if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
    if (tx.status !== "pending") { res.status(400).json({ error: "Only pending withdrawals can be approved" }); return; }

    const [updated] = await trx.update(transactionsTable)
      .set({ status: "approved", adminNote: data.data.adminNote ?? null })
      .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });
    if (!updated) { res.status(409).json({ error: "Withdrawal was already processed" }); return; }
    res.json({ success: true });
  });
});

router.post("/admin/withdrawals/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid withdrawal ID" }); return; }
  const schema = z.object({ adminNote: z.string().nullable().optional() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }

  await db.transaction(async (trx) => {
    const [tx] = await trx.select().from(transactionsTable).where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "withdrawal"))).limit(1);
    if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
    if (tx.status !== "pending") { res.status(400).json({ error: "Only pending withdrawals can be rejected" }); return; }

    const [updated] = await trx.update(transactionsTable)
      .set({ status: "rejected", adminNote: data.data.adminNote ?? null })
      .where(and(eq(transactionsTable.id, id), eq(transactionsTable.status, "pending")))
      .returning({ id: transactionsTable.id });
    if (!updated) { res.status(409).json({ error: "Withdrawal was already processed" }); return; }

    const refundCoins = tx.amount * COINS_PER_USDT;
    await trx.update(usersTable).set({ coinBalance: sql`coin_balance + ${refundCoins}`, totalWithdrawn: sql`total_withdrawn - ${tx.amount}` }).where(eq(usersTable.id, tx.userId));
    await trx.insert(transactionsTable).values({
      userId: tx.userId,
      type: "adjustment",
      amount: refundCoins,
      status: "completed",
      description: `Refund for rejected withdrawal #${id}`,
    });
    res.json({ success: true });
  });
});

// ─── Transactions ─────────────────────────────────────────────────────────────

router.get("/admin/transactions", requireAdmin, async (req, res): Promise<void> => {
  const type = req.query.type as string | undefined;
  const search = req.query.search as string | undefined;

  const conditions: SQL<unknown>[] = [];
  if (type && type !== "all") conditions.push(eq(transactionsTable.type, type));

  let rows;
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    const userIds = await db.select({ id: usersTable.id }).from(usersTable).where(or(ilike(usersTable.username, q), ilike(usersTable.email, q)));
    const ids = userIds.map(u => u.id);
    if (ids.length === 0) { res.json([]); return; }
    conditions.push(sql`${transactionsTable.userId} = ANY(ARRAY[${sql.join(ids.map(i => sql`${i}`), sql`, `)}])`);
  }

  rows = await db
    .select({
      id: transactionsTable.id,
      userId: transactionsTable.userId,
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      status: transactionsTable.status,
      description: transactionsTable.description,
      adminNote: transactionsTable.adminNote,
      createdAt: transactionsTable.createdAt,
      username: usersTable.username,
    })
    .from(transactionsTable)
    .leftJoin(usersTable, eq(transactionsTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactionsTable.createdAt))
    .limit(500);

  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ─── Mining Sessions ──────────────────────────────────────────────────────────

router.get("/admin/mining-sessions", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: miningSessionsTable.id,
      userId: miningSessionsTable.userId,
      hashRate: miningSessionsTable.hashRate,
      boostMultiplier: miningSessionsTable.boostMultiplier,
      startedAt: miningSessionsTable.startedAt,
      endsAt: miningSessionsTable.endsAt,
      username: usersTable.username,
      miningLevel: usersTable.miningLevel,
    })
    .from(miningSessionsTable)
    .leftJoin(usersTable, eq(miningSessionsTable.userId, usersTable.id))
    .where(and(eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .orderBy(desc(miningSessionsTable.startedAt));

  // Get global base rate and per-user overrides
  const [globalRateRow] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "global_base_coins_per_hour")).limit(1);
  const globalBaseRate = globalRateRow ? parseFloat(globalRateRow.value) : 0.5;

  const userIds = rows.map(r => r.userId);
  let overrideMap: Record<number, number> = {};
  if (userIds.length > 0) {
    const overrides = await db.select().from(adminConfigTable).where(
      sql`key = ANY(ARRAY[${sql.join(userIds.map(id => sql`${"user_rate_override_" + id}`), sql`, `)}])`
    );
    for (const o of overrides) {
      const uid = parseInt(o.key.replace("user_rate_override_", ""));
      overrideMap[uid] = parseFloat(o.value);
    }
  }

  res.json(rows.map(r => {
    const effectiveRate = overrideMap[r.userId] ?? globalBaseRate;
    const coinRate = effectiveRate * (r.miningLevel ?? 1) * r.boostMultiplier;
    return {
      ...r,
      coinRate: Math.round(coinRate * 1000) / 1000,
      effectiveBaseRate: effectiveRate,
      hasRateOverride: !!overrideMap[r.userId],
      startedAt: r.startedAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    };
  }));
});

router.post("/admin/mining-sessions/:id/stop", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.update(miningSessionsTable).set({ isActive: false, claimedAt: new Date() }).where(eq(miningSessionsTable.id, id));
  res.json({ success: true });
});

router.post("/admin/mining-sessions/:id/reset", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.update(miningSessionsTable).set({ isActive: false, claimedAt: new Date(), coinsEarned: 0 }).where(eq(miningSessionsTable.id, id));
  res.json({ success: true });
});

// ─── Mining Config ────────────────────────────────────────────────────────────

router.get("/admin/mining-config", requireAdmin, async (_req, res): Promise<void> => {
  const keys = ["global_base_coins_per_hour", "session_duration_hours", "maintenance_mode"];
  const rows = await db.select().from(adminConfigTable).where(
    sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`
  );
  const config: Record<string, string> = {};
  for (const r of rows) config[r.key] = r.value;

  const overrideRows = await db.select().from(adminConfigTable).where(
    sql`key LIKE ${"user_rate_override_%"}`
  );
  const userOverrides = overrideRows.map(r => ({
    userId: parseInt(r.key.replace("user_rate_override_", "")),
    rate: parseFloat(r.value),
  }));

  // Enrich overrides with usernames
  const overrideUserIds = userOverrides.map(o => o.userId);
  let usernameMap: Record<number, string> = {};
  if (overrideUserIds.length > 0) {
    const users = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable)
      .where(sql`id = ANY(ARRAY[${sql.join(overrideUserIds.map(id => sql`${id}`), sql`, `)}])`);
    for (const u of users) usernameMap[u.id] = u.username;
  }

  res.json({
    baseCoinRate: parseFloat(config.global_base_coins_per_hour ?? "0.5"),
    sessionDurationHours: parseInt(config.session_duration_hours ?? "12"),
    maintenanceMode: config.maintenance_mode === "true",
    userOverrides: userOverrides.map(o => ({ ...o, username: usernameMap[o.userId] ?? `#${o.userId}` })),
  });
});

router.put("/admin/mining-config", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    baseCoinRate: z.number().positive().optional(),
    sessionDurationHours: z.number().int().positive().optional(),
    maintenanceMode: z.boolean().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }
  if (data.data.baseCoinRate !== undefined) await upsertSetting("global_base_coins_per_hour", data.data.baseCoinRate.toString());
  if (data.data.sessionDurationHours !== undefined) await upsertSetting("session_duration_hours", data.data.sessionDurationHours.toString());
  if (data.data.maintenanceMode !== undefined) await upsertSetting("maintenance_mode", data.data.maintenanceMode.toString());
  res.json({ success: true });
});

router.put("/admin/users/:id/mining-rate", requireAdmin, async (req, res): Promise<void> => {
  const userId = parseInt(req.params.id);
  const schema = z.object({ rate: z.number().positive().nullable() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }
  if (data.data.rate === null) {
    await db.delete(adminConfigTable).where(eq(adminConfigTable.key, `user_rate_override_${userId}`));
  } else {
    await upsertSetting(`user_rate_override_${userId}`, data.data.rate.toString());
  }
  res.json({ success: true });
});

router.post("/admin/mining/start-for-user", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({ userId: z.number().int() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, data.data.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [activeSession] = await db.select().from(miningSessionsTable)
    .where(and(eq(miningSessionsTable.userId, user.id), eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .limit(1);
  if (activeSession && new Date() < new Date(activeSession.endsAt)) {
    res.status(400).json({ error: "User already has an active mining session" }); return;
  }

  const [durationRow] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "session_duration_hours")).limit(1);
  const [globalRateRow] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "global_base_coins_per_hour")).limit(1);
  const [userOverrideRow] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, `user_rate_override_${user.id}`)).limit(1);

  const durationHours = parseInt(durationRow?.value ?? "12");
  const baseRate = userOverrideRow ? parseFloat(userOverrideRow.value) : parseFloat(globalRateRow?.value ?? "0.5");

  const now = new Date();
  const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  const [session] = await db.insert(miningSessionsTable).values({
    userId: user.id,
    startedAt: now,
    endsAt,
    hashRate: Math.round(10 * user.miningLevel * baseRate / 0.5),
    boostMultiplier: 1,
    boostsUsedToday: 0,
    isActive: true,
  }).returning();

  res.json({ success: true, session: { ...session, startedAt: session.startedAt.toISOString(), endsAt: session.endsAt.toISOString() } });
});

// ─── Referrals ────────────────────────────────────────────────────────────────

router.get("/admin/referrals", requireAdmin, async (req, res): Promise<void> => {
  const search = (req.query.search as string | undefined)?.trim().toLowerCase() ?? "";

  const rows = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
      totalEarned: referralsTable.totalEarned,
      bonusPaid: referralsTable.bonusPaid,
      createdAt: referralsTable.createdAt,
    })
    .from(referralsTable)
    .orderBy(desc(referralsTable.createdAt));

  const allUsers = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable);
  const userMap: Record<number, string> = {};
  for (const u of allUsers) userMap[u.id] = u.username;

  const enriched = rows.map(r => ({
    ...r,
    referrerUsername: userMap[r.referrerId] ?? `#${r.referrerId}`,
    referredUsername: userMap[r.referredId] ?? `#${r.referredId}`,
    createdAt: r.createdAt.toISOString(),
  }));

  const filtered = search
    ? enriched.filter(r =>
        r.referrerUsername.toLowerCase().includes(search) ||
        r.referredUsername.toLowerCase().includes(search)
      )
    : enriched;

  res.json(filtered);
});

router.delete("/admin/referrals/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(referralsTable).where(eq(referralsTable.id, id));
  res.json({ success: true });
});

// ─── Referral Config ──────────────────────────────────────────────────────────

router.get("/admin/referral-config", requireAdmin, async (_req, res): Promise<void> => {
  const keys = ["referral_bonus_coins", "referral_commission_pct", "referral_disabled"];
  const rows = await db.select().from(adminConfigTable).where(
    sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`
  );
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  res.json({
    bonusCoins: parseFloat(cfg.referral_bonus_coins ?? "250"),
    commissionPct: parseFloat(cfg.referral_commission_pct ?? "7"),
    referralDisabled: cfg.referral_disabled === "true",
  });
});

router.put("/admin/referral-config", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    bonusCoins: z.number().nonnegative().optional(),
    commissionPct: z.number().min(0).max(100).optional(),
    referralDisabled: z.boolean().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }
  if (data.data.bonusCoins !== undefined) await upsertSetting("referral_bonus_coins", data.data.bonusCoins.toString());
  if (data.data.commissionPct !== undefined) await upsertSetting("referral_commission_pct", data.data.commissionPct.toString());
  if (data.data.referralDisabled !== undefined) await upsertSetting("referral_disabled", data.data.referralDisabled.toString());
  res.json({ success: true });
});

// ─── Referral Stats ───────────────────────────────────────────────────────────

router.get("/admin/referral-stats", requireAdmin, async (_req, res): Promise<void> => {
  const txRows = await db
    .select({
      referrerId: referralTransactionsTable.referrerId,
      rewardType: referralTransactionsTable.rewardType,
      amount: referralTransactionsTable.amount,
    })
    .from(referralTransactionsTable);

  const referralCountRows = await db
    .select({ referrerId: referralsTable.referrerId })
    .from(referralsTable);

  const countMap: Record<number, number> = {};
  for (const r of referralCountRows) {
    countMap[r.referrerId] = (countMap[r.referrerId] ?? 0) + 1;
  }

  const statsMap: Record<number, { totalBonus: number; totalCommission: number }> = {};
  for (const tx of txRows) {
    if (!statsMap[tx.referrerId]) statsMap[tx.referrerId] = { totalBonus: 0, totalCommission: 0 };
    if (tx.rewardType === "bonus") statsMap[tx.referrerId].totalBonus += tx.amount;
    if (tx.rewardType === "commission") statsMap[tx.referrerId].totalCommission += tx.amount;
  }

  const allUserIds = [...new Set([...Object.keys(statsMap).map(Number), ...Object.keys(countMap).map(Number)])];
  const users = allUserIds.length > 0
    ? await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable)
        .where(sql`id = ANY(ARRAY[${sql.join(allUserIds.map(id => sql`${id}`), sql`, `)}])`)
    : [];
  const userMap: Record<number, string> = {};
  for (const u of users) userMap[u.id] = u.username;

  const result = allUserIds.map(uid => {
    const stats = statsMap[uid] ?? { totalBonus: 0, totalCommission: 0 };
    return {
      userId: uid,
      username: userMap[uid] ?? `#${uid}`,
      referralCount: countMap[uid] ?? 0,
      totalBonus: Math.round(stats.totalBonus * 100) / 100,
      totalCommission: Math.round(stats.totalCommission * 100) / 100,
      total: Math.round((stats.totalBonus + stats.totalCommission) * 100) / 100,
    };
  }).sort((a, b) => b.total - a.total);

  res.json(result);
});

// ─── Referral Suspicious ──────────────────────────────────────────────────────

router.get("/admin/referral-suspicious", requireAdmin, async (_req, res): Promise<void> => {
  const referrals = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
      createdAt: referralsTable.createdAt,
    })
    .from(referralsTable)
    .orderBy(desc(referralsTable.createdAt));

  const allUserIds = [...new Set(referrals.flatMap(r => [r.referrerId, r.referredId]))];
  const users = allUserIds.length > 0
    ? await db.select({ id: usersTable.id, username: usersTable.username, createdAt: usersTable.createdAt }).from(usersTable)
        .where(sql`id = ANY(ARRAY[${sql.join(allUserIds.map(id => sql`${id}`), sql`, `)}])`)
    : [];
  const userMap: Record<number, { username: string; createdAt: Date }> = {};
  for (const u of users) userMap[u.id] = { username: u.username, createdAt: u.createdAt };

  // Commission per referrer for >10x average detection
  const txRows = await db
    .select({ referrerId: referralTransactionsTable.referrerId, amount: referralTransactionsTable.amount, rewardType: referralTransactionsTable.rewardType })
    .from(referralTransactionsTable)
    .where(eq(referralTransactionsTable.rewardType, "commission"));

  const commissionMap: Record<number, number> = {};
  for (const tx of txRows) {
    commissionMap[tx.referrerId] = (commissionMap[tx.referrerId] ?? 0) + tx.amount;
  }
  const commissionValues = Object.values(commissionMap);
  const avgCommission = commissionValues.length > 0 ? commissionValues.reduce((a, b) => a + b, 0) / commissionValues.length : 0;

  // Count same-day pairs per referrer
  const quickPairsByReferrer: Record<number, number> = {};
  const flagged: { referralId: number; referrerId: number; referredId: number; referrerUsername: string; referredUsername: string; reason: string; createdAt: string }[] = [];

  for (const r of referrals) {
    const referrer = userMap[r.referrerId];
    const referred = userMap[r.referredId];
    if (!referrer || !referred) continue;

    const hoursBetweenAccountCreation = Math.abs(referrer.createdAt.getTime() - referred.createdAt.getTime()) / (1000 * 60 * 60);

    if (hoursBetweenAccountCreation < 24) {
      quickPairsByReferrer[r.referrerId] = (quickPairsByReferrer[r.referrerId] ?? 0) + 1;
    }
  }

  const seenIds = new Set<number>();
  for (const r of referrals) {
    const referrer = userMap[r.referrerId];
    const referred = userMap[r.referredId];
    if (!referrer || !referred) continue;

    const hoursBetweenAccountCreation = Math.abs(referrer.createdAt.getTime() - referred.createdAt.getTime()) / (1000 * 60 * 60);
    const reasons: string[] = [];

    if (hoursBetweenAccountCreation < 24) {
      reasons.push(`Both accounts created within ${Math.round(hoursBetweenAccountCreation)}h of each other`);
    }
    if ((quickPairsByReferrer[r.referrerId] ?? 0) > 5) {
      reasons.push(`Referrer has ${quickPairsByReferrer[r.referrerId]} referrals where both accounts were created within 24h`);
    }
    if (avgCommission > 0 && (commissionMap[r.referrerId] ?? 0) > avgCommission * 10) {
      reasons.push(`Referrer earned ${Math.round(commissionMap[r.referrerId])} coins commission (>10× average of ${Math.round(avgCommission)})`);
    }

    if (reasons.length > 0 && !seenIds.has(r.id)) {
      seenIds.add(r.id);
      flagged.push({
        referralId: r.id,
        referrerId: r.referrerId,
        referredId: r.referredId,
        referrerUsername: referrer.username,
        referredUsername: referred.username,
        reason: reasons.join(" · "),
        createdAt: r.createdAt.toISOString(),
      });
    }
  }

  res.json(flagged);
});

// ─── Upgrade Packages CRUD ────────────────────────────────────────────────────

router.get("/admin/upgrades", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(upgradesTable).orderBy(upgradesTable.sortOrder);
  res.json(rows);
});

router.post("/admin/upgrades", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    tier: z.number().int().min(1),
    hashRateBoost: z.number().min(0),
    dailyCapBoost: z.number().min(0),
    coinCost: z.number().min(0).nullable().optional(),
    usdtCost: z.number().min(0).nullable().optional(),
    isAutoMining: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    badge: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.issues[0]?.message ?? "Invalid input" }); return; }
  const [row] = await db.insert(upgradesTable).values(data.data).returning();
  res.json(row);
});

router.put("/admin/upgrades/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const schema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    tier: z.number().int().min(1).optional(),
    hashRateBoost: z.number().min(0).optional(),
    dailyCapBoost: z.number().min(0).optional(),
    coinCost: z.number().min(0).nullable().optional(),
    usdtCost: z.number().min(0).nullable().optional(),
    isAutoMining: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    badge: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.issues[0]?.message ?? "Invalid input" }); return; }
  const [row] = await db.update(upgradesTable).set(data.data).where(eq(upgradesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Upgrade not found" }); return; }
  res.json(row);
});

router.delete("/admin/upgrades/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [ownerRow] = await db
    .select({ id: userUpgradesTable.id })
    .from(userUpgradesTable)
    .where(eq(userUpgradesTable.upgradeId, id))
    .limit(1);
  if (ownerRow) {
    res.status(409).json({ error: "Cannot delete: users have purchased this upgrade. Edit the package instead or adjust pricing/boost values." });
    return;
  }
  await db.delete(upgradesTable).where(eq(upgradesTable.id, id));
  res.json({ success: true });
});

// ─── Upgrade Purchases ────────────────────────────────────────────────────────

router.get("/admin/upgrade-purchases", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: userUpgradesTable.id,
      userId: userUpgradesTable.userId,
      upgradeId: userUpgradesTable.upgradeId,
      purchasedAt: userUpgradesTable.purchasedAt,
      username: usersTable.username,
      upgradeName: upgradesTable.name,
      tier: upgradesTable.tier,
      usdtCost: upgradesTable.usdtCost,
    })
    .from(userUpgradesTable)
    .leftJoin(usersTable, eq(userUpgradesTable.userId, usersTable.id))
    .leftJoin(upgradesTable, eq(userUpgradesTable.upgradeId, upgradesTable.id))
    .orderBy(desc(userUpgradesTable.purchasedAt));

  res.json(rows.map(r => ({ ...r, purchasedAt: r.purchasedAt.toISOString() })));
});

// ─── Settings ─────────────────────────────────────────────────────────────────

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const keys = [
    "min_withdrawal_usdt", "referral_bonus_coins", "referral_commission_pct",
    "maintenance_mode", "global_base_coins_per_hour", "session_duration_hours",
    "referral_disabled", "mining_disabled",
    "ludo_platform_fee_pct", "ludo_win_pct", "ludo_min_fee", "ludo_max_fee",
    "ludo_solo_fee", "ludo_solo_enabled", "ludo_timeout_minutes",
    "ludo_pvp_enabled", "ludo_pvp_min_fee", "ludo_pvp_max_fee",
    "whot_platform_fee_pct", "whot_win_pct", "whot_min_fee", "whot_max_fee",
    "whot_solo_fee", "whot_solo_enabled", "whot_timeout_minutes",
    "whot_pvp_enabled", "whot_pvp_min_fee", "whot_pvp_max_fee",
    "withdrawal_ticker_enabled",
    "voice_chat_enabled",
    "auto_miner_interval_minutes",
  ];
  const rows = await db.select().from(adminConfigTable).where(sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const boolStr = z.enum(["true", "false"]);
  const strictNum = (min: number, max?: number) =>
    z.string().refine(v => /^-?\d+(\.\d*)?$/.test(v.trim()) && parseFloat(v) >= min && (max === undefined || parseFloat(v) <= max),
      max !== undefined ? `Must be a number between ${min} and ${max}` : `Must be a number ≥ ${min}`);
  const strictPosInt = z.string().refine(v => /^\d+$/.test(v.trim()) && parseInt(v) >= 1, "Must be a positive integer");
  const schema = z.object({
    min_withdrawal_usdt: strictNum(0).optional(),
    referral_bonus_coins: strictNum(0).optional(),
    referral_commission_pct: strictNum(0, 100).optional(),
    maintenance_mode: boolStr.optional(),
    global_base_coins_per_hour: strictNum(0.001).optional(),
    session_duration_hours: strictPosInt.optional(),
    referral_disabled: boolStr.optional(),
    mining_disabled: boolStr.optional(),
    ludo_platform_fee_pct: strictNum(0, 99).optional(),
    ludo_win_pct: strictNum(1, 100).optional(),
    ludo_min_fee: strictNum(1).optional(),
    ludo_max_fee: strictNum(1).optional(),
    ludo_solo_fee: strictNum(1).optional(),
    ludo_solo_enabled: boolStr.optional(),
    ludo_timeout_minutes: strictPosInt.optional(),
    ludo_pvp_enabled: boolStr.optional(),
    ludo_pvp_min_fee: strictNum(1).optional(),
    ludo_pvp_max_fee: strictNum(1).optional(),
    whot_platform_fee_pct: strictNum(0, 99).optional(),
    whot_win_pct: strictNum(1, 100).optional(),
    whot_min_fee: strictNum(1).optional(),
    whot_max_fee: strictNum(1).optional(),
    whot_solo_fee: strictNum(1).optional(),
    whot_solo_enabled: boolStr.optional(),
    whot_timeout_minutes: strictPosInt.optional(),
    whot_pvp_enabled: boolStr.optional(),
    whot_pvp_min_fee: strictNum(1).optional(),
    whot_pvp_max_fee: strictNum(1).optional(),
    withdrawal_ticker_enabled: boolStr.optional(),
    voice_chat_enabled: boolStr.optional(),
    auto_miner_interval_minutes: z.string().refine(v => /^\d+$/.test(v.trim()) && parseInt(v) >= 1 && parseInt(v) <= 1440, "Must be 1–1440 minutes").optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) {
    const msg = data.error.issues[0]?.message ?? "Invalid input";
    res.status(400).json({ error: msg });
    return;
  }
  for (const [key, value] of Object.entries(data.data)) {
    if (value !== undefined) await upsertSetting(key, value);
  }
  res.json({ success: true });
});

// ─── Ads CRUD ────────────────────────────────────────────────────────────────

const adCreateSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["video", "image", "script", "external_link"]),
  urlOrCode: z.string().optional(),
  providerScript: z.string().optional(),
  durationSeconds: z.number().int().min(1).default(15),
  placement: z.string().min(1).default("boost_2x"),
  isActive: z.boolean().default(true),
});

router.get("/admin/ads", requireAdmin, async (req, res): Promise<void> => {
  const { placement, status } = req.query as { placement?: string; status?: string };
  const conditions: ReturnType<typeof eq>[] = [];
  if (status === "active") conditions.push(eq(adsTable.isActive, true));
  if (status === "inactive") conditions.push(eq(adsTable.isActive, false));
  const rows = await db.select().from(adsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adsTable.createdAt));
  const filtered = placement
    ? rows.filter(r => r.placement.split(",").map(s => s.trim()).includes(placement))
    : rows;
  res.json(filtered);
});

router.post("/admin/ads", requireAdmin, async (req, res): Promise<void> => {
  const parsed = adCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const [created] = await db.insert(adsTable).values(parsed.data).returning();
  res.status(201).json(created);
});

router.put("/admin/ads/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = adCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const [updated] = await db.update(adsTable).set(parsed.data).where(eq(adsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Ad not found" }); return; }
  res.json(updated);
});

router.delete("/admin/ads/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(adsTable).where(eq(adsTable.id, id));
  res.json({ success: true });
});

// ─── Public Ad Slots (top / bottom / floating) ───────────────────────────────

router.get("/ad-slots", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(adminConfigTable)
    .where(sql`key IN ('ad_slot_top', 'ad_slot_bottom', 'ad_slot_floating')`);
  const map = new Map(rows.map(r => [r.key, r.value]));
  res.json({
    top:      map.get("ad_slot_top")      ?? "",
    bottom:   map.get("ad_slot_bottom")   ?? "",
    floating: map.get("ad_slot_floating") ?? "",
  });
});

// ─── Public Body Scripts ─────────────────────────────────────────────────────

router.get("/body-scripts", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "body_scripts"))
    .limit(1);
  res.json({ scripts: row?.value ?? "" });
});

// ─── Public ads.txt ──────────────────────────────────────────────────────────

router.get("/ads-txt", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "ads_txt"))
    .limit(1);
  const content = row?.value?.trim();
  if (!content) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(content);
});

// ─── Public Head Meta Tags ────────────────────────────────────────────────────

router.get("/head-meta", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "head_meta_tags"))
    .limit(1);
  res.json({ tags: row?.value ?? "" });
});

// ─── Generic Config ───────────────────────────────────────────────────────────

router.get("/admin/config", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(adminConfigTable);
  const config: Record<string, string> = {};
  for (const r of rows) config[r.key] = r.value;
  res.json(config);
});

router.post("/admin/config", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({ key: z.string().min(1), value: z.string() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.issues[0]?.message ?? "Invalid input" }); return; }
  await upsertSetting(data.data.key, data.data.value);
  res.json({ success: true });
});

// ─── Upgrade Payment Management ───────────────────────────────────────────────

router.get("/admin/upgrade-payments", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      transactionId: transactionsTable.id,
      userId: transactionsTable.userId,
      username: usersTable.username,
      email: usersTable.email,
      amount: transactionsTable.amount,
      paymentTag: transactionsTable.paymentTag,
      status: transactionsTable.status,
      description: transactionsTable.description,
      upgradeId: transactionsTable.upgradeId,
      adminNote: transactionsTable.adminNote,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .innerJoin(usersTable, eq(transactionsTable.userId, usersTable.id))
    .where(eq(transactionsTable.type, "upgrade_payment"))
    .orderBy(desc(transactionsTable.createdAt));

  res.json(rows.map(r => ({
    transactionId: r.transactionId,
    userId: r.userId,
    username: r.username,
    email: r.email,
    upgradeName: r.description.replace("USDT payment for upgrade: ", ""),
    upgradeId: r.upgradeId ?? 0,
    amount: Math.abs(r.amount),
    paymentTag: r.paymentTag ?? "",
    status: r.status,
    adminNote: r.adminNote ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/admin/upgrade-payments/:transactionId/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.transactionId, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = z.object({ note: z.string().optional() }).safeParse(req.body);
  const note = body.success ? body.data.note : undefined;

  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "upgrade_payment")))
    .limit(1);

  if (!txn) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (txn.status === "completed") { res.status(400).json({ error: "Already approved" }); return; }

  let upgradeId = txn.upgradeId;
  if (!upgradeId) {
    const name = txn.description.replace("USDT payment for upgrade: ", "");
    const [found] = await db.select({ id: upgradesTable.id }).from(upgradesTable)
      .where(eq(upgradesTable.name, name)).limit(1);
    if (found) upgradeId = found.id;
  }
  if (!upgradeId) { res.status(400).json({ error: "Upgrade not found — cannot approve this payment" }); return; }

  const [upgrade] = await db.select().from(upgradesTable).where(eq(upgradesTable.id, upgradeId)).limit(1);
  if (!upgrade) { res.status(404).json({ error: "Upgrade not found" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, txn.userId)).limit(1);

  await db.update(transactionsTable)
    .set({ status: "completed", adminNote: note ?? null, upgradeId })
    .where(eq(transactionsTable.id, id));
  await db.insert(userUpgradesTable).values({ userId: txn.userId, upgradeId });
  await db.update(usersTable).set({ miningLevel: sql`mining_level + 1` }).where(eq(usersTable.id, txn.userId));

  sendUpgradeApprovedEmail(user.email, user.username, upgrade.name, note).catch(() => {});

  const usdtValue = upgrade.usdtCost ?? 0;
  if (usdtValue > 0) {
    // Reward trigger is non-fatal: approval is already committed at this point.
    // Errors (e.g., duplicate unique key on retry) are logged without
    // failing the admin approval response.
    await triggerUpgradeReferralReward({ referredUserId: txn.userId, upgradeId, upgradeUsdtValue: usdtValue })
      .catch(err => req.log.error({ err, upgradeId, userId: txn.userId }, "Referral reward trigger failed for USDT upgrade approval"));
  }

  res.json({ success: true, message: `Upgrade approved for ${user.username}.` });
});

router.post("/admin/upgrade-payments/:transactionId/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.transactionId, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = z.object({ note: z.string().optional() }).safeParse(req.body);
  const note = body.success ? body.data.note : undefined;

  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "upgrade_payment")))
    .limit(1);

  if (!txn) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (txn.status === "rejected") { res.status(400).json({ error: "Already rejected" }); return; }

  const upgradeId = txn.upgradeId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, txn.userId)).limit(1);
  const upgradeMeta = upgradeId
    ? await db.select({ name: upgradesTable.name }).from(upgradesTable).where(eq(upgradesTable.id, upgradeId)).limit(1).then(r => r[0])
    : null;

  await db.update(transactionsTable).set({ status: "rejected", adminNote: note ?? null }).where(eq(transactionsTable.id, id));

  sendUpgradeRejectedEmail(
    user.email,
    user.username,
    upgradeMeta?.name ?? txn.description.replace("USDT payment for upgrade: ", ""),
    note,
  ).catch(() => {});

  res.json({ success: true, message: `Payment rejected for ${user.username}.` });
});

// ─── Financial Reports ────────────────────────────────────────────────────────

router.get("/admin/reports/summary", requireAdmin, async (req, res): Promise<void> => {
  // Load coin rate from admin config, override allowed via query param
  const [rateRow] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "coin_usd_rate")).limit(1);
  const parsedDefault = rateRow ? parseFloat(rateRow.value) : NaN;
  const defaultRate = Number.isFinite(parsedDefault) && parsedDefault > 0 ? parsedDefault : 0.001;
  const parsedQuery = req.query.coinUsdRate ? parseFloat(req.query.coinUsdRate as string) : NaN;
  const coinUsdRate = Number.isFinite(parsedQuery) && parsedQuery > 0 ? parsedQuery : defaultRate;

  const RELEVANT_TYPES = ["upgrade_payment", "withdrawal", "ludo_fee", "whot_fee", "referral"];

  // All-time totals grouped by type + status — upgrade_payment uses ABS since stored as negative
  const allTimeTotals = await db
    .select({
      type: transactionsTable.type,
      status: transactionsTable.status,
      total: sql<number>`coalesce(sum(abs(amount)), 0)::float8`,
    })
    .from(transactionsTable)
    .where(sql`${transactionsTable.type} = ANY(ARRAY[${sql.join(RELEVANT_TYPES.map(t => sql`${t}`), sql`, `)}])`)
    .groupBy(transactionsTable.type, transactionsTable.status);

  // Split referral coin payouts by reward type (bonus = signup activation; commission = mining)
  // Source: referralTransactionsTable which has rewardType detail. This avoids double-counting
  // with transactions.type="referral" — we only use ONE source for each category.
  const referralByType = await db
    .select({
      rewardType: referralTransactionsTable.rewardType,
      total: sql<number>`coalesce(sum(${referralTransactionsTable.amount}), 0)::float8`,
    })
    .from(referralTransactionsTable)
    .where(sql`${referralTransactionsTable.rewardType} IN ('bonus', 'commission')`)
    .groupBy(referralTransactionsTable.rewardType);

  // All-time upgrade commission USDT payouts (locked USDT given to referrers)
  const [[upgradeCommUsdRow], [upgradeCommCoinsRow]] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(reward_locked_usdt), 0)::float8` }).from(referralEarningsTable),
    db.select({ total: sql<number>`coalesce(sum(reward_coins), 0)::float8` }).from(referralEarningsTable),
  ]);

  // Monthly totals from transactionsTable for last 6 months
  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${transactionsTable.createdAt}), 'YYYY-MM')`,
      type: transactionsTable.type,
      status: transactionsTable.status,
      total: sql<number>`coalesce(sum(abs(${transactionsTable.amount})), 0)::float8`,
    })
    .from(transactionsTable)
    .where(
      and(
        sql`${transactionsTable.type} = ANY(ARRAY[${sql.join(RELEVANT_TYPES.map(t => sql`${t}`), sql`, `)}])`,
        sql`${transactionsTable.createdAt} >= date_trunc('month', now()) - interval '5 months'`
      )
    )
    .groupBy(
      sql`date_trunc('month', ${transactionsTable.createdAt})`,
      transactionsTable.type,
      transactionsTable.status
    )
    .orderBy(sql`date_trunc('month', ${transactionsTable.createdAt})`);

  // Monthly referral coin breakdown by rewardType (bonus vs commission)
  const monthlyReferralRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${referralTransactionsTable.createdAt}), 'YYYY-MM')`,
      rewardType: referralTransactionsTable.rewardType,
      total: sql<number>`coalesce(sum(${referralTransactionsTable.amount}), 0)::float8`,
    })
    .from(referralTransactionsTable)
    .where(
      and(
        sql`${referralTransactionsTable.rewardType} IN ('bonus', 'commission')`,
        sql`${referralTransactionsTable.createdAt} >= date_trunc('month', now()) - interval '5 months'`
      )
    )
    .groupBy(sql`date_trunc('month', ${referralTransactionsTable.createdAt})`, referralTransactionsTable.rewardType)
    .orderBy(sql`date_trunc('month', ${referralTransactionsTable.createdAt})`);

  // Monthly upgrade commission USDT + coins
  const monthlyCommRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${referralEarningsTable.createdAt}), 'YYYY-MM')`,
      commUsdt: sql<number>`coalesce(sum(${referralEarningsTable.rewardLockedUsdt}), 0)::float8`,
      commCoins: sql<number>`coalesce(sum(${referralEarningsTable.rewardCoins}), 0)::float8`,
    })
    .from(referralEarningsTable)
    .where(sql`${referralEarningsTable.createdAt} >= date_trunc('month', now()) - interval '5 months'`)
    .groupBy(sql`date_trunc('month', ${referralEarningsTable.createdAt})`)
    .orderBy(sql`date_trunc('month', ${referralEarningsTable.createdAt})`);

  // Helper: extract from all-time totals (all amounts already ABS'd)
  const get = (type: string, status?: string) => {
    const rows = allTimeTotals.filter(r => r.type === type && (status ? r.status === status : true));
    return rows.reduce((s, r) => s + r.total, 0);
  };

  const upgradeRevenue = get("upgrade_payment", "completed");
  const withdrawalsCost = get("withdrawal", "approved");
  const gameFeeCoins = get("ludo_fee") + get("whot_fee");
  const gameFeeUsd = gameFeeCoins * coinUsdRate;

  // Separate referral coin costs from referralTransactionsTable (single source, no double-count)
  const bonusCoins = referralByType.find(r => r.rewardType === "bonus")?.total ?? 0;
  const miningCommCoins = referralByType.find(r => r.rewardType === "commission")?.total ?? 0;
  const bonusUsd = bonusCoins * coinUsdRate;
  const miningCommUsd = miningCommCoins * coinUsdRate;
  const totalReferralCoins = bonusCoins + miningCommCoins;
  const totalReferralUsd = totalReferralCoins * coinUsdRate;

  const upgradeCommUsd = upgradeCommUsdRow.total ?? 0;
  const upgradeCommCoins = upgradeCommCoinsRow.total ?? 0;
  const upgradeCommCoinsUsd = upgradeCommCoins * coinUsdRate;
  const retainedUpgradeRevenue = upgradeRevenue - upgradeCommUsd;

  const totalRevenueUsd = upgradeRevenue + gameFeeUsd;
  const totalCostUsd = withdrawalsCost + totalReferralUsd + upgradeCommUsd + upgradeCommCoinsUsd;
  const netUsd = totalRevenueUsd - totalCostUsd;

  // Build monthly buckets covering last 6 months (fill empty months)
  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const months = monthKeys.map(month => {
    const getM = (type: string, status?: string) =>
      monthlyRows.filter(r => r.month === month && r.type === type && (status ? r.status === status : true))
        .reduce((s, r) => s + r.total, 0);

    const mUpgradeRev = getM("upgrade_payment", "completed");
    const mWithdrawCost = getM("withdrawal", "approved");
    const mGameCoins = getM("ludo_fee") + getM("whot_fee");
    const mGameUsd = mGameCoins * coinUsdRate;
    // Split referral payouts by type from referralTransactionsTable for this month
    const mBonusCoins = monthlyReferralRows.find(r => r.month === month && r.rewardType === "bonus")?.total ?? 0;
    const mMiningCommCoins = monthlyReferralRows.find(r => r.month === month && r.rewardType === "commission")?.total ?? 0;
    const mBonusUsd = mBonusCoins * coinUsdRate;
    const mMiningCommUsd = mMiningCommCoins * coinUsdRate;
    const mTotalRefCoins = mBonusCoins + mMiningCommCoins;
    const mTotalRefUsd = mTotalRefCoins * coinUsdRate;

    const mCommRow = monthlyCommRows.find(r => r.month === month);
    const mCommUsd = mCommRow?.commUsdt ?? 0;
    const mCommCoins = mCommRow?.commCoins ?? 0;
    const mCommCoinsUsd = mCommCoins * coinUsdRate;

    const mRevUsd = mUpgradeRev + mGameUsd;
    const mCostUsd = mWithdrawCost + mTotalRefUsd + mCommUsd + mCommCoinsUsd;
    const mNetUsd = mRevUsd - mCostUsd;

    return {
      month,
      upgradeRevenue: Math.round(mUpgradeRev * 100) / 100,
      withdrawalsCost: Math.round(mWithdrawCost * 100) / 100,
      gameFeeCoins: Math.round(mGameCoins * 100) / 100,
      gameFeeUsd: Math.round(mGameUsd * 100) / 100,
      bonusCoins: Math.round(mBonusCoins * 100) / 100,
      bonusUsd: Math.round(mBonusUsd * 100) / 100,
      miningCommCoins: Math.round(mMiningCommCoins * 100) / 100,
      miningCommUsd: Math.round(mMiningCommUsd * 100) / 100,
      totalReferralCoins: Math.round(mTotalRefCoins * 100) / 100,
      totalReferralUsd: Math.round(mTotalRefUsd * 100) / 100,
      upgradeCommUsd: Math.round(mCommUsd * 100) / 100,
      upgradeCommCoins: Math.round(mCommCoins * 100) / 100,
      totalRevenueUsd: Math.round(mRevUsd * 100) / 100,
      totalCostUsd: Math.round(mCostUsd * 100) / 100,
      netUsd: Math.round(mNetUsd * 100) / 100,
    };
  });

  // Forecast: average of last 3 complete months
  const completedMonths = months.slice(0, 5);
  const last3 = completedMonths.slice(-3);
  const avgMonthlyNetUsd = last3.length > 0
    ? last3.reduce((s, m) => s + m.netUsd, 0) / last3.length
    : 0;
  const avgMonthlyBurn = last3.length > 0
    ? last3.reduce((s, m) => s + m.totalCostUsd, 0) / last3.length
    : 0;

  let outlook: "profitable" | "breaking-even" | "at-risk";
  if (avgMonthlyNetUsd > 0.5) outlook = "profitable";
  else if (avgMonthlyNetUsd >= -0.5) outlook = "breaking-even";
  else outlook = "at-risk";

  const reserveMonths = avgMonthlyBurn > 0 && netUsd > 0
    ? Math.floor((netUsd / avgMonthlyBurn) * 10) / 10
    : null;

  res.json({
    allTime: {
      upgradeRevenue: Math.round(upgradeRevenue * 100) / 100,
      retainedUpgradeRevenue: Math.round(retainedUpgradeRevenue * 100) / 100,
      withdrawalsCost: Math.round(withdrawalsCost * 100) / 100,
      gameFeeCoins: Math.round(gameFeeCoins * 100) / 100,
      gameFeeUsd: Math.round(gameFeeUsd * 100) / 100,
      bonusCoins: Math.round(bonusCoins * 100) / 100,
      bonusUsd: Math.round(bonusUsd * 100) / 100,
      miningCommCoins: Math.round(miningCommCoins * 100) / 100,
      miningCommUsd: Math.round(miningCommUsd * 100) / 100,
      totalReferralCoins: Math.round(totalReferralCoins * 100) / 100,
      totalReferralUsd: Math.round(totalReferralUsd * 100) / 100,
      upgradeCommUsd: Math.round(upgradeCommUsd * 100) / 100,
      upgradeCommCoins: Math.round(upgradeCommCoins * 100) / 100,
      upgradeCommCoinsUsd: Math.round(upgradeCommCoinsUsd * 100) / 100,
      totalRevenueUsd: Math.round(totalRevenueUsd * 100) / 100,
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
      netUsd: Math.round(netUsd * 100) / 100,
    },
    months,
    forecast: {
      avgMonthlyNetUsd: Math.round(avgMonthlyNetUsd * 100) / 100,
      projectedNetUsd30d: Math.round(avgMonthlyNetUsd * 100) / 100,
      projectedNetUsd60d: Math.round(avgMonthlyNetUsd * 2 * 100) / 100,
      projectedNetUsd90d: Math.round(avgMonthlyNetUsd * 3 * 100) / 100,
      reserveMonths,
      outlook,
    },
    coinUsdRate,
  });
});

const AdminPushSubscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

router.get("/admin/notifications/vapid-public-key", requireAdmin, (_req, res): void => {
  const key = process.env["VAPID_PUBLIC_KEY"];
  if (!key) { res.status(503).json({ error: "Push notifications not configured" }); return; }
  res.json({ publicKey: key });
});

router.post("/admin/notifications/subscribe", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AdminPushSubscribeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid subscription object" }); return; }
  const { endpoint, keys } = parsed.data;
  const adminUserId = parseInt(process.env["ADMIN_USER_ID"] ?? "0", 10);
  await db
    .insert(pushSubscriptionsTable)
    .values({ userId: adminUserId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId: adminUserId, p256dh: keys.p256dh, auth: keys.auth },
    });
  res.json({ ok: true });
});

export default router;
