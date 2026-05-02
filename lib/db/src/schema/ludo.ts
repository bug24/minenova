import { pgTable, text, serial, timestamp, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ludoChallengesTable = pgTable("ludo_challenges", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  entryFee: real("entry_fee").notNull(),
  status: text("status").notNull().default("open"),
  opponentId: integer("opponent_id").references(() => usersTable.id),
  gameId: integer("game_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const ludoGamesTable = pgTable("ludo_games", {
  id: serial("id").primaryKey(),
  challengeId: integer("challenge_id").references(() => ludoChallengesTable.id),
  redPlayerId: integer("red_player_id").notNull().references(() => usersTable.id),
  bluePlayerId: integer("blue_player_id").notNull().references(() => usersTable.id),
  boardState: jsonb("board_state").notNull(),
  status: text("status").notNull().default("active"),
  winnerId: integer("winner_id").references(() => usersTable.id),
  entryFee: real("entry_fee").notNull(),
  lastMoveAt: timestamp("last_move_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const ludoMovesTable = pgTable("ludo_moves", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").notNull().references(() => ludoGamesTable.id),
  playerId: integer("player_id").notNull().references(() => usersTable.id),
  diceValue: integer("dice_value").notNull(),
  pieceIndex: integer("piece_index"),
  fromProgress: integer("from_progress"),
  toProgress: integer("to_progress"),
  captured: boolean("captured").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLudoChallengeSchema = createInsertSchema(ludoChallengesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLudoGameSchema = createInsertSchema(ludoGamesTable).omit({ id: true, startedAt: true });
export const insertLudoMoveSchema = createInsertSchema(ludoMovesTable).omit({ id: true, createdAt: true });

export type LudoChallenge = typeof ludoChallengesTable.$inferSelect;
export type LudoGame = typeof ludoGamesTable.$inferSelect;
export type LudoMove = typeof ludoMovesTable.$inferSelect;
