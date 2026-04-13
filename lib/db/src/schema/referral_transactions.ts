import { pgTable, serial, timestamp, integer, real, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const referralTransactionsTable = pgTable("referral_transactions", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull(),
  referredId: integer("referred_id").notNull(),
  rewardType: text("reward_type").notNull(),
  amount: real("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReferralTransactionSchema = createInsertSchema(referralTransactionsTable).omit({ id: true, createdAt: true });
export type InsertReferralTransaction = z.infer<typeof insertReferralTransactionSchema>;
export type ReferralTransaction = typeof referralTransactionsTable.$inferSelect;
