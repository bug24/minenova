import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const adminAuditLogTable = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  actorType: text("actor_type").notNull(),
  actorId: integer("actor_id"),
  actorUsername: text("actor_username").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
