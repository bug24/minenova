import { Router, type IRouter } from "express";
import { db, usersTable, referralsTable, passwordResetTokensTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { hashPassword, verifyPassword, generateReferralCode, generateToken } from "../lib/auth";
import { requireAuth } from "../middlewares/requireAuth";
import { RegisterBody, LoginBody, GetMeResponse } from "@workspace/api-zod";
import { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } from "../lib/email";
import crypto from "crypto";
import { z } from "zod";
import { verifyUploadOwnership, consumeUpload } from "../lib/avatarUploadRegistry";
import { updateUserAvatarOnSockets } from "../socket/chat";

/** Extract the real client IP, preferring the first address in X-Forwarded-For. */
function getClientIp(req: any): string | null {
  const fwd = req.headers["x-forwarded-for"] as string | undefined;
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return (req.ip as string | undefined) ?? null;
}

/** Returns true for loopback / RFC-1918 addresses (skip duplicate-check in dev). */
function isPrivateIp(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

const router: IRouter = Router();

function generateVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getAppOrigin(req?: any): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const primary = replitDomains.split(",")[0]?.trim();
    if (primary) return `https://${primary}`;
  }
  const appUrl = process.env.APP_URL;
  if (appUrl) return appUrl.replace(/\/$/, "");
  if (req) {
    const proto = (req.protocol as string) || "http";
    const host = req.get?.("host") as string | undefined;
    if (host) return `${proto}://${host}`;
  }
  throw new Error("APP_URL or REPLIT_DOMAINS must be set to build auth links");
}

function buildVerificationUrl(req: any, token: string): string {
  return `${getAppOrigin(req)}/api/auth/verify-email?token=${token}`;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, email, password, referralCode, deviceFingerprint } = parsed.data;

  // ── Duplicate signal checks ────────────────────────────────────────────────
  const clientIp = getClientIp(req);
  const enforceIp = clientIp !== null && !isPrivateIp(clientIp);
  const enforceFingerprint = !!deviceFingerprint;

  if (enforceIp || enforceFingerprint) {
    const conditions = [];
    if (enforceIp) conditions.push(eq(usersTable.registrationIp, clientIp!));
    if (enforceFingerprint) conditions.push(eq(usersTable.deviceFingerprint, deviceFingerprint!));

    const [duplicate] = await db
      .select({ id: usersTable.id, registrationIp: usersTable.registrationIp, deviceFingerprint: usersTable.deviceFingerprint })
      .from(usersTable)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions))
      .limit(1);

    if (duplicate) {
      if (enforceFingerprint && duplicate.deviceFingerprint === deviceFingerprint) {
        res.status(400).json({ error: "An account has already been created on this device" });
      } else {
        res.status(400).json({ error: "An account has already been created from your network" });
      }
      return;
    }
  }

  // ── Email / username uniqueness ────────────────────────────────────────────
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
  const verificationToken = generateVerificationToken();
  const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
      emailVerified: false,
      verificationToken,
      verificationTokenExpiry,
      registrationIp: clientIp ?? undefined,
      deviceFingerprint: deviceFingerprint ?? undefined,
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

  const verificationUrl = buildVerificationUrl(req, verificationToken);

  try {
    await sendVerificationEmail(email, username, verificationUrl);
  } catch (err) {
    console.error("[email] Failed to send verification email:", err);
  }

  try {
    await sendWelcomeEmail(email, username);
  } catch (err) {
    console.error("[email] Failed to send welcome email:", err);
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
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl ?? null,
    },
    token,
    verificationUrl: process.env.NODE_ENV !== "production" ? verificationUrl : undefined,
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

  if (user.isSuspended) {
    res.status(403).json({ error: "Your account has been suspended. Please contact support." });
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
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl ?? null,
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
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl ?? null,
  }));
});

router.get("/auth/verify-email", async (req, res): Promise<void> => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res.status(400).send(verifyPageHtml("Invalid Link", "No verification token was provided.", false));
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.verificationToken, token))
    .limit(1);

  if (!user) {
    res.status(400).send(verifyPageHtml("Invalid Link", "This verification link is invalid or has already been used.", false));
    return;
  }

  if (user.emailVerified) {
    res.send(verifyPageHtml("Already Verified", "Your email is already verified. You can close this tab.", true));
    return;
  }

  if (user.verificationTokenExpiry && user.verificationTokenExpiry < new Date()) {
    res.status(400).send(verifyPageHtml("Link Expired", "This verification link has expired. Please request a new one from the app.", false));
    return;
  }

  await db.update(usersTable)
    .set({ emailVerified: true, verificationToken: null, verificationTokenExpiry: null })
    .where(eq(usersTable.id, user.id));

  res.send(verifyPageHtml("Email Verified!", `Welcome to MineNova, ${user.username}! Your email has been verified. You can now close this tab and return to the app.`, true));
});

router.post("/auth/resend-verification", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.emailVerified) {
    res.status(400).json({ error: "Email is already verified" });
    return;
  }

  const verificationToken = generateVerificationToken();
  const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.update(usersTable)
    .set({ verificationToken, verificationTokenExpiry })
    .where(eq(usersTable.id, user.id));

  const verificationUrl = buildVerificationUrl(req, verificationToken);

  try {
    await sendVerificationEmail(user.email, user.username, verificationUrl);
  } catch (err) {
    console.error("[email] Failed to send verification email:", err);
  }

  res.json({
    success: true,
    message: "Verification email sent",
    verificationUrl: process.env.NODE_ENV !== "production" ? verificationUrl : undefined,
  });
});

function verifyPageHtml(title: string, message: string, success: boolean): string {
  const color = success ? "#a855f7" : "#ef4444";
  const icon = success ? "✓" : "✗";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — MineNova</title>
  <style>
    body { font-family: sans-serif; background: #0f0c1a; color: #f3f0ff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 400px; padding: 40px 32px; background: #1a1625; border-radius: 16px; border: 1px solid #2d2b3d; }
    .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
    h1 { margin: 0 0 12px; font-size: 22px; color: ${color}; }
    p { color: #9ca3af; font-size: 15px; line-height: 1.6; margin: 0 0 24px; }
    a { display: inline-block; padding: 10px 24px; background: linear-gradient(135deg,#7c3aed,#ec4899); color: #fff; text-decoration: none; border-radius: 20px; font-weight: bold; font-size: 14px; }
    .brand { font-size: 18px; font-weight: 900; color: #a855f7; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">MineNova</div>
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Return to App</a>
  </div>
</body>
</html>`;
}

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Valid email required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email)).limit(1);

  if (user) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash, expiresAt });

    const resetUrl = `${getAppOrigin(req)}/reset-password?token=${token}`;

    try {
      await sendPasswordResetEmail(user.email, user.username, resetUrl);
    } catch (err) {
      console.error("[email] Failed to send password reset email:", err);
    }
  }

  res.json({ success: true, message: "If an account with that email exists, a reset link has been sent." });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const schema = z.object({ token: z.string().min(1), newPassword: z.string().min(8, "Password must be at least 8 characters") });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const now = new Date();

  const [row] = await db.select().from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.expiresAt < now) {
    res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
    return;
  }

  const passwordHash = hashPassword(parsed.data.newPassword);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, row.userId));
  await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, row.userId));

  res.json({ success: true });
});

const AVATAR_OBJECT_PATH_RE = /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.patch("/users/me/avatar", requireAuth, async (req, res): Promise<void> => {
  const schema = z.object({ objectPath: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "objectPath is required" });
    return;
  }
  const { objectPath } = parsed.data;
  if (!AVATAR_OBJECT_PATH_RE.test(objectPath)) {
    res.status(400).json({ error: "Invalid objectPath" });
    return;
  }
  if (!verifyUploadOwnership(objectPath, req.userId!)) {
    res.status(403).json({ error: "Upload not authorised for this user" });
    return;
  }
  consumeUpload(objectPath);
  const avatarUrl = `/api/storage${objectPath}`;
  await db.update(usersTable).set({ avatarUrl }).where(eq(usersTable.id, req.userId!));
  updateUserAvatarOnSockets(req.userId!, avatarUrl);
  res.json({ success: true });
});

export default router;
