import { Router, type IRouter } from "express";
import { db, usersTable, referralsTable, transactionsTable, adminConfigTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { GetLeaderboardResponse, GetActivityFeedResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leaderboard", requireAuth, async (req, res): Promise<void> => {
  const topUsers = await db
    .select()
    .from(usersTable)
    .orderBy(sql`total_earned desc`)
    .limit(50);

  const referralCounts = await db
    .select({
      referrerId: referralsTable.referrerId,
      count: sql<number>`count(*)::int`,
    })
    .from(referralsTable)
    .groupBy(referralsTable.referrerId);

  const refMap = new Map(referralCounts.map(r => [r.referrerId, r.count]));

  const entries = topUsers.map((u, i) => ({
    rank: i + 1,
    username: u.username,
    totalEarned: u.totalEarned,
    miningLevel: u.miningLevel,
    referralCount: refMap.get(u.id) ?? 0,
  }));

  res.json(GetLeaderboardResponse.parse(entries));
});

router.get("/activity/feed", async (req, res): Promise<void> => {
  const recent = await db
    .select({
      id: transactionsTable.id,
      userId: transactionsTable.userId,
      amount: transactionsTable.amount,
      type: transactionsTable.type,
      createdAt: transactionsTable.createdAt,
    })
    .from(transactionsTable)
    .where(eq(transactionsTable.type, "withdrawal"))
    .orderBy(sql`created_at desc`)
    .limit(20);

  const userIds = [...new Set(recent.map(t => t.userId))];
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable).where(eq(usersTable.id, userIds[0]))
    : [];
  const usernameMap = new Map(users.map(u => [u.id, u.username]));

  const items = recent.map(t => ({
    id: t.id,
    username: usernameMap.get(t.userId) ?? "anonymous",
    amount: t.amount,
    action: "withdrew",
    createdAt: t.createdAt.toISOString(),
  }));

  res.json(GetActivityFeedResponse.parse(items));
});

// Public display settings (no auth required)
router.get("/app-settings", async (_req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "withdrawal_ticker_enabled"))
    .limit(1);
  // Default to enabled when the key hasn't been set yet
  const enabled = row ? row.value !== "false" : true;
  res.json({ withdrawalTickerEnabled: enabled });
});

export default router;
