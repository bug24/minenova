import { Router, type IRouter } from "express";
import { db, upgradesTable, userUpgradesTable, usersTable, transactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { PurchaseUpgradeParams, PurchaseUpgradeBody, GetUpgradesResponse, PurchaseUpgradeResponse } from "@workspace/api-zod";
import { generatePaymentTag } from "../lib/auth";

const router: IRouter = Router();

const USDT_DEPOSIT_ADDRESS = "TRX_PLACEHOLDER_ADDRESS_CONFIGURE_ME";

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

  const [alreadyOwned] = await db
    .select()
    .from(userUpgradesTable)
    .where(and(eq(userUpgradesTable.userId, req.userId!), eq(userUpgradesTable.upgradeId, upgradeId)))
    .limit(1);

  if (alreadyOwned) {
    res.status(400).json({ error: "You already own this upgrade" });
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

    await db.update(usersTable).set({ coinBalance: newBalance, miningLevel: newLevel }).where(eq(usersTable.id, req.userId!));
    await db.insert(userUpgradesTable).values({ userId: req.userId!, upgradeId });
    await db.insert(transactionsTable).values({
      userId: req.userId!,
      type: "upgrade",
      amount: -upgrade.coinCost,
      status: "completed",
      description: `Purchased upgrade: ${upgrade.name}`,
    });

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

    await db.insert(transactionsTable).values({
      userId: req.userId!,
      type: "upgrade_payment",
      amount: -upgrade.usdtCost,
      status: "pending",
      description: `USDT payment for upgrade: ${upgrade.name}`,
      usdtAddress: USDT_DEPOSIT_ADDRESS,
      paymentTag,
    });

    res.json(PurchaseUpgradeResponse.parse({
      success: true,
      message: `Send ${upgrade.usdtCost} USDT to activate your upgrade. Use the payment tag so we can identify your payment.`,
      usdtAddress: USDT_DEPOSIT_ADDRESS,
      paymentTag,
      newBalance: null,
    }));
    return;
  }

  res.status(400).json({ error: "Invalid payment method. Use 'coins' or 'usdt'" });
});

export default router;
