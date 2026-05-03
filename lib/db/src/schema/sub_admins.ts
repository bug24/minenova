import { pgTable, serial, text, boolean, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

export const ADMIN_MODULES = [
  "dashboard", "reports", "users", "withdrawals", "transactions",
  "mining", "referrals", "upgrades", "settings", "share", "ads", "scripts", "trivia",
] as const;

export type AdminModule = typeof ADMIN_MODULES[number];

export const subAdminsTable = pgTable("sub_admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subAdminPermissionsTable = pgTable("sub_admin_permissions", {
  subAdminId: integer("sub_admin_id").notNull().references(() => subAdminsTable.id, { onDelete: "cascade" }),
  module: text("module").notNull(),
  canRead: boolean("can_read").notNull().default(false),
  canWrite: boolean("can_write").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.subAdminId, t.module] })]);
