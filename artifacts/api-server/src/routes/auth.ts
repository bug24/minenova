import { Router, type IRouter } from "express";
import { db, usersTable, referralsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateReferralCode, generateToken } from "../lib/auth";
import { requireAuth } from "../middlewares/requireAuth";
import { RegisterBody, LoginBody, GetMeResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, email, password, referralCode } = parsed.data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (existingUser) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = hashPassword(password);
  const newReferralCode = generateReferralCode();

  let referredBy: number | null = null;

  if (referralCode) {
    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, referralCode.toUpperCase()))
      .limit(1);

    if (referrer) {
      referredBy = referrer.id;
    }
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      email,
      passwordHash,
      referralCode: newReferralCode,
      referredBy: referredBy ?? undefined,
      coinBalance: 0,
    })
    .returning();

  if (referredBy) {
    await db.insert(referralsTable).values({
      referrerId: referredBy,
      referredId: user.id,
      tier: 1,
      totalEarned: 0,
      bonusPaid: false,
    });
  }

  const token = generateToken(user.id);

  res.status(201).json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      referralCode: user.referralCode,
      miningLevel: user.miningLevel,
      totalEarned: user.totalEarned,
      createdAt: user.createdAt.toISOString(),
    },
    token,
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = generateToken(user.id);

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      referralCode: user.referralCode,
      miningLevel: user.miningLevel,
      totalEarned: user.totalEarned,
      createdAt: user.createdAt.toISOString(),
    },
    token,
  });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetMeResponse.parse({
    id: user.id,
    username: user.username,
    email: user.email,
    referralCode: user.referralCode,
    miningLevel: user.miningLevel,
    totalEarned: user.totalEarned,
    createdAt: user.createdAt.toISOString(),
  }));
});

export default router;
