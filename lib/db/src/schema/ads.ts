import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const adsTable = pgTable("ads", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  urlOrCode: text("url_or_code").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(15),
  placement: text("placement").notNull().default("boost"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Ad = typeof adsTable.$inferSelect;
