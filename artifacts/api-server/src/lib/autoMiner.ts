import {
  db, usersTable, miningSessionsTable, adminConfigTable,
  transactionsTable, upgradesTable, userUpgradesTable,
} from "@workspace/db";
import { eq, and, isNull, lte, gt, desc, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";

const BASE_HASH_RATE = 10;
const BASE_COINS_PER_HOUR = 0.5;
const DEFAULT_INTERVAL_MINUTES = 15;

// ── Config helpers ─────────────────────────────────────────────────────────

async function getIntervalMinutes(): Promise<number> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "auto_miner_interval_minutes"))
    .limit(1);
  const parsed = row ? parseInt(row.value) : NaN;
  return isNaN(parsed) || parsed < 1 ? DEFAULT_INTERVAL_MINUTES : parsed;
}

async function getSessionDurationMs(): Promise<number> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "session_duration_hours"))
    .limit(1);
  const hours = row ? parseInt(row.value) : 12;
  return hours * 60 * 60 * 1000;
}

async function getEffectiveBaseRate(userId: number): Promise<number> {
  const [override] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, `user_rate_override_${userId}`))
    .limit(1);
  if (override) return parseFloat(override.value);
  const [global] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "global_base_coins_per_hour"))
    .limit(1);
  return global ? parseFloat(global.value) : BASE_COINS_PER_HOUR;
}

async function getUserSpeedAndCap(userId: number): Promise<{ speedMultiplier: number; dailyCap: number | null }> {
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
    speedMultiplier: 1 + best.hashRateBoost / 100,
    dailyCap: best.dailyCapBoost ?? null,
  };
}

// ── Core auto-miner run ────────────────────────────────────────────────────

async function isMiningDisabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "mining_disabled"))
    .limit(1);
  return row?.value === "true";
}

async function runAutoMiner(): Promise<void> {
  if (await isMiningDisabled()) {
    logger.info("auto-miner: mining disabled — skipping run");
    return;
  }

  // Find all users who own an auto-mining upgrade
  const autoUpgradeIds = await db
    .select({ id: upgradesTable.id })
    .from(upgradesTable)
    .where(eq(upgradesTable.isAutoMining, true));

  if (autoUpgradeIds.length === 0) return;

  const upgradeIdSet = autoUpgradeIds.map(u => u.id);

  const autoMinerUsers = await db
    .selectDistinct({ userId: userUpgradesTable.userId })
    .from(userUpgradesTable)
    .where(inArray(userUpgradesTable.upgradeId, upgradeIdSet));

  if (autoMinerUsers.length === 0) return;

  const userIds = autoMinerUsers.map(u => u.userId);
  const users = await db
    .select({ id: usersTable.id, miningLevel: usersTable.miningLevel })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));

  const now = new Date();
  const sessionDurationMs = await getSessionDurationMs();
  let restarted = 0;

  for (const user of users) {
    try {
      // Skip users who already have a live session
      const [live] = await db
        .select({ id: miningSessionsTable.id })
        .from(miningSessionsTable)
        .where(and(
          eq(miningSessionsTable.userId, user.id),
          eq(miningSessionsTable.isActive, true),
          isNull(miningSessionsTable.claimedAt),
          gt(miningSessionsTable.endsAt, now),
        ))
        .limit(1);

      if (live) continue;

      // Claim any expired unclaimed sessions
      const expired = await db
        .select()
        .from(miningSessionsTable)
        .where(and(
          eq(miningSessionsTable.userId, user.id),
          eq(miningSessionsTable.isActive, true),
          isNull(miningSessionsTable.claimedAt),
          lte(miningSessionsTable.endsAt, now),
        ));

      if (expired.length > 0) {
        const [baseRate, { speedMultiplier, dailyCap }] = await Promise.all([
          getEffectiveBaseRate(user.id),
          getUserSpeedAndCap(user.id),
        ]);

        let totalCoins = 0;
        for (const s of expired) {
          const endsAt = new Date(s.endsAt);
          const elapsedMs = Math.min(
            now.getTime() - s.startedAt.getTime(),
            endsAt.getTime() - s.startedAt.getTime(),
          );
          const elapsedHours = elapsedMs / 3_600_000;
          const boostActive = s.boostEndsAt && now < new Date(s.boostEndsAt);
          const mult = boostActive ? s.boostMultiplier : 1;
          const coinsPerHour = baseRate * user.miningLevel * speedMultiplier * mult;
          const raw = elapsedHours * coinsPerHour;
          const coins = Math.round((dailyCap !== null ? Math.min(raw, dailyCap) : raw) * 100) / 100;
          totalCoins += coins;
          await db
            .update(miningSessionsTable)
            .set({ claimedAt: now, isActive: false, coinsEarned: coins })
            .where(eq(miningSessionsTable.id, s.id));
        }

        if (totalCoins > 0) {
          await db
            .update(usersTable)
            .set({
              coinBalance: sql`coin_balance + ${totalCoins}`,
              totalEarned: sql`total_earned + ${totalCoins}`,
            })
            .where(eq(usersTable.id, user.id));
          await db.insert(transactionsTable).values({
            userId: user.id,
            type: "mining",
            amount: totalCoins,
            status: "completed",
            description: `Auto-miner: claimed ${expired.length} session(s) (${totalCoins.toFixed(2)} coins)`,
          });
        }
      }

      // Start a fresh session
      const endsAt = new Date(now.getTime() + sessionDurationMs);
      await db.insert(miningSessionsTable).values({
        userId: user.id,
        startedAt: now,
        endsAt,
        hashRate: BASE_HASH_RATE * user.miningLevel,
        boostMultiplier: 1,
        boostsUsedToday: 0,
        isActive: true,
      });
      restarted++;
    } catch (err) {
      logger.error({ err, userId: user.id }, "auto-miner: error processing user");
    }
  }

  if (restarted > 0) {
    logger.info({ restarted, total: users.length }, "auto-miner: sessions restarted");
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;

async function scheduleNext(): Promise<void> {
  try {
    await runAutoMiner();
  } catch (err) {
    logger.error({ err }, "auto-miner: unhandled run error");
  } finally {
    const minutes = await getIntervalMinutes().catch(() => DEFAULT_INTERVAL_MINUTES);
    timer = setTimeout(() => { scheduleNext(); }, minutes * 60 * 1000);
    logger.debug({ nextRunMinutes: minutes }, "auto-miner: next run scheduled");
  }
}

export function startAutoMiner(): void {
  logger.info("auto-miner: starting background job");
  scheduleNext();
}

export function stopAutoMiner(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    logger.info("auto-miner: stopped");
  }
}
