import { pgTable, serial, integer, real, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const minesGamesTable = pgTable("mines_games", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  bet: real("bet").notNull(),
  mineCount: integer("mine_count").notNull(),
  minePositions: jsonb("mine_positions").notNull(),
  revealedTiles: jsonb("revealed_tiles").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  currentMultiplier: real("current_multiplier").notNull().default(1),
  finalPayout: real("final_payout"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export type MinesGame = typeof minesGamesTable.$inferSelect;
