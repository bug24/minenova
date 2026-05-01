import { Router, type IRouter } from "express";
import { db, referralsTable, usersTable, referralTransactionsTable, referralEarningsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { GetReferralsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/referrals", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const tier1Refs = await db
    .select({
      id: referralsTable.id,
      referredId: referralsTable.referredId,
      earnedFromUser: referralsTable.totalEarned,
      bonusPaid: referralsTable.bonusPaid,
      createdAt: referralsTable.createdAt,
    })
    .from(referralsTable)
    .where(and(eq(referralsTable.referrerId, req.userId!), eq(referralsTable.tier, 1)));

  const referredUserIds = tier1Refs.map(r => r.referredId).filter(id => id > 0);

  let referredUsersData: { id: number; username: string }[] = [];
  if (referredUserIds.length > 0) {
    referredUsersData = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(referredUserIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
  }

  const usernameMap = new Map(referredUsersData.map(u => [u.id, u.username]));

  const referralsList = tier1Refs.map(r => ({
    id: r.id,
    username: usernameMap.get(r.referredId) ?? "unknown",
    tier: 1,
    earnedFromUser: r.earnedFromUser,
    bonusPaid: r.bonusPaid,
    joinedAt: r.createdAt.toISOString(),
  }));

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  res.json(GetReferralsResponse.parse({
    referralCode: user.referralCode,
    referralLink: `${baseUrl}/?ref=${user.referralCode}`,
    totalReferrals: referralsList.length,
    totalEarnedFromReferrals: referralsList.reduce((sum, r) => sum + r.earnedFromUser, 0),
    tier1Count: referralsList.length,
    tier2Count: 0,
    referrals: referralsList,
  }));
});

router.get("/referrals/earnings", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [earnings, [currentUser]] = await Promise.all([
    db
      .select()
      .from(referralEarningsTable)
      .where(eq(referralEarningsTable.referrerId, userId))
      .orderBy(desc(referralEarningsTable.createdAt)),
    db
      .select({ usdtBalance: usersTable.usdtBalance, lockedUsdtBalance: usersTable.lockedUsdtBalance })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1),
  ]);

  const referredIds = [...new Set(earnings.map(e => e.referredId))];
  let usernameMap = new Map<number, string>();
  if (referredIds.length > 0) {
    const users = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(sql`${usersTable.id} = ANY(ARRAY[${sql.join(referredIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
    usernameMap = new Map(users.map(u => [u.id, u.username]));
  }

  const totalCoinsEarned = earnings.reduce((s, e) => s + e.rewardCoins, 0);
  const totalLockedUsdt = earnings.filter(e => e.status === "locked").reduce((s, e) => s + e.rewardLockedUsdt, 0);
  const totalUnlockedUsdt = earnings.filter(e => e.status === "unlocked").reduce((s, e) => s + e.rewardLockedUsdt, 0);

  // withdrawableUsdt comes from the user's actual usdt_balance (not the
  // historical sum), so it correctly reflects withdrawals already made.
  const withdrawableUsdt = Math.round((currentUser?.usdtBalance ?? 0) * 1000) / 1000;

  res.json({
    totalCoinsEarned: Math.round(totalCoinsEarned * 100) / 100,
    totalLockedUsdt: Math.round(totalLockedUsdt * 1000) / 1000,
    totalUnlockedUsdt: Math.round(totalUnlockedUsdt * 1000) / 1000,
    withdrawableUsdt,
    earnings: earnings.map(e => ({
      id: e.id,
      referredUsername: usernameMap.get(e.referredId) ?? `#${e.referredId}`,
      upgradeId: e.upgradeId,
      tier: e.tier,
      rewardCoins: e.rewardCoins,
      rewardLockedUsdt: e.rewardLockedUsdt,
      status: e.status,
      unlockDate: e.unlockDate.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

router.get("/referrals/stats", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const allReferrals = await db
    .select({ referredId: referralsTable.referredId, tier: referralsTable.tier })
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, userId));

  const level1Count = allReferrals.filter(r => r.tier === 1).length;
  const level2Count = allReferrals.filter(r => r.tier === 2).length;
  const level3Count = allReferrals.filter(r => r.tier === 3).length;
  const referralCount = level1Count;

  const [earningsAgg] = await db
    .select({
      totalCoins: sql<number>`coalesce(sum(reward_coins), 0)`,
      totalUsdt: sql<number>`coalesce(sum(reward_locked_usdt), 0)`,
    })
    .from(referralEarningsTable)
    .where(eq(referralEarningsTable.referrerId, userId));

  const [commissionAgg] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(referralTransactionsTable)
    .where(eq(referralTransactionsTable.referrerId, userId));

  const totalCoinsFromUpgrades = Number(earningsAgg?.totalCoins ?? 0);
  const totalUsdtFromUpgrades = Number(earningsAgg?.totalUsdt ?? 0);
  const totalRewardsEarned = Number(commissionAgg?.total ?? 0);

  res.json({
    referralCount,
    level1Count,
    level2Count,
    level3Count,
    totalRewardsEarned: Math.round(totalRewardsEarned * 100) / 100,
    totalCoinsFromUpgrades: Math.round(totalCoinsFromUpgrades * 100) / 100,
    totalUsdtFromUpgrades: Math.round(totalUsdtFromUpgrades * 1000) / 1000,
  });
});

export default router;
