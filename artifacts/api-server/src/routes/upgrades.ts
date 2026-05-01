import { Router, type IRouter } from "express";
import { db, upgradesTable, userUpgradesTable, usersTable, transactionsTable, adminConfigTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { PurchaseUpgradeParams, PurchaseUpgradeBody, GetUpgradesResponse, PurchaseUpgradeResponse } from "@workspace/api-zod";
import { generatePaymentTag } from "../lib/auth";
import { sendUpgradePaymentSubmittedEmail } from "../lib/email";
import { triggerUpgradeReferralReward } from "../lib/referralReward";
import { sendAdminNotification } from "../lib/pushNotifications";
import { z } from "zod/v4";

const router: IRouter = Router();
const COINS_PER_USDT = 1000;

async function getUsdtDepositAddress(): Promise<string> {
  const rows = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "usdt_wallet_address"))
    .limit(1);
  return rows[0]?.value ?? "TRX_PLACEHOLDER_ADDRESS_CONFIGURE_ME";
}

router.get("/upgrades", requireAuth, async (req, res): Promise<void> => {
  const allUpgrades = await db.select().from(upgradesTable).orderBy(upgradesTable.sortOrder);
  const userUpgrades = await db
    .select({ upgradeId: userUpgradesTable.upgradeId })
    .from(userUpgradesTable)
    .where(eq(userUpgradesTable.userId, req.userId!));

  const ownedSet = new Set(userUpgrades.map(u => u.upgradeId));

  const result = allUpgrades.map(u => ({
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
  }));

  res.json(GetUpgradesResponse.parse(result));
});

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
    const newLevel = user.miningLevel + 1;

    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ coinBalance: newBalance, miningLevel: newLevel }).where(eq(usersTable.id, req.userId!));
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
    // Reward trigger is non-fatal: purchase is already committed at this point.
    // Errors (e.g., DB transient failure, duplicate unique key on retry) are
    // logged and do not cause the successful purchase to appear as a failure.
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
  const upgradeName = txn.description.replace("USDT payment for upgrade: ", "");
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
