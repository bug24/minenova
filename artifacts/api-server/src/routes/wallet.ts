import { Router, type IRouter } from "express";
import { db, usersTable, transactionsTable, adminConfigTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { RequestWithdrawalBody, GetWalletResponse, RequestWithdrawalResponse, GetTransactionsResponse } from "@workspace/api-zod";
import { generatePaymentTag } from "../lib/auth";
import { sendAdminNotification } from "../lib/pushNotifications";

const router: IRouter = Router();

const USDT_DEPOSIT_ADDRESS = "BSC_PLACEHOLDER_ADDRESS_CONFIGURE_ME";
const MINIMUM_WITHDRAWAL = 5;
const COINS_PER_USDT = 1000;
const MINIMUM_COINS = MINIMUM_WITHDRAWAL * COINS_PER_USDT;

async function getWithdrawalFeeConfig(): Promise<{ enabled: boolean; pct: number }> {
  const rows = await db
    .select()
    .from(adminConfigTable)
    .where(sql`key IN ('withdrawal_fee_enabled', 'withdrawal_fee_pct')`);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    enabled: map["withdrawal_fee_enabled"] === "true",
    pct: parseFloat(map["withdrawal_fee_pct"] ?? "0") || 0,
  };
}

function applyFee(amount: number, feePct: number): { fee: number; netPayout: number } {
  const fee = Math.round(amount * feePct / 100 * 100) / 100;
  return { fee, netPayout: Math.round((amount - fee) * 100) / 100 };
}

router.get("/wallet", requireAuth, async (req, res): Promise<void> => {
  const [[user], feeConfig] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1),
    getWithdrawalFeeConfig(),
  ]);

  res.json(GetWalletResponse.parse({
    totalBalance: user.coinBalance,
    pendingBalance: user.pendingBalance,
    withdrawableBalance: user.coinBalance,
    totalWithdrawn: user.totalWithdrawn,
    minimumWithdrawal: MINIMUM_WITHDRAWAL,
    usdtBalance: user.usdtBalance ?? 0,
    lockedUsdtBalance: user.lockedUsdtBalance ?? 0,
    withdrawalFeeEnabled: feeConfig.enabled,
    withdrawalFeePct: feeConfig.pct,
  }));
});

router.post("/wallet/withdraw", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestWithdrawalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, amount } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  if (amount < MINIMUM_WITHDRAWAL) {
    res.status(400).json({ error: `Minimum withdrawal is ${MINIMUM_COINS} coins (${MINIMUM_WITHDRAWAL} USDT)` });
    return;
  }

  const requiredCoins = amount * COINS_PER_USDT;

  if (user.coinBalance < MINIMUM_COINS) {
    res.status(400).json({ error: `Minimum withdrawal is ${MINIMUM_COINS} coins (${MINIMUM_WITHDRAWAL} USDT)` });
    return;
  }

  if (user.coinBalance < requiredCoins) {
    res.status(400).json({ error: "Insufficient coin balance" });
    return;
  }

  const feeConfig = await getWithdrawalFeeConfig();
  const { fee, netPayout } = feeConfig.enabled
    ? applyFee(amount, feeConfig.pct)
    : { fee: 0, netPayout: amount };

  const paymentTag = generatePaymentTag();
  const description = feeConfig.enabled && fee > 0
    ? `USDT withdrawal to ${walletAddress.slice(0, 8)}... (${feeConfig.pct}% fee, $${fee.toFixed(2)} deducted)`
    : `USDT withdrawal to ${walletAddress.slice(0, 8)}...`;

  const [tx] = await db.insert(transactionsTable).values({
    userId: req.userId!,
    type: "withdrawal",
    amount: netPayout,
    status: "pending",
    description,
    walletAddress,
    usdtAddress: USDT_DEPOSIT_ADDRESS,
    paymentTag,
  }).returning();

  await db.update(usersTable)
    .set({
      coinBalance: user.coinBalance - requiredCoins,
      totalWithdrawn: user.totalWithdrawn + netPayout,
    })
    .where(eq(usersTable.id, req.userId!));

  sendAdminNotification({
    title: "New Withdrawal Request",
    body: `$${netPayout} USDT from @${user.username} — tag ${paymentTag}`,
    url: "/admin",
  }).catch(() => {});

  res.json(RequestWithdrawalResponse.parse({
    transactionId: tx.id,
    amount: netPayout,
    status: "pending",
    message: "Withdrawal request submitted. Send USDT to the address with your payment tag.",
    usdtAddress: USDT_DEPOSIT_ADDRESS,
    paymentTag,
  }));
});

// POST /wallet/withdraw-usdt
// Withdraws ONLY from the unlocked referral USDT balance (usdtBalance).
// Locked USDT (lockedUsdtBalance) is never included — it cannot be withdrawn
// until the system unlocks it after 7 days.
router.post("/wallet/withdraw-usdt", requireAuth, async (req, res): Promise<void> => {
  const parsed = RequestWithdrawalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, amount } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  const unlockedUsdt = user.usdtBalance ?? 0;
  const lockedUsdt = user.lockedUsdtBalance ?? 0;

  if (amount < MINIMUM_WITHDRAWAL) {
    res.status(400).json({ error: `Minimum withdrawal is ${MINIMUM_WITHDRAWAL} USDT` });
    return;
  }

  if (unlockedUsdt < amount) {
    const msg =
      lockedUsdt > 0
        ? `Insufficient unlocked USDT balance (${unlockedUsdt.toFixed(2)} available). You have ${lockedUsdt.toFixed(2)} USDT still locked — it will unlock automatically after 7 days.`
        : `Insufficient USDT balance (${unlockedUsdt.toFixed(2)} available)`;
    res.status(400).json({ error: msg });
    return;
  }

  const feeConfig = await getWithdrawalFeeConfig();
  const { fee, netPayout } = feeConfig.enabled
    ? applyFee(amount, feeConfig.pct)
    : { fee: 0, netPayout: amount };

  const paymentTag = generatePaymentTag();
  const description = feeConfig.enabled && fee > 0
    ? `Referral USDT withdrawal to ${walletAddress.slice(0, 8)}... (${feeConfig.pct}% fee, $${fee.toFixed(2)} deducted)`
    : `Referral USDT withdrawal to ${walletAddress.slice(0, 8)}...`;

  let transactionId = 0;
  let debited = false;

  await db.transaction(async (tx) => {
    // Atomically debit only if sufficient balance exists — guards against
    // concurrent requests that could otherwise overdraw usdtBalance.
    const claimed = await tx
      .update(usersTable)
      .set({ usdtBalance: sql`usdt_balance - ${amount}` })
      .where(
        and(
          eq(usersTable.id, req.userId!),
          sql`usdt_balance >= ${amount}`,
        ),
      )
      .returning({ id: usersTable.id });

    if (claimed.length === 0) return; // concurrent request drained the balance

    const [inserted] = await tx.insert(transactionsTable).values({
      userId: req.userId!,
      type: "withdrawal",
      amount: netPayout,
      status: "pending",
      description,
      walletAddress,
      usdtAddress: USDT_DEPOSIT_ADDRESS,
      paymentTag,
    }).returning({ id: transactionsTable.id });

    transactionId = inserted.id;
    debited = true;
  });

  if (!debited) {
    res.status(400).json({ error: "Insufficient unlocked USDT balance (concurrent request may have depleted funds)" });
    return;
  }

  sendAdminNotification({
    title: "New USDT Withdrawal Request",
    body: `$${netPayout} referral USDT from @${user.username} — tag ${paymentTag}`,
    url: "/admin",
  }).catch(() => {});

  res.json(RequestWithdrawalResponse.parse({
    transactionId,
    amount: netPayout,
    status: "pending",
    message: "Referral USDT withdrawal request submitted.",
    usdtAddress: USDT_DEPOSIT_ADDRESS,
    paymentTag,
  }));
});

router.post("/wallet/withdrawal-share-bonus", requireAuth, async (req, res): Promise<void> => {
  const { withdrawalId } = req.body as { withdrawalId?: number };
  if (!withdrawalId || typeof withdrawalId !== "number") {
    res.status(400).json({ error: "withdrawalId required" });
    return;
  }

  const [configRow] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "share_withdrawal_bonus_coins"))
    .limit(1);
  const bonusCoins = parseFloat(configRow?.value ?? "0") || 0;
  if (bonusCoins <= 0) {
    res.json({ bonus: 0, message: "No share bonus configured" });
    return;
  }

  const [tx] = await db
    .select({ id: transactionsTable.id, userId: transactionsTable.userId })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.id, withdrawalId), eq(transactionsTable.userId, req.userId!)))
    .limit(1);

  if (!tx) {
    res.status(404).json({ error: "Withdrawal not found" });
    return;
  }

  const existing = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(and(
      eq(transactionsTable.userId, req.userId!),
      eq(transactionsTable.type, "bonus"),
      sql`description LIKE ${"share_bonus_withdrawal_" + withdrawalId + "%"}`,
    ))
    .limit(1);

  if (existing.length > 0) {
    res.json({ bonus: 0, message: "Share bonus already claimed for this withdrawal" });
    return;
  }

  await db.insert(transactionsTable).values({
    userId: req.userId!,
    type: "bonus",
    amount: bonusCoins,
    status: "completed",
    description: `share_bonus_withdrawal_${withdrawalId}: Share bonus for withdrawal #${withdrawalId}`,
  });

  await db
    .update(usersTable)
    .set({ coinBalance: sql`coin_balance + ${bonusCoins}`, totalEarned: sql`total_earned + ${bonusCoins}` })
    .where(eq(usersTable.id, req.userId!));

  res.json({ bonus: bonusCoins, message: `+${bonusCoins} coins bonus for sharing your withdrawal!` });
});

router.get("/wallet/transactions", requireAuth, async (req, res): Promise<void> => {
  const txs = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, req.userId!))
    .orderBy(transactionsTable.createdAt);

  const result = txs.reverse().map(tx => ({
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    status: tx.status,
    description: tx.description,
    createdAt: tx.createdAt.toISOString(),
  }));

  res.json(GetTransactionsResponse.parse(result));
});

export default router;
