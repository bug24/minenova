import { pgTable, text, serial, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const whotChallengesTable = pgTable("whot_challenges", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  entryFee: real("entry_fee").notNull(),
  status: text("status").notNull().default("open"),
  opponentId: integer("opponent_id").references(() => usersTable.id),
  gameId: integer("game_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const whotGamesTable = pgTable("whot_games", {
  id: serial("id").primaryKey(),
  challengeId: integer("challenge_id").references(() => whotChallengesTable.id),
  player0Id: integer("player0_id").notNull().references(() => usersTable.id),
  player1Id: integer("player1_id").notNull().references(() => usersTable.id),
  gameState: jsonb("game_state").notNull(),
  status: text("status").notNull().default("active"),
  winnerId: integer("winner_id").references(() => usersTable.id),
  entryFee: real("entry_fee").notNull(),
  lastMoveAt: timestamp("last_move_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const whotMovesTable = pgTable("whot_moves", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => whotGamesTable.id),
  playerId: integer("player_id").notNull().references(() => usersTable.id),
  action: text("action").notNull(),
  cardPlayed: jsonb("card_played"),
  calledSuit: text("called_suit"),
  drewCount: integer("drew_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhotChallengeSchema = createInsertSchema(whotChallengesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWhotGameSchema = createInsertSchema(whotGamesTable).omit({ id: true, startedAt: true });
export const insertWhotMoveSchema = createInsertSchema(whotMovesTable).omit({ id: true, createdAt: true });

export type WhotChallenge = typeof whotChallengesTable.$inferSelect;
export type WhotGame = typeof whotGamesTable.$inferSelect;
export type WhotMove = typeof whotMovesTable.$inferSelect;
