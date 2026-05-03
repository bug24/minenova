import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  referralCode: text("referral_code").notNull().unique(),
  referredBy: integer("referred_by"),
  miningLevel: integer("mining_level").notNull().default(1),
  totalEarned: real("total_earned").notNull().default(0),
  coinBalance: real("coin_balance").notNull().default(0),
  pendingBalance: real("pending_balance").notNull().default(0),
  totalWithdrawn: real("total_withdrawn").notNull().default(0),
  usdtBalance: real("usdt_balance").notNull().default(0),
  lockedUsdtBalance: real("locked_usdt_balance").notNull().default(0),
  isSuspended: boolean("is_suspended").notNull().default(false),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationToken: text("verification_token"),
  verificationTokenExpiry: timestamp("verification_token_expiry", { withTimezone: true }),
  registrationIp: text("registration_ip"),
  deviceFingerprint: text("device_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
