import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const shareMessagesTable = pgTable("share_messages", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  message: text("message").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShareMessage = typeof shareMessagesTable.$inferSelect;
