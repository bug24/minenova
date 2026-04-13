import { Router, type IRouter } from "express";
import { db, adsTable } from "@workspace/db";
import { and, eq, ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/ads/random", async (req, res): Promise<void> => {
  const { placement } = req.query as { placement?: string };
  const target = (placement ?? "boost").trim();

  const [picked] = await db
    .select()
    .from(adsTable)
    .where(and(
      eq(adsTable.isActive, true),
      or(
        eq(adsTable.placement, target),
        ilike(adsTable.placement, `%${target}%`),
      ),
    ))
    .orderBy(sql`random()`)
    .limit(1);

  if (!picked) {
    res.status(404).json({ noAd: true });
    return;
  }

  res.json(picked);
});

export default router;
