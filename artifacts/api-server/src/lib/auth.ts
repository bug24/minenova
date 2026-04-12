import crypto from "crypto";
import { createHmac } from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "minenova-secret-key";

export function hashPassword(password: string): string {
  return createHmac("sha256", SECRET).update(password).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateReferralCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function generatePaymentTag(): string {
  return "MN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

export function generateToken(userId: number): string {
  const payload = `${userId}:${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

export function verifyToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    const payload = `${userId}:${ts}`;
    const expectedSig = createHmac("sha256", SECRET).update(payload).digest("hex");
    if (sig !== expectedSig) return null;
    return parseInt(userId, 10);
  } catch {
    return null;
  }
}
