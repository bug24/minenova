import { Router, type IRouter } from "express";
import { db, upgradesTable, userUpgradesTable, usersTable, transactionsTable, adminConfigTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { PurchaseUpgradeParams, PurchaseUpgradeBody, GetUpgradesResponse, PurchaseUpgradeResponse, BundlePurchaseUpgradeBody, BundlePurchaseUpgradeResponse } from "@workspace/api-zod";
import { generatePaymentTag } from "../lib/auth";
import { sendUpgradePaymentSubmittedEmail } from "../lib/email";
import { triggerUpgradeReferralReward } from "../lib/referralReward";
import { sendAdminNotification } from "../lib/pushNotifications";
import { z } from "zod/v4";

const router: IRouter = Router();
const COINS_PER_USDT = 1000;
const MAX_LEVELS = 8;
const COIN_DISCOUNT = 0.05;   // 5% off bundle via coins
const USDT_DISCOUNT = 0.10;   // 10% off bundle via USDT (headline rate)

async function getUsdtDepositAddress(): Promise<string> {
  const rows = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "usdt_wallet_address"))
    .limit(1);
  return rows[0]?.value ?? "TRX_PLACEHOLDER_ADDRESS_CONFIGURE_ME";
}

/** Returns the highest tier owned by the user (0 if none). Derived from user_upgrades records. */
async function getMaxOwnedTier(userId: number, allUpgrades: { id: number; tier: number }[]): Promise<number> {
  const owned = await db
    .select({ upgradeId: userUpgradesTable.upgradeId })
    .from(userUpgradesTable)
    .where(eq(userUpgradesTable.userId, userId));
  if (owned.length === 0) return 0;
  const ownedIds = new Set(owned.map(u => u.upgradeId));
  const ownedTiers = allUpgrades.filter(u => ownedIds.has(u.id)).map(u => u.tier);
  return ownedTiers.length > 0 ? Math.max(...ownedTiers) : 0;
}

router.get("/upgrades", requireAuth, async (req, res): Promise<void> => {
  try {
    const allUpgrades = await db.select().from(upgradesTable).orderBy(upgradesTable.sortOrder);

    const userUpgrades = await db
      .select({ upgradeId: userUpgradesTable.upgradeId })
      .from(userUpgradesTable)
      .where(eq(userUpgradesTable.userId, req.userId!));

    const ownedSet = new Set(userUpgrades.map(u => u.upgradeId));

    // Derive progression from actual ownership records, not miningLevel
    const ownedTiers = allUpgrades.filter(u => ownedSet.has(u.id)).map(u => u.tier);
    const maxOwnedTier = ownedTiers.length > 0 ? Math.max(...ownedTiers) : 0;

    const result = allUpgrades.map(u => {
      const isUnlocked = ownedSet.has(u.id);         // ownership-based
      const isNext = u.tier === maxOwnedTier + 1;    // next sequential level

      // bundlePrice: only for tiers that are skip targets (2+ levels ahead)
      let bundlePrice: { coins: number; usdt: number; discountPct: number } | null = null;
      if (!isUnlocked && !isNext) {
        // Sum all tiers from the next unowned level (maxOwnedTier+1) up to this tier
        const levelsToUnlock = allUpgrades.filter(x => x.tier >= maxOwnedTier + 1 && x.tier <= u.tier);
        const rawCoins = levelsToUnlock.reduce((sum, x) => sum + (x.coinCost ?? 0), 0);
        const rawUsdt = levelsToUnlock.reduce((sum, x) => sum + (x.usdtCost ?? 0), 0);
        bundlePrice = {
          coins: Math.round(rawCoins * (1 - COIN_DISCOUNT) * 100) / 100,
          usdt: Math.round(rawUsdt * (1 - USDT_DISCOUNT) * 1000) / 1000,
          discountPct: Math.round(USDT_DISCOUNT * 100),
        };
      }

      return {
        id: u.id,
        name: u.name,
        description: u.description,
        tier: u.tier,
        hashRateBoost: u.hashRateBoost,
        dailyCapBoost: u.dailyCapBoost,
        coinCost: u.coinCost,
        usdtCost: u.usdtCost,
        owned: ownedSet.has(u.id),
        isAutoMining: u.isAutoMining,
        badge: u.badge ?? null,
        icon: u.icon ?? null,
        isUnlocked,
        isNext,
        bundlePrice,
      };
    });

    res.json(GetUpgradesResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "upgrades/GET error");
    res.status(500).json({ error: "Failed to load upgrades" });
  }
});

// ─── Bundle purchase — must be declared before /:upgradeId/purchase ───────────

router.post("/upgrades/bundle", requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = BundlePurchaseUpgradeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { targetLevel, paymentMethod } = parsed.data;

    if (targetLevel < 1 || targetLevel > MAX_LEVELS) {
      res.status(400).json({ error: `Target level must be between 1 and ${MAX_LEVELS}` });
      return;
    }

    const allUpgrades = await db.select().from(upgradesTable).orderBy(upgradesTable.sortOrder);
    const maxOwnedTier = await getMaxOwnedTier(req.userId!, allUpgrades);
    const nextTier = maxOwnedTier + 1;

    if (targetLevel <= maxOwnedTier) {
      res.status(400).json({ error: "You have already unlocked this level" });
      return;
    }
    if (targetLevel === nextTier) {
      res.status(400).json({ error: "Use the standard upgrade to purchase the next single level" });
      return;
    }

    const jump = targetLevel - maxOwnedTier; // total levels to unlock

    if (jump > 3 && paymentMethod === "coins") {
      res.status(400).json({ error: "Jumping more than 3 levels at once requires USDT payment" });
      return;
    }

    // Fetch all tiers to unlock: from maxOwnedTier+1 up to targetLevel
    const levelsToUnlock = allUpgrades.filter(u => u.tier >= nextTier && u.tier <= targetLevel);

    if (levelsToUnlock.length === 0) {
      res.status(400).json({ error: "No upgrades found for the requested levels" });
      return;
    }

    const rawCoinTotal = levelsToUnlock.reduce((s, u) => s + (u.coinCost ?? 0), 0);
    const rawUsdtTotal = levelsToUnlock.reduce((s, u) => s + (u.usdtCost ?? 0), 0);

    const discountedCoinTotal = Math.round(rawCoinTotal * (1 - COIN_DISCOUNT) * 100) / 100;
    const discountedUsdtTotal = Math.round(rawUsdtTotal * (1 - USDT_DISCOUNT) * 1000) / 1000;

    const levelNumbers = levelsToUnlock.map(u => u.tier);
    const upgradeIds = levelsToUnlock.map(u => u.id);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

    if (paymentMethod === "coins") {
      if (user.coinBalance < discountedCoinTotal) {
        res.status(400).json({ error: `Insufficient coin balance. Need ${discountedCoinTotal} coins (5% bundle discount applied).` });
        return;
      }

      const newBalance = user.coinBalance - discountedCoinTotal;
      // miningLevel tracks mining speed (increment by number of levels unlocked)
      const newMiningLevel = user.miningLevel + levelsToUnlock.length;

      await db.transaction(async (tx) => {
        await tx.update(usersTable)
          .set({ coinBalance: newBalance, miningLevel: newMiningLevel })
          .where(eq(usersTable.id, req.userId!));

        await tx.insert(userUpgradesTable).values(
          upgradeIds.map(upgradeId => ({ userId: req.userId!, upgradeId }))
        );

        await tx.insert(transactionsTable).values({
          userId: req.userId!,
          type: "upgrade",
          amount: -discountedCoinTotal,
          status: "completed",
          description: `Bundle upgrade to Level ${targetLevel} (Levels ${levelNumbers.join(", ")}) — 5% discount`,
        });
      });

      const usdtValue = discountedUsdtTotal > 0 ? discountedUsdtTotal : discountedCoinTotal / COINS_PER_USDT;
      for (const upgradeId of upgradeIds) {
        await triggerUpgradeReferralReward({ referredUserId: req.userId!, upgradeId, upgradeUsdtValue: usdtValue / upgradeIds.length })
          .catch(err => req.log.error({ err, upgradeId, userId: req.userId }, "Referral reward failed for bundle upgrade"));
      }

      res.json(BundlePurchaseUpgradeResponse.parse({
        success: true,
        message: `Bundle upgrade complete! You've unlocked Levels ${levelNumbers.join(", ")} (5% discount applied).`,
        levelsUnlocked: levelNumbers,
        totalCost: discountedCoinTotal,
        newBalance,
        usdtAddress: null,
        paymentTag: null,
      }));
      return;
    }

    if (paymentMethod === "usdt") {
      const paymentTag = generatePaymentTag();
      const usdtAddress = await getUsdtDepositAddress();

      await db.insert(transactionsTable).values({
        userId: req.userId!,
        type: "upgrade_payment",
        amount: -discountedUsdtTotal,
        status: "pending",
        description: `USDT bundle payment for Levels ${levelNumbers.join(", ")} — 10% discount`,
        usdtAddress,
        paymentTag,
      });

      sendAdminNotification({
        title: "Bundle Upgrade Request",
        body: `${user.username} submitted $${discountedUsdtTotal.toFixed(2)} USDT to unlock Levels ${levelNumbers.join(", ")}.`,
        url: "/admin",
      }).catch(() => {});

      res.json(BundlePurchaseUpgradeResponse.parse({
        success: true,
        message: `Send ${discountedUsdtTotal} USDT to activate Levels ${levelNumbers.join(", ")} (10% bundle discount applied). Use the payment tag so we can identify your payment.`,
        levelsUnlocked: levelNumbers,
        totalCost: discountedUsdtTotal,
        newBalance: null,
        usdtAddress,
        paymentTag,
      }));
      return;
    }

    res.status(400).json({ error: "Invalid payment method. Use 'coins' or 'usdt'" });
  } catch (err) {
    req.log.error({ err }, "upgrades/bundle error");
    res.status(500).json({ error: "Bundle upgrade failed. Please try again." });
  }
});

// ─── Single-level purchase ─────────────────────────────────────────────────────

router.post("/upgrades/:upgradeId/purchase", requireAuth, async (req, res): Promise<void> => {
  const params = PurchaseUpgradeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = PurchaseUpgradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { upgradeId } = params.data;
  const { paymentMethod } = parsed.data;

  const [upgrade] = await db.select().from(upgradesTable).where(eq(upgradesTable.id, upgradeId)).limit(1);
  if (!upgrade) {
    res.status(404).json({ error: "Upgrade not found" });
    return;
  }

  // Sequential enforcement: derived from actual ownership records
  const allUpgrades = await db.select({ id: upgradesTable.id, tier: upgradesTable.tier }).from(upgradesTable);
  const maxOwnedTier = await getMaxOwnedTier(req.userId!, allUpgrades);
  const nextTier = maxOwnedTier + 1;

  if (upgrade.tier < nextTier) {
    res.status(400).json({ error: `You have already unlocked Level ${upgrade.tier}` });
    return;
  }
  if (upgrade.tier > nextTier) {
    res.status(400).json({ error: `You must unlock Level ${nextTier} before purchasing Level ${upgrade.tier}. Use the bundle option to skip multiple levels.` });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  if (paymentMethod === "coins") {
    if (!upgrade.coinCost) {
      res.status(400).json({ error: "This upgrade cannot be purchased with coins" });
      return;
    }
    if (user.coinBalance < upgrade.coinCost) {
      res.status(400).json({ error: "Insufficient coin balance" });
      return;
    }

    const newBalance = user.coinBalance - upgrade.coinCost;

    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({ coinBalance: newBalance, miningLevel: user.miningLevel + 1 })
        .where(eq(usersTable.id, req.userId!));
      await tx.insert(userUpgradesTable).values({ userId: req.userId!, upgradeId });
      await tx.insert(transactionsTable).values({
        userId: req.userId!,
        type: "upgrade",
        amount: -upgrade.coinCost!,
        status: "completed",
        description: `Purchased upgrade: ${upgrade.name}`,
        upgradeId,
      });
    });

    const usdtValue = upgrade.usdtCost ?? upgrade.coinCost! / COINS_PER_USDT;
    await triggerUpgradeReferralReward({ referredUserId: req.userId!, upgradeId, upgradeUsdtValue: usdtValue })
      .catch(err => req.log.error({ err, upgradeId, userId: req.userId }, "Referral reward trigger failed for coin upgrade"));

    res.json(PurchaseUpgradeResponse.parse({
      success: true,
      message: `Successfully upgraded! ${upgrade.name} is now active.`,
      usdtAddress: null,
      paymentTag: null,
      newBalance,
    }));
    return;
  }

  if (paymentMethod === "usdt") {
    if (!upgrade.usdtCost) {
      res.status(400).json({ error: "This upgrade cannot be purchased with USDT" });
      return;
    }

    const paymentTag = generatePaymentTag();
    const usdtAddress = await getUsdtDepositAddress();

    await db.insert(transactionsTable).values({
      userId: req.userId!,
      type: "upgrade_payment",
      amount: -upgrade.usdtCost,
      status: "pending",
      description: `USDT payment for upgrade: ${upgrade.name}`,
      usdtAddress,
      paymentTag,
      upgradeId,
    });

    res.json(PurchaseUpgradeResponse.parse({
      success: true,
      message: `Send ${upgrade.usdtCost} USDT to activate your upgrade. Use the payment tag so we can identify your payment.`,
      usdtAddress,
      paymentTag,
      newBalance: null,
    }));
    return;
  }

  res.status(400).json({ error: "Invalid payment method. Use 'coins' or 'usdt'" });
});

const MarkPaidBody = z.object({ paymentTag: z.string().min(1) });

router.post("/upgrades/payments/mark-paid", requireAuth, async (req, res): Promise<void> => {
  const parsed = MarkPaidBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "paymentTag is required" });
    return;
  }

  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.paymentTag, parsed.data.paymentTag), eq(transactionsTable.userId, req.userId!)))
    .limit(1);

  if (!txn) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }

  if (txn.status !== "pending") {
    res.status(400).json({ error: "This payment has already been processed" });
    return;
  }

  await db
    .update(transactionsTable)
    .set({ status: "awaiting_verification" })
    .where(eq(transactionsTable.id, txn.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  const upgradeName = txn.description
    .replace("USDT payment for upgrade: ", "")
    .replace("USDT bundle payment for ", "");
  const usdtAmount = Math.abs(txn.amount);

  sendUpgradePaymentSubmittedEmail(
    user.email,
    user.username,
    upgradeName,
    usdtAmount,
    txn.paymentTag ?? "",
  ).catch(() => {});

  sendAdminNotification({
    title: "New Upgrade Request",
    body: `${user.username} submitted $${usdtAmount.toFixed(2)} USDT for "${upgradeName}".`,
    url: "/admin",
  }).catch(() => {});

  res.json({ success: true, message: "Payment marked as sent. Admin will verify within 2–12 hours." });
});

export default router;
