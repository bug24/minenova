import { Router, type IRouter } from "express";
import { db, adsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/ads/random", async (req, res): Promise<void> => {
  const { placement } = req.query as { placement?: string };
  const target = (placement ?? "boost").trim();

  const [picked] = await db
    .select()
    .from(adsTable)
    .where(and(
      eq(adsTable.isActive, true),
      sql`${target} = any(string_to_array(${adsTable.placement}, ','))`,
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
