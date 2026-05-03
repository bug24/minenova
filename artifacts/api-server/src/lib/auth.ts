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

const SAT_PREFIX = "SAT_";
const SAT_TTL_MS = 24 * 60 * 60 * 1000;

export function generateSubAdminToken(subAdminId: number): string {
  const payload = `${subAdminId}:${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  const encoded = Buffer.from(`${payload}:${sig}`).toString("base64");
  return `${SAT_PREFIX}${encoded}`;
}

export function verifySubAdminToken(token: string): number | null {
  if (!token?.startsWith(SAT_PREFIX)) return null;
  try {
    const encoded = token.slice(SAT_PREFIX.length);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [idStr, tsStr, sig] = parts;
    const payload = `${idStr}:${tsStr}`;
    const expectedSig = createHmac("sha256", SECRET).update(payload).digest("hex");
    if (sig !== expectedSig) return null;
    if (Date.now() - parseInt(tsStr, 10) > SAT_TTL_MS) return null;
    return parseInt(idStr, 10);
  } catch {
    return null;
  }
}

export function isSubAdminToken(value: string): boolean {
  return typeof value === "string" && value.startsWith(SAT_PREFIX);
}
