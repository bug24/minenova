import { pgTable, text, serial, timestamp, integer, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const upgradesTable = pgTable("upgrades", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  tier: integer("tier").notNull().default(1),
  hashRateBoost: real("hash_rate_boost").notNull().default(0),
  dailyCapBoost: real("daily_cap_boost").notNull().default(0),
  coinCost: real("coin_cost"),
  usdtCost: real("usdt_cost"),
  isAutoMining: boolean("is_auto_mining").notNull().default(false),
  badge: text("badge"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userUpgradesTable = pgTable("user_upgrades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  upgradeId: integer("upgrade_id").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUpgradeSchema = createInsertSchema(upgradesTable).omit({ id: true, createdAt: true });
export const insertUserUpgradeSchema = createInsertSchema(userUpgradesTable).omit({ id: true, purchasedAt: true });
export type InsertUpgrade = z.infer<typeof insertUpgradeSchema>;
export type Upgrade = typeof upgradesTable.$inferSelect;
export type UserUpgrade = typeof userUpgradesTable.$inferSelect;
