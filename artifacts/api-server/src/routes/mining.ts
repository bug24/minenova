import { Router, type IRouter } from "express";
import { db, miningSessionsTable, usersTable, transactionsTable, referralsTable, referralTransactionsTable, adminConfigTable, upgradesTable, userUpgradesTable } from "@workspace/db";
import { eq, and, isNull, desc, gt, lte, inArray } from "drizzle-orm";
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

interface EffectiveUpgrade {
  speedMultiplier: number;
  dailyCap: number | null;
}

async function getUserEffectiveUpgrade(userId: number): Promise<EffectiveUpgrade> {
  try {
    const owned = await db
      .select({ upgradeId: userUpgradesTable.upgradeId })
      .from(userUpgradesTable)
      .where(eq(userUpgradesTable.userId, userId));

    if (owned.length === 0) return { speedMultiplier: 1, dailyCap: null };

    const ids = owned.map(u => u.upgradeId);
    const [best] = await db
      .select({ hashRateBoost: upgradesTable.hashRateBoost, dailyCapBoost: upgradesTable.dailyCapBoost })
      .from(upgradesTable)
      .where(inArray(upgradesTable.id, ids))
      .orderBy(desc(upgradesTable.tier))
      .limit(1);

    if (!best) return { speedMultiplier: 1, dailyCap: null };
    return {
      speedMultiplier: 1 + (best.hashRateBoost / 100),
      dailyCap: best.dailyCapBoost ?? null,
    };
  } catch {
    return { speedMultiplier: 1, dailyCap: null };
  }
}

async function getSessionDurationMs(): Promise<number> {
  const [row] = await db.select({ value: adminConfigTable.value }).from(adminConfigTable)
    .where(eq(adminConfigTable.key, "session_duration_hours")).limit(1);
  const hours = row ? parseInt(row.value) : 12;
  return hours * 60 * 60 * 1000;
}

function computeMiningStatus(
  session: typeof miningSessionsTable.$inferSelect | null,
  user: { miningLevel: number },
  baseRate = BASE_COINS_PER_HOUR,
  speedMultiplier = 1,
  dailyCap: number | null = null,
) {
  const now = new Date();

  if (!session || !session.isActive) {
    return {
      isActive: false,
      sessionStartedAt: null,
      sessionEndsAt: null,
      accumulatedCoins: 0,
      hashRate: BASE_HASH_RATE * user.miningLevel * speedMultiplier,
      boostMultiplier: 1,
      boostEndsAt: null,
      boostsUsedToday: 0,
      boostTiersUsed: "",
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

  const coinsPerHour = baseRate * user.miningLevel * speedMultiplier * multiplier;
  const rawCoins = elapsedHours * coinsPerHour;
  const accumulatedCoins = dailyCap !== null ? Math.min(rawCoins, dailyCap) : rawCoins;

  return {
    isActive: !isComplete,
    sessionStartedAt: session.startedAt.toISOString(),
    sessionEndsAt: endsAt.toISOString(),
    accumulatedCoins: Math.round(accumulatedCoins * 100) / 100,
    hashRate: BASE_HASH_RATE * user.miningLevel * speedMultiplier * multiplier,
    boostMultiplier: multiplier,
    boostEndsAt: session.boostEndsAt ? session.boostEndsAt.toISOString() : null,
    boostsUsedToday: session.boostsUsedToday,
    boostTiersUsed: session.boostTiersUsed ?? "",
    canClaim: isComplete,
    cooldownEndsAt: null,
  };
}

router.get("/mining/status", requireAuth, async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

    // Prefer a live (unexpired) session; fall back to the oldest expired claimable session.
    let [session] = await db
      .select()
      .from(miningSessionsTable)
      .where(and(
        eq(miningSessionsTable.userId, req.userId!),
        eq(miningSessionsTable.isActive, true),
        isNull(miningSessionsTable.claimedAt),
        gt(miningSessionsTable.endsAt, now),
      ))
      .orderBy(miningSessionsTable.startedAt)
      .limit(1);

    if (!session) {
      [session] = await db
        .select()
        .from(miningSessionsTable)
        .where(and(
          eq(miningSessionsTable.userId, req.userId!),
          eq(miningSessionsTable.isActive, true),
          isNull(miningSessionsTable.claimedAt),
          lte(miningSessionsTable.endsAt, now),
        ))
        .orderBy(miningSessionsTable.startedAt)
        .limit(1);
    }

    const [baseRate, effectiveUpgrade] = await Promise.all([
      getEffectiveBaseRate(req.userId!),
      getUserEffectiveUpgrade(req.userId!),
    ]);
    res.json(GetMiningStatusResponse.parse(computeMiningStatus(session ?? null, user, baseRate, effectiveUpgrade.speedMultiplier, effectiveUpgrade.dailyCap)));
  } catch (err) {
    req.log.error({ err }, "mining/status error");
    res.status(500).json({ error: "Failed to fetch mining status" });
  }
});

router.post("/mining/start", requireAuth, async (req, res): Promise<void> => {
  try {
    if (await isMiningDisabled()) {
      res.status(403).json({ error: "Mining is currently disabled" });
      return;
    }
    if (await isMaintenanceModeEnabled()) {
      res.status(503).json({ error: "Mining is temporarily disabled for maintenance. Please try again later." });
      return;
    }

    const now = new Date();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

    // Block only on sessions that are still within their time window.
    const [liveSession] = await db
      .select()
      .from(miningSessionsTable)
      .where(and(
        eq(miningSessionsTable.userId, req.userId!),
        eq(miningSessionsTable.isActive, true),
        isNull(miningSessionsTable.claimedAt),
        gt(miningSessionsTable.endsAt, now),
      ))
      .limit(1);

    if (liveSession) {
      res.status(400).json({ error: "Mining session already active" });
      return;
    }

    // Auto-claim any expired stale sessions accumulated from past errors so the
    // user's balance is credited and the backlog is cleared before starting fresh.
    const expiredSessions = await db
      .select()
      .from(miningSessionsTable)
      .where(and(
        eq(miningSessionsTable.userId, req.userId!),
        eq(miningSessionsTable.isActive, true),
        isNull(miningSessionsTable.claimedAt),
        lte(miningSessionsTable.endsAt, now),
      ));

    if (expiredSessions.length > 0) {
      const [baseRate, effectiveUpgrade] = await Promise.all([
        getEffectiveBaseRate(req.userId!),
        getUserEffectiveUpgrade(req.userId!),
      ]);
      let totalCoins = 0;
      for (const s of expiredSessions) {
        const status = computeMiningStatus(s, user, baseRate, effectiveUpgrade.speedMultiplier, effectiveUpgrade.dailyCap);
        totalCoins += status.accumulatedCoins;
        await db
          .update(miningSessionsTable)
          .set({ claimedAt: now, isActive: false, coinsEarned: status.accumulatedCoins })
          .where(eq(miningSessionsTable.id, s.id));
      }
      if (totalCoins > 0) {
        await db
          .update(usersTable)
          .set({
            coinBalance: sql`coin_balance + ${totalCoins}`,
            totalEarned: sql`total_earned + ${totalCoins}`,
          })
          .where(eq(usersTable.id, req.userId!));
        await db.insert(transactionsTable).values({
          userId: req.userId!,
          type: "mining",
          amount: totalCoins,
          status: "completed",
          description: `Auto-claimed ${expiredSessions.length} completed mining session(s)`,
        });
      }
    }

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

    const [baseRate, effectiveUpgrade] = await Promise.all([
      getEffectiveBaseRate(req.userId!),
      getUserEffectiveUpgrade(req.userId!),
    ]);
    res.json(StartMiningResponse.parse(computeMiningStatus(session, user, baseRate, effectiveUpgrade.speedMultiplier, effectiveUpgrade.dailyCap)));
  } catch (err) {
    req.log.error({ err }, "mining/start error");
    res.status(500).json({ error: "Could not start mining. Please try again." });
  }
});

router.post("/mining/claim", requireAuth, async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

    const [session] = await db
      .select()
      .from(miningSessionsTable)
      .where(and(
        eq(miningSessionsTable.userId, req.userId!),
        eq(miningSessionsTable.isActive, true),
        isNull(miningSessionsTable.claimedAt),
      ))
      .orderBy(miningSessionsTable.startedAt)
      .limit(1);

    if (!session) {
      res.status(400).json({ error: "No active session to claim" });
      return;
    }

    if (now < new Date(session.endsAt)) {
      res.status(400).json({ error: "Mining session not complete yet" });
      return;
    }

    const [baseRate, effectiveUpgrade] = await Promise.all([
      getEffectiveBaseRate(req.userId!),
      getUserEffectiveUpgrade(req.userId!),
    ]);
    const statusData = computeMiningStatus(session, user, baseRate, effectiveUpgrade.speedMultiplier, effectiveUpgrade.dailyCap);
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
  } catch (err) {
    req.log.error({ err }, "mining/claim error");
    res.status(500).json({ error: "Could not claim mining rewards. Please try again." });
  }
});

router.post("/mining/boost", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = BoostMiningBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const now = new Date();
    const [[user], [session]] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1),
      db
        .select()
        .from(miningSessionsTable)
        .where(and(
          eq(miningSessionsTable.userId, req.userId!),
          eq(miningSessionsTable.isActive, true),
          isNull(miningSessionsTable.claimedAt),
          gt(miningSessionsTable.endsAt, now),
        ))
        .orderBy(miningSessionsTable.startedAt)
        .limit(1),
    ]);

    if (!session) {
      res.status(400).json({ error: "No active mining session" });
      return;
    }

    const boostType = parsed.data.boostType;
    const tiersUsed = (session.boostTiersUsed ?? "").split(",").filter(Boolean);

    if (tiersUsed.includes(boostType)) {
      res.status(400).json({ error: "You have already used this boost tier today" });
      return;
    }

    const boostMultiplier = boostType === "triple" ? 5 : boostType === "double" ? 3 : 2;
    const boostDurationMs =
      boostType === "triple" ? 120 * 60 * 1000
      : boostType === "double" ? 60 * 60 * 1000
      : 30 * 60 * 1000;

    const newTiersUsed = [...tiersUsed, boostType].join(",");

    await db
      .update(miningSessionsTable)
      .set({
        boostMultiplier,
        boostEndsAt: new Date(now.getTime() + boostDurationMs),
        boostsUsedToday: session.boostsUsedToday + 1,
        boostTiersUsed: newTiersUsed,
      })
      .where(eq(miningSessionsTable.id, session.id));

    const [updated] = await db.select().from(miningSessionsTable).where(eq(miningSessionsTable.id, session.id)).limit(1);
    const [baseRate, effectiveUpgrade] = await Promise.all([
      getEffectiveBaseRate(req.userId!),
      getUserEffectiveUpgrade(req.userId!),
    ]);
    res.json(BoostMiningResponse.parse(computeMiningStatus(updated, user, baseRate, effectiveUpgrade.speedMultiplier, effectiveUpgrade.dailyCap)));
  } catch (err) {
    req.log.error({ err }, "mining/boost error");
    res.status(500).json({ error: "Could not apply boost. Please try again." });
  }
});

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

    const [totalUsersResult] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
    const [totalCoinsResult] = await db.select({ sum: sql<number>`coalesce(sum(total_earned), 0)` }).from(usersTable);
    const [activeSessionsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(miningSessionsTable).where(and(eq(miningSessionsTable.isActive, true), gt(miningSessionsTable.endsAt, new Date())));

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
  } catch (err) {
    req.log.error({ err }, "dashboard/summary error");
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

export default router;
