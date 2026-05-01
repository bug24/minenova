import { pgTable, serial, timestamp, integer, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { upgradesTable } from "./upgrades";

export const referralEarningsTable = pgTable("referral_earnings", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull().references(() => usersTable.id),
  referredId: integer("referred_id").notNull().references(() => usersTable.id),
  upgradeId: integer("upgrade_id").notNull().references(() => upgradesTable.id),
  tier: integer("tier").notNull().default(1),
  rewardCoins: real("reward_coins").notNull().default(0),
  rewardLockedUsdt: real("reward_locked_usdt").notNull().default(0),
  status: text("status").notNull().default("locked"),
  unlockDate: timestamp("unlock_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReferralEarningSchema = createInsertSchema(referralEarningsTable).omit({ id: true, createdAt: true });
export type InsertReferralEarning = z.infer<typeof insertReferralEarningSchema>;
export type ReferralEarning = typeof referralEarningsTable.$inferSelect;
