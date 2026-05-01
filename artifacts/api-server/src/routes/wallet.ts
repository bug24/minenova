import { Router, type IRouter } from "express";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { RequestWithdrawalBody, GetWalletResponse, RequestWithdrawalResponse, GetTransactionsResponse } from "@workspace/api-zod";
import { generatePaymentTag } from "../lib/auth";

const router: IRouter = Router();

const USDT_DEPOSIT_ADDRESS = "TRX_PLACEHOLDER_ADDRESS_CONFIGURE_ME";
const MINIMUM_WITHDRAWAL = 5;
const COINS_PER_USDT = 1000;
const MINIMUM_COINS = MINIMUM_WITHDRAWAL * COINS_PER_USDT;

router.get("/wallet", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);

  res.json(GetWalletResponse.parse({
    totalBalance: user.coinBalance,
    pendingBalance: user.pendingBalance,
    withdrawableBalance: user.coinBalance,
    totalWithdrawn: user.totalWithdrawn,
    minimumWithdrawal: MINIMUM_WITHDRAWAL,
    usdtBalance: user.usdtBalance ?? 0,
    lockedUsdtBalance: user.lockedUsdtBalance ?? 0,
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

  const paymentTag = generatePaymentTag();

  const [tx] = await db.insert(transactionsTable).values({
    userId: req.userId!,
    type: "withdrawal",
    amount,
    status: "pending",
    description: `USDT withdrawal to ${walletAddress.slice(0, 8)}...`,
    walletAddress,
    usdtAddress: USDT_DEPOSIT_ADDRESS,
    paymentTag,
  }).returning();

  await db.update(usersTable)
    .set({
      coinBalance: user.coinBalance - requiredCoins,
      totalWithdrawn: user.totalWithdrawn + amount,
    })
    .where(eq(usersTable.id, req.userId!));

  res.json(RequestWithdrawalResponse.parse({
    transactionId: tx.id,
    amount,
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

  const paymentTag = generatePaymentTag();

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
      amount,
      status: "pending",
      description: `Referral USDT withdrawal to ${walletAddress.slice(0, 8)}...`,
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

  res.json(RequestWithdrawalResponse.parse({
    transactionId,
    amount,
    status: "pending",
    message: "Referral USDT withdrawal request submitted.",
    usdtAddress: USDT_DEPOSIT_ADDRESS,
    paymentTag,
  }));
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
