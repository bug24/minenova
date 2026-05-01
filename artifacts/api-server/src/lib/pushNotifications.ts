import webpush from "web-push";
import { db, miningSessionsTable, pushSubscriptionsTable } from "@workspace/db";
import { eq, and, lte, isNull } from "drizzle-orm";
import { logger } from "./logger";

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env["VAPID_PUBLIC_KEY"];
  const priv = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"];
  if (!pub || !priv || !subject) return false;
  try {
    webpush.setVapidDetails(subject, pub, priv);
    vapidConfigured = true;
    return true;
  } catch (err) {
    logger.warn({ err }, "VAPID configuration invalid — push notifications disabled");
    return false;
  }
}

export async function sendMiningCompleteNotifications() {
  if (!ensureVapid()) return;

  const now = new Date();

  const sessions = await db
    .select()
    .from(miningSessionsTable)
    .where(
      and(
        eq(miningSessionsTable.isActive, true),
        eq(miningSessionsTable.notificationSent, false),
        isNull(miningSessionsTable.claimedAt),
        lte(miningSessionsTable.endsAt, now),
      ),
    );

  if (sessions.length === 0) return;

  for (const session of sessions) {
    const subs = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, session.userId));

    const payload = JSON.stringify({
      title: "⛏️ Mining Complete!",
      body: "Tap to claim your coins before the next session.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: "/" },
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        } else {
          logger.warn({ err, subId: sub.id }, "Push send failed");
        }
      }
    }

    await db
      .update(miningSessionsTable)
      .set({ notificationSent: true })
      .where(eq(miningSessionsTable.id, session.id));
  }

  logger.info({ count: sessions.length }, "Mining notifications processed");
}

export async function sendAdminNotification(payload: { title: string; body: string; url?: string }) {
  if (!ensureVapid()) return;
  const adminUserId = parseInt(process.env["ADMIN_USER_ID"] ?? "0", 10);
  const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, adminUserId));
  if (subs.length === 0) return;
  const payloadStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url ?? "/admin" },
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payloadStr,
      );
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
      } else {
        logger.warn({ err, subId: sub.id }, "Admin push send failed");
      }
    }
  }
}

export function startNotificationJob() {
  if (!ensureVapid()) {
    logger.warn("VAPID keys not configured or invalid — push notifications disabled");
    return;
  }
  const INTERVAL_MS = 60_000;
  setInterval(() => {
    sendMiningCompleteNotifications().catch((err) =>
      logger.error({ err }, "Notification job error"),
    );
  }, INTERVAL_MS);
  logger.info("Push notification background job started (60s interval)");
}
