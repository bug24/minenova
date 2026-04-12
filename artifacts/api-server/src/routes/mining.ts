import { Router, type IRouter } from "express";
import { db, miningSessionsTable, usersTable, transactionsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { BoostMiningBody, GetMiningStatusResponse, StartMiningResponse, ClaimMiningResponse, BoostMiningResponse, GetDashboardSummaryResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const BASE_HASH_RATE = 10;
const BASE_COINS_PER_HOUR = 0.5;

function computeMiningStatus(session: typeof miningSessionsTable.$inferSelect | null, user: { miningLevel: number }) {
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

  const coinsPerHour = BASE_COINS_PER_HOUR * user.miningLevel * multiplier;
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

  res.json(GetMiningStatusResponse.parse(computeMiningStatus(session ?? null, user)));
});

router.post("/mining/start", requireAuth, async (req, res): Promise<void> => {
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
  const endsAt = new Date(now.getTime() + SESSION_DURATION_MS);

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

  res.json(StartMiningResponse.parse(computeMiningStatus(session, user)));
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

  const statusData = computeMiningStatus(session, user);
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
  const boostMultiplier = boostType === "triple" ? 5 : 2;
  const boostDurationMs = 30 * 60 * 1000;

  await db
    .update(miningSessionsTable)
    .set({
      boostMultiplier,
      boostEndsAt: new Date(now.getTime() + boostDurationMs),
      boostsUsedToday: session.boostsUsedToday + 1,
    })
    .where(eq(miningSessionsTable.id, session.id));

  const [updated] = await db.select().from(miningSessionsTable).where(eq(miningSessionsTable.id, session.id)).limit(1);

  res.json(BoostMiningResponse.parse(computeMiningStatus(updated, user)));
});

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const [totalUsersResult] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
  const [totalCoinsResult] = await db.select({ sum: sql<number>`coalesce(sum(total_earned), 0)` }).from(usersTable);
  const [activeSessionsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(miningSessionsTable).where(eq(miningSessionsTable.isActive, true));

  const { referralsTable } = await import("@workspace/db");
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
