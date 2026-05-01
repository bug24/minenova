import type { Request, Response, NextFunction } from "express";
import { db, adminConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULT_PASSWORD = process.env.ADMIN_SECRET || "minenova-admin-2024";

async function getAdminPassword(): Promise<string> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "admin_password"))
    .limit(1);
  return row?.value ?? DEFAULT_PASSWORD;
}

export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const secret = (req.headers["x-admin-secret"] as string) ?? (req.query.secret as string);
  const currentPassword = await getAdminPassword();
  if (secret !== currentPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
