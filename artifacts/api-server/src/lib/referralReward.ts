import { db, usersTable, referralEarningsTable, referralTransactionsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

const COINS_PER_USDT = 1000;

const TIER_RATES: Record<number, number> = {
  1: 0.10,
  2: 0.03,
  3: 0.01,
};

const COIN_SPLIT = 0.70;
const USDT_SPLIT = 0.30;

const DAILY_CAP_USDT = 50;
const UNLOCK_DAYS = 7;

// NOTE: Daily-cap enforcement uses a read-then-write pattern per tier.
// Under high concurrency, simultaneous purchases can transiently exceed the cap
// by up to (TIER_RATES[1] * upgradeValue) per concurrent request. For typical
// upgrade volumes this is an acceptable tradeoff; add a pg_advisory_xact_lock
// or atomic upsert if strict cap enforcement under concurrency is required.
//
// NOTE: The unique index on (referred_id, upgrade_id, tier) assumes each
// referred user purchases each upgrade at most once. If repeat purchases of the
// same upgrade are introduced, the index must include a purchase transaction id
// (e.g., source_transaction_id) to scope idempotency per purchase event.

interface RewardParams {
  referredUserId: number;
  upgradeId: number;
  upgradeUsdtValue: number;
}

async function getDailyEarnedUsdt(referrerId: number): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(reward_locked_usdt + (reward_coins / ${COINS_PER_USDT})), 0)` })
    .from(referralEarningsTable)
    .where(
      and(
        eq(referralEarningsTable.referrerId, referrerId),
        gte(referralEarningsTable.createdAt, startOfDay),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function triggerUpgradeReferralReward(params: RewardParams): Promise<void> {
  const { referredUserId, upgradeId, upgradeUsdtValue } = params;

  if (upgradeUsdtValue <= 0) return;

  let currentUserId = referredUserId;

  for (let tier = 1; tier <= 3; tier++) {
    const [currentUser] = await db
      .select({ id: usersTable.id, referredBy: usersTable.referredBy })
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);

    if (!currentUser?.referredBy) break;

    const referrerId = currentUser.referredBy;

    if (referrerId === referredUserId) {
      logger.warn({ referrerId, referredUserId }, "Self-referral detected in reward chain — skipping");
      break;
    }

    const rate = TIER_RATES[tier] ?? 0;
    const grossRewardUsdt = upgradeUsdtValue * rate;

    const dailyEarned = await getDailyEarnedUsdt(referrerId);
    const remaining = DAILY_CAP_USDT - dailyEarned;
    if (remaining <= 0) {
      logger.info({ referrerId, tier, dailyEarned }, "Daily referral cap reached — skipping tier reward");
      currentUserId = referrerId;
      continue;
    }

    const rewardUsdt = Math.min(grossRewardUsdt, remaining);
    const rewardCoins = Math.round(rewardUsdt * COIN_SPLIT * COINS_PER_USDT * 100) / 100;
    const rewardLockedUsdt = Math.round(rewardUsdt * USDT_SPLIT * 1000) / 1000;

    const unlockDate = new Date();
    unlockDate.setDate(unlockDate.getDate() + UNLOCK_DAYS);

    await db.transaction(async (tx) => {
      // onConflictDoNothing uses the unique index (referred_id, upgrade_id, tier)
      // — safe to retry: already-processed tiers are skipped without error so
      // remaining tiers in the chain can still be credited.
      const inserted = await tx.insert(referralEarningsTable).values({
        referrerId,
        referredId: referredUserId,
        upgradeId,
        tier,
        rewardCoins,
        rewardLockedUsdt,
        status: "locked",
        unlockDate,
      }).onConflictDoNothing().returning({ id: referralEarningsTable.id });

      if (inserted.length === 0) {
        // Row already exists for this (referred, upgrade, tier) tuple — skip.
        return;
      }

      await tx
        .update(usersTable)
        .set({
          coinBalance: sql`coin_balance + ${rewardCoins}`,
          totalEarned: sql`total_earned + ${rewardCoins}`,
          lockedUsdtBalance: sql`locked_usdt_balance + ${rewardLockedUsdt}`,
        })
        .where(eq(usersTable.id, referrerId));

      await tx.insert(referralTransactionsTable).values({
        referrerId,
        referredId: referredUserId,
        rewardType: "upgrade_commission",
        amount: rewardCoins,
      });
    });

    logger.info(
      { referrerId, referredUserId, upgradeId, tier, rewardCoins, rewardLockedUsdt },
      "Referral upgrade reward credited",
    );

    currentUserId = referrerId;
  }
}
