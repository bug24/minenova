import { Router, type IRouter } from "express";
import { db, adsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/ads/random", async (req, res): Promise<void> => {
  const { placement } = req.query as { placement?: string };
  const target = (placement ?? "boost").trim();

  const active = await db.select().from(adsTable).where(eq(adsTable.isActive, true));
  const matching = active.filter(r =>
    r.placement.split(",").map(s => s.trim()).includes(target)
  );

  if (matching.length === 0) {
    res.status(404).json({ noAd: true });
    return;
  }

  const picked = matching[Math.floor(Math.random() * matching.length)];
  res.json(picked);
});

export default router;
