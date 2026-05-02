import { Router, type IRouter } from "express";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/notifications/vapid-public-key", requireAuth, (_req, res): void => {
  const key = process.env["VAPID_PUBLIC_KEY"];
  if (!key) { res.status(503).json({ error: "Push notifications not configured" }); return; }
  res.json({ publicKey: key });
});

router.post("/notifications/subscribe", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as unknown as { userId: number }).userId;
  const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Invalid subscription object" }); return;
  }

  await db
    .insert(pushSubscriptionsTable)
    .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });

  res.json({ ok: true });
});

router.delete("/notifications/unsubscribe", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as unknown as { userId: number }).userId;
  const { endpoint } = req.body as { endpoint?: string };

  if (!endpoint) { res.status(400).json({ error: "endpoint required" }); return; }

  await db
    .delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, endpoint)));

  res.json({ ok: true });
});

export default router;
