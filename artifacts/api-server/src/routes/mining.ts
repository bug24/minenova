import { Router, type IRouter } from "express";
import { db, miningSessionsTable, usersTable, transactionsTable, referralsTable, referralTransactionsTable, adminConfigTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { BoostMiningBody, GetMiningStatusResponse, StartMiningResponse, ClaimMiningResponse, BoostMiningResponse, GetDashboardSummaryResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";

async function isMaintenanceModeEnabled(): Promise<boolean> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable).where(eq(adminConfigTable.key, "maintenance_mode")).limit(1);
  return row?.value === "true";
}

async function isMiningDisabled(): Promise<boolean> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable).where(eq(adminConfigTable.key, "mining_disabled")).limit(1);
  return row?.value === "true";
}

async function isReferralDisabled(): Promise<boolean> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable).where(eq(adminConfigTable.key, "referral_disabled")).limit(1);
  return row?.value === "true";
}

async function getReferralBonusCoins(): Promise<number> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable).where(eq(adminConfigTable.key, "referral_bonus_coins")).limit(1);
  return row ? parseFloat(row.value) : REFERRAL_BONUS_COINS;
}

async function getReferralCommissionRate(): Promise<number> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable).where(eq(adminConfigTable.key, "referral_commission_pct")).limit(1);
  return row ? parseFloat(row.value) / 100 : REFERRAL_COMMISSION_RATE;
}

const router: IRouter = Router();

const BASE_HASH_RATE = 10;
const BASE_COINS_PER_HOUR = 0.5;

const REFERRAL_BONUS_COINS = 250;
const REFERRAL_COMMISSION_RATE = 0.07;

async function getEffectiveBaseRate(userId: number): Promise<number> {
  const [userOverride] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, `user_rate_override_${userId}`)).limit(1);
  if (userOverride) return parseFloat(userOverride.value);
  const [globalRate] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "global_base_coins_per_hour")).limit(1);
  return globalRate ? parseFloat(globalRate.value) : BASE_COINS_PER_HOUR;
}

async function getSessionDurationMs(): Promise<number> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "session_duration_hours")).limit(1);
  const hours = row ? parseInt(row.value) : 12;
  return hours * 60 * 60 * 1000;
}

function computeMiningStatus(session: typeof miningSessionsTable.$inferSelect | null, user: { miningLevel: number }, baseRate = BASE_COINS_PER_HOUR) {
  const now = new Date();

  if (!session || !session.isActive) {
    return {
      isActive: false,
      sessionStartedAt: null,
      sessionEndsAt: null,
      accumulatedCoins: 0,
      hashRate: BASE_HASH_RATE * user.miningLevel,
      boostMultiplier: 1,
      boostEndsAt: null,
      boostsUsedToday: 0,
      canClaim: false,
      cooldownEndsAt: null,
    };
  }

  const endsAt = new Date(session.endsAt);
  const isComplete = now >= endsAt;
  const elapsedMs = Math.min(now.getTime() - session.startedAt.getTime(), endsAt.getTime() - session.startedAt.getTime());
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  const boostActive = session.boostEndsAt && now < new Date(session.boostEndsAt);
  const multiplier = boostActive ? session.boostMultiplier : 1;

  const coinsPerHour = baseRate * user.miningLevel * multiplier;
  const accumulatedCoins = elapsedHours * coinsPerHour;

  return {
    isActive: !isComplete,
    sessionStartedAt: session.startedAt.toISOString(),
    sessionEndsAt: endsAt.toISOString(),
    accumulatedCoins: Math.round(accumulatedCoins * 100) / 100,
    hashRate: BASE_HASH_RATE * user.miningLevel * multiplier,
    boostMultiplier: multiplier,
    boostEndsAt: session.boostEndsAt ? session.boostEndsAt.toISOString() : null,
    boostsUsedToday: session.boostsUsedToday,
    canClaim: isComplete,
    cooldownEndsAt: null,
  };
}

router.get("/mining/status", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  const [session] = await db
    .select()
    .from(miningSessionsTable)
    .where(and(eq(miningSessionsTable.userId, req.userId!), eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .orderBy(miningSessionsTable.startedAt)
    .limit(1);

  const baseRate = await getEffectiveBaseRate(req.userId!);
  res.json(GetMiningStatusResponse.parse(computeMiningStatus(session ?? null, user, baseRate)));
});

router.post("/mining/start", requireAuth, async (req, res): Promise<void> => {
  if (await isMiningDisabled()) {
    res.status(403).json({ error: "Mining is currently disabled" });
    return;
  }
  if (await isMaintenanceModeEnabled()) {
    res.status(503).json({ error: "Mining is temporarily disabled for maintenance. Please try again later." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const [activeSession] = await db
    .select()
    .from(miningSessionsTable)
    .where(and(eq(miningSessionsTable.userId, req.userId!), eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .limit(1);

  if (activeSession) {
    const now = new Date();
    if (now < new Date(activeSession.endsAt)) {
      res.status(400).json({ error: "Mining session already active" });
      return;
    }
  }

  const now = new Date();
  const sessionDurationMs = await getSessionDurationMs();
  const endsAt = new Date(now.getTime() + sessionDurationMs);

  const [session] = await db
    .insert(miningSessionsTable)
    .values({
      userId: req.userId!,
      startedAt: now,
      endsAt,
      hashRate: BASE_HASH_RATE * user.miningLevel,
      boostMultiplier: 1,
      boostsUsedToday: 0,
      isActive: true,
    })
    .returning();

  if (!(await isReferralDisabled())) {
    const [referralRecord] = await db
      .select()
      .from(referralsTable)
      .where(and(eq(referralsTable.referredId, req.userId!), eq(referralsTable.bonusPaid, false)))
      .limit(1);

    if (referralRecord) {
      const bonusCoins = await getReferralBonusCoins();

      await db
        .update(usersTable)
        .set({ coinBalance: sql`coin_balance + ${bonusCoins}`, totalEarned: sql`total_earned + ${bonusCoins}` })
        .where(eq(usersTable.id, referralRecord.referrerId));

      await db
        .update(referralsTable)
        .set({ bonusPaid: true, totalEarned: sql`total_earned + ${bonusCoins}` })
        .where(eq(referralsTable.id, referralRecord.id));

      await db.insert(referralTransactionsTable).values({
        referrerId: referralRecord.referrerId,
        referredId: req.userId!,
        rewardType: "bonus",
        amount: bonusCoins,
      });

      await db.insert(transactionsTable).values({
        userId: referralRecord.referrerId,
        type: "referral",
        amount: bonusCoins,
        status: "completed",
        description: `Referral activation bonus for user #${req.userId}`,
      });
    }
  }

  const baseRate = await getEffectiveBaseRate(req.userId!);
  res.json(StartMiningResponse.parse(computeMiningStatus(session, user, baseRate)));
});

router.post("/mining/claim", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const [session] = await db
    .select()
    .from(miningSessionsTable)
    .where(and(eq(miningSessionsTable.userId, req.userId!), eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .orderBy(miningSessionsTable.startedAt)
    .limit(1);

  if (!session) {
    res.status(400).json({ error: "No active session to claim" });
    return;
  }

  const now = new Date();
  if (now < new Date(session.endsAt)) {
    res.status(400).json({ error: "Mining session not complete yet" });
    return;
  }

  const baseRate = await getEffectiveBaseRate(req.userId!);
  const statusData = computeMiningStatus(session, user, baseRate);
  const coinsEarned = statusData.accumulatedCoins;

  await db
    .update(miningSessionsTable)
    .set({ claimedAt: now, isActive: false, coinsEarned })
    .where(eq(miningSessionsTable.id, session.id));

  const newBalance = user.coinBalance + coinsEarned;
  const newTotalEarned = user.totalEarned + coinsEarned;

  await db
    .update(usersTable)
    .set({ coinBalance: newBalance, totalEarned: newTotalEarned })
    .where(eq(usersTable.id, req.userId!));

  await db.insert(transactionsTable).values({
    userId: req.userId!,
    type: "mining",
    amount: coinsEarned,
    status: "completed",
    description: "Mining session reward",
  });

  if (!(await isReferralDisabled())) {
    const [referralRecord] = await db
      .select()
      .from(referralsTable)
      .where(eq(referralsTable.referredId, req.userId!))
      .limit(1);

    if (referralRecord) {
      const commissionRate = await getReferralCommissionRate();
      const commissionCoins = Math.round(coinsEarned * commissionRate * 100) / 100;

      if (commissionCoins > 0) {
        await db
          .update(usersTable)
          .set({ coinBalance: sql`coin_balance + ${commissionCoins}`, totalEarned: sql`total_earned + ${commissionCoins}` })
          .where(eq(usersTable.id, referralRecord.referrerId));

        await db
          .update(referralsTable)
          .set({ totalEarned: sql`total_earned + ${commissionCoins}` })
          .where(eq(referralsTable.id, referralRecord.id));

        await db.insert(referralTransactionsTable).values({
          referrerId: referralRecord.referrerId,
          referredId: req.userId!,
          rewardType: "commission",
          amount: commissionCoins,
        });

        await db.insert(transactionsTable).values({
          userId: referralRecord.referrerId,
          type: "referral",
          amount: commissionCoins,
          status: "completed",
          description: `${Math.round(commissionRate * 100)}% mining commission from user #${req.userId}`,
        });
      }
    }
  }

  res.json(ClaimMiningResponse.parse({
    coinsEarned,
    newBalance,
    message: `Claimed ${coinsEarned.toFixed(2)} coins!`,
  }));
});

router.post("/mining/boost", requireAuth, async (req, res): Promise<void> => {
  const parsed = BoostMiningBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const [session] = await db
    .select()
    .from(miningSessionsTable)
    .where(and(eq(miningSessionsTable.userId, req.userId!), eq(miningSessionsTable.isActive, true), isNull(miningSessionsTable.claimedAt)))
    .orderBy(miningSessionsTable.startedAt)
    .limit(1);

  if (!session) {
    res.status(400).json({ error: "No active mining session" });
    return;
  }

  if (session.boostsUsedToday >= 3) {
    res.status(400).json({ error: "Daily boost limit reached" });
    return;
  }

  const now = new Date();
  const boostType = parsed.data.boostType;
  const boostMultiplier = boostType === "triple" ? 5 : boostType === "double" ? 3 : 2;
  const boostDurationMs =
    boostType === "triple" ? 120 * 60 * 1000
    : boostType === "double" ? 60 * 60 * 1000
    : 30 * 60 * 1000;

  await db
    .update(miningSessionsTable)
    .set({
      boostMultiplier,
      boostEndsAt: new Date(now.getTime() + boostDurationMs),
      boostsUsedToday: session.boostsUsedToday + 1,
    })
    .where(eq(miningSessionsTable.id, session.id));

  const [updated] = await db.select().from(miningSessionsTable).where(eq(miningSessionsTable.id, session.id)).limit(1);
  const baseRate = await getEffectiveBaseRate(req.userId!);
  res.json(BoostMiningResponse.parse(computeMiningStatus(updated, user, baseRate)));
});

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const [totalUsersResult] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  const [totalCoinsResult] = await db.select({ sum: sql<number>`coalesce(sum(total_earned), 0)` }).from(usersTable);
  const [activeSessionsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(miningSessionsTable).where(eq(miningSessionsTable.isActive, true));

  const [refCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, req.userId!));

  const allUsers = await db.select({ id: usersTable.id, totalEarned: usersTable.totalEarned }).from(usersTable).orderBy(sql`total_earned desc`);
  const myRank = allUsers.findIndex(u => u.id === req.userId!) + 1;

  res.json(GetDashboardSummaryResponse.parse({
    totalUsers: totalUsersResult.count,
    totalCoinsDistributed: Math.round((totalCoinsResult.sum ?? 0) * 100) / 100,
    activeSessions: activeSessionsResult.count,
    myRank: myRank > 0 ? myRank : null,
    myTotalEarned: user.totalEarned,
    myReferralCount: refCountResult.count,
    myMiningLevel: user.miningLevel,
  }));
});

export default router;
