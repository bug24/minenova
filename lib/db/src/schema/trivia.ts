import { pgTable, serial, integer, real, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const triviaQuestionsTable = pgTable("trivia_questions", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  options: jsonb("options").notNull(),
  correctIndex: integer("correct_index").notNull(),
  category: text("category").notNull(),
  difficulty: text("difficulty").notNull().default("medium"),
  isActive: boolean("is_active").notNull().default(true),
});

export const triviaChallengesTable = pgTable("trivia_challenges", {
  id: serial("id").primaryKey(),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id),
  entryFee: real("entry_fee").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const triviaGamesTable = pgTable("trivia_games", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  status: text("status").notNull().default("active"),
  player1Id: integer("player1_id").notNull().references(() => usersTable.id),
  player2Id: integer("player2_id").references(() => usersTable.id),
  challengeId: integer("challenge_id").references(() => triviaChallengesTable.id),
  entryFee: real("entry_fee").notNull(),
  questionIds: jsonb("question_ids").notNull(),
  player1Answers: jsonb("player1_answers").notNull().default("[]"),
  player2Answers: jsonb("player2_answers").notNull().default("[]"),
  player1Score: integer("player1_score").notNull().default(0),
  player2Score: integer("player2_score").notNull().default(0),
  winnerId: integer("winner_id").references(() => usersTable.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export type TriviaQuestion = typeof triviaQuestionsTable.$inferSelect;
export type TriviaChallenge = typeof triviaChallengesTable.$inferSelect;
export type TriviaGame = typeof triviaGamesTable.$inferSelect;
