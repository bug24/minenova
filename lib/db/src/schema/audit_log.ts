import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

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
}, (t) => [
  index("audit_log_created_at_idx").on(t.createdAt),
  index("audit_log_actor_type_idx").on(t.actorType),
  index("audit_log_action_idx").on(t.action),
  index("audit_log_actor_username_idx").on(t.actorUsername),
]);
