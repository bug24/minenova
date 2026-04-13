import { Router, type IRouter } from "express";
import {
  db,
  shareMessagesTable,
  adminConfigTable,
  usersTable,
  transactionsTable,
  miningSessionsTable,
  referralsTable,
  upgradesTable,
  userUpgradesTable,
} from "@workspace/db";
import { eq, and, isNull, or, ilike, sql, desc, type SQL } from "drizzle-orm";
import { z } from "zod";

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

seedAdminConfig().catch(console.error);
seedDefaultMessages().catch(console.error);

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

  res.json({
    totalUsers: totalUsersRow.count,
    activeMiners: activeMinersRow.count,
    totalCoinsDistributed: Math.round((coinsRow.sum ?? 0) * 100) / 100,
    totalUsdtWithdrawn: Math.round((withdrawnRow.sum ?? 0) * 100) / 100,
    totalReferralPayout: Math.round((refPayoutRow.sum ?? 0) * 100) / 100,
    pendingWithdrawals: pendingRow.count,
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

router.get("/admin/withdrawals", requireAdmin, async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;
  const conditions = [eq(transactionsTable.type, "withdrawal")];
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    conditions.push(eq(transactionsTable.status, status));
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

router.post("/admin/withdrawals/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const schema = z.object({ adminNote: z.string().optional() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [tx] = await db.select().from(transactionsTable).where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "withdrawal"))).limit(1);
  if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.status !== "pending") { res.status(400).json({ error: "Only pending withdrawals can be approved" }); return; }

  await db.update(transactionsTable).set({ status: "approved", adminNote: data.data.adminNote ?? null }).where(eq(transactionsTable.id, id));
  res.json({ success: true });
});

router.post("/admin/withdrawals/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const schema = z.object({ adminNote: z.string().optional() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [tx] = await db.select().from(transactionsTable).where(and(eq(transactionsTable.id, id), eq(transactionsTable.type, "withdrawal"))).limit(1);
  if (!tx) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (tx.status !== "pending") { res.status(400).json({ error: "Only pending withdrawals can be rejected" }); return; }

  const refundCoins = tx.amount * COINS_PER_USDT;
  await db.update(usersTable).set({ coinBalance: sql`coin_balance + ${refundCoins}`, totalWithdrawn: sql`total_withdrawn - ${tx.amount}` }).where(eq(usersTable.id, tx.userId));
  await db.update(transactionsTable).set({ status: "rejected", adminNote: data.data.adminNote ?? null }).where(eq(transactionsTable.id, id));
  await db.insert(transactionsTable).values({
    userId: tx.userId,
    type: "adjustment",
    amount: refundCoins,
    status: "completed",
    description: `Refund for rejected withdrawal #${id}`,
  });

  res.json({ success: true });
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
    })
    .from(miningSessionsTable)
    .leftJoin(usersTable, eq(miningSessionsTable.userId, usersTable.id))
    .where(and(eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .orderBy(desc(miningSessionsTable.startedAt));

  res.json(rows.map(r => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
  })));
});

router.post("/admin/mining-sessions/:id/stop", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.update(miningSessionsTable).set({ isActive: false, claimedAt: new Date() }).where(eq(miningSessionsTable.id, id));
  res.json({ success: true });
});

// ─── Referrals ────────────────────────────────────────────────────────────────

router.get("/admin/referrals", requireAdmin, async (_req, res): Promise<void> => {
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

  const userMap: Record<number, string> = {};
  const allUsers = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable);
  for (const u of allUsers) userMap[u.id] = u.username;

  res.json(rows.map(r => ({
    ...r,
    referrerUsername: userMap[r.referrerId] ?? `#${r.referrerId}`,
    referredUsername: userMap[r.referredId] ?? `#${r.referredId}`,
    createdAt: r.createdAt.toISOString(),
  })));
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
  const keys = ["min_withdrawal_usdt", "referral_bonus_coins", "referral_commission_pct", "maintenance_mode"];
  const rows = await db.select().from(adminConfigTable).where(sql`key = ANY(ARRAY[${sql.join(keys.map(k => sql`${k}`), sql`, `)}])`);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    min_withdrawal_usdt: z.string().optional(),
    referral_bonus_coins: z.string().optional(),
    referral_commission_pct: z.string().optional(),
    maintenance_mode: z.string().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: "Invalid input" }); return; }
  for (const [key, value] of Object.entries(data.data)) {
    if (value !== undefined) await upsertSetting(key, value);
  }
  res.json({ success: true });
});

export default router;
