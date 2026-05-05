import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const miningSessionsTable = pgTable("mining_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  coinsEarned: real("coins_earned").notNull().default(0),
  hashRate: real("hash_rate").notNull().default(10),
  boostMultiplier: real("boost_multiplier").notNull().default(1),
  boostEndsAt: timestamp("boost_ends_at", { withTimezone: true }),
  boostsUsedToday: integer("boosts_used_today").notNull().default(0),
  boostTiersUsed: text("boost_tiers_used").notNull().default(""),
  boostCoinsEarnedToday: real("boost_coins_earned_today").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMiningSessionSchema = createInsertSchema(miningSessionsTable).omit({ id: true, createdAt: true });
export type InsertMiningSession = z.infer<typeof insertMiningSessionSchema>;
export type MiningSession = typeof miningSessionsTable.$inferSelect;
