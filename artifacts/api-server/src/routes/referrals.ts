import { Router, type IRouter } from "express";
import { db, referralsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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
      createdAt: referralsTable.createdAt,
    })
    .from(referralsTable)
    .where(and(eq(referralsTable.referrerId, req.userId!), eq(referralsTable.tier, 1)));

  const referredUserIds = tier1Refs.map(r => r.referredId).filter(id => id > 0);

  const referredUsersData = referredUserIds.length > 0
    ? await db
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, referredUserIds[0]))
    : [];

  const usernameMap = new Map(referredUsersData.map(u => [u.id, u.username]));

  const referralsList = tier1Refs.map(r => ({
    id: r.id,
    username: usernameMap.get(r.referredId) ?? "unknown",
    tier: 1,
    earnedFromUser: r.earnedFromUser,
    joinedAt: r.createdAt.toISOString(),
  }));

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  res.json(GetReferralsResponse.parse({
    referralCode: user.referralCode,
    referralLink: `${baseUrl}/?ref=${user.referralCode}`,
    totalReferrals: referralsList.length,
    totalEarnedFromReferrals: referralsList.reduce((sum, r) => sum + r.earnedFromUser, 0),
    tier1Count: referralsList.filter(r => r.tier === 1).length,
    tier2Count: 0,
    referrals: referralsList,
  }));
});

export default router;
