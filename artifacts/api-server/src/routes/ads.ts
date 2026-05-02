import { Router, type IRouter } from "express";
import { db, adsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/ads/random", async (req, res): Promise<void> => {
  const { placement } = req.query as { placement?: string };
  const target = (placement ?? "boost").trim();

  // Try to find an ad matching the requested placement exactly.
  const [picked] = await db
    .select()
    .from(adsTable)
    .where(and(
      eq(adsTable.isActive, true),
      sql`${target} = any(string_to_array(${adsTable.placement}, ','))`,
    ))
    .orderBy(sql`random()`)
    .limit(1);

  if (picked) {
    res.json(picked);
    return;
  }

  // Fall back to legacy "boost" catch-all placement so older ads still serve.
  const [legacy] = await db
    .select()
    .from(adsTable)
    .where(and(
      eq(adsTable.isActive, true),
      sql`'boost' = any(string_to_array(${adsTable.placement}, ','))`,
    ))
    .orderBy(sql`random()`)
    .limit(1);

  if (legacy) {
    res.json(legacy);
    return;
  }

  res.status(404).json({ noAd: true });
});

export default router;
