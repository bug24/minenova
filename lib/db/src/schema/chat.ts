import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatBannedWordsTable = pgTable("chat_banned_words", {
  id: serial("id").primaryKey(),
  phrase: text("phrase").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportMessagesTable = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  senderRole: text("sender_role", { enum: ["user", "admin"] }).notNull(),
  message: text("message"),
  imageUrl: text("image_url"),
  isRead: boolean("is_read").notNull().default(false),
  isResolved: boolean("is_resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("support_messages_user_id_created_at_idx").on(t.userId, t.createdAt),
]);

export const chatMutesTable = pgTable("chat_mutes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  reason: text("reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = permanent ban
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("chat_mutes_user_id_idx").on(t.userId),
]);
