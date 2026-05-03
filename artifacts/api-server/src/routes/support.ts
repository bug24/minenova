import { Router, type IRouter, type Request, type Response } from "express";
import { db, supportMessagesTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { reserveUpload, verifyUploadOwnership, consumeUpload } from "../lib/avatarUploadRegistry";

const router: IRouter = Router();

// ─── User routes ─────────────────────────────────────────────────────────────

// GET /support/messages — load thread for this user, mark admin messages as read
router.get("/support/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const messages = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.userId, userId))
    .orderBy(supportMessagesTable.createdAt);

  // Mark unread admin messages as read
  await db
    .update(supportMessagesTable)
    .set({ isRead: true })
    .where(
      and(
        eq(supportMessagesTable.userId, userId),
        eq(supportMessagesTable.senderRole, "admin"),
        eq(supportMessagesTable.isRead, false),
      ),
    );

  res.json(messages);
});

// GET /support/unread-count — count of unread admin replies for this user
router.get("/support/unread-count", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportMessagesTable)
    .where(
      and(
        eq(supportMessagesTable.userId, userId),
        eq(supportMessagesTable.senderRole, "admin"),
        eq(supportMessagesTable.isRead, false),
      ),
    );
  res.json({ count: row?.count ?? 0 });
});

// POST /support/messages — user sends a message
router.post("/support/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const schema = z.object({
    message: z.string().min(1).max(2000).optional(),
    objectPath: z.string().optional(),
  }).refine(d => d.message || d.objectPath, {
    message: "At least a message or image is required",
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { message, objectPath } = parsed.data;

  let resolvedImageUrl: string | undefined;
  if (objectPath) {
    if (!verifyUploadOwnership(objectPath, userId)) {
      res.status(403).json({ error: "Upload not authorized or expired" });
      return;
    }
    consumeUpload(objectPath);
    resolvedImageUrl = `/api/storage/objects/${objectPath.replace(/^\/objects\//, "").replace(/^objects\//, "")}`;
  }

  // Auto-reopen thread if it was previously resolved
  await db
    .update(supportMessagesTable)
    .set({ isResolved: false })
    .where(eq(supportMessagesTable.userId, userId));

  const [msg] = await db
    .insert(supportMessagesTable)
    .values({
      userId,
      senderRole: "user",
      message: message ?? null,
      imageUrl: resolvedImageUrl ?? null,
      isRead: false,
    })
    .returning();

  res.json(msg);
});

// POST /support/uploads/request-url — request presigned URL for chat image
router.post("/support/uploads/request-url", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { ObjectStorageService } = await import("../lib/objectStorage");
  const objectStorageService = new ObjectStorageService();

  const schema = z.object({
    name: z.string(),
    size: z.number().max(5 * 1024 * 1024, "File size must not exceed 5 MB"),
    contentType: z.enum(["image/jpeg", "image/png"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    reserveUpload(objectPath, req.userId!);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, "Error generating support upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

// These are mounted in admin.ts to reuse requireAdmin / requirePermission

export async function getSupportThreads(_req: Request, res: Response): Promise<void> {
  // Distinct user IDs with their latest message + unread (user msgs) count for admin
  const threads = await db.execute(sql`
    SELECT
      sm.user_id AS "userId",
      u.username,
      u.avatar_url AS "avatarUrl",
      MAX(sm.created_at) AS "latestAt",
      MAX(sm.message) FILTER (WHERE sm.created_at = (SELECT MAX(created_at) FROM support_messages WHERE user_id = sm.user_id)) AS "latestMessage",
      COUNT(*) FILTER (WHERE sm.sender_role = 'user' AND sm.is_read = false) AS "unreadCount",
      bool_or(sm.is_resolved) AS "isResolved"
    FROM support_messages sm
    JOIN users u ON u.id = sm.user_id
    GROUP BY sm.user_id, u.username, u.avatar_url
    ORDER BY COUNT(*) FILTER (WHERE sm.sender_role = 'user' AND sm.is_read = false) DESC, MAX(sm.created_at) DESC
  `);
  res.json(threads.rows);
}

export async function getSupportThread(req: Request, res: Response): Promise<void> {
  const userId = parseInt(req.params.userId as string);
  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }

  const messages = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.userId, userId))
    .orderBy(supportMessagesTable.createdAt);

  // Mark user messages as read when admin opens thread
  await db
    .update(supportMessagesTable)
    .set({ isRead: true })
    .where(
      and(
        eq(supportMessagesTable.userId, userId),
        eq(supportMessagesTable.senderRole, "user"),
        eq(supportMessagesTable.isRead, false),
      ),
    );

  res.json(messages);
}

export async function postAdminReply(req: Request, res: Response): Promise<void> {
  const userId = parseInt(req.params.userId as string);
  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }

  const schema = z.object({
    message: z.string().min(1).max(2000).optional(),
    objectPath: z.string().optional(),
  }).refine(d => d.message || d.objectPath, {
    message: "At least a message or image is required",
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { message, objectPath } = parsed.data;

  // Verify user exists
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  let resolvedImageUrl: string | undefined;
  if (objectPath) {
    resolvedImageUrl = `/api/storage/objects/${objectPath.replace(/^\/objects\//, "").replace(/^objects\//, "")}`;
  }

  const [msg] = await db
    .insert(supportMessagesTable)
    .values({
      userId,
      senderRole: "admin",
      message: message ?? null,
      imageUrl: resolvedImageUrl ?? null,
      isRead: false,
    })
    .returning();

  res.json(msg);
}

export async function patchSupportResolve(req: Request, res: Response): Promise<void> {
  const userId = parseInt(req.params.userId as string);
  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db
    .update(supportMessagesTable)
    .set({ isResolved: true })
    .where(eq(supportMessagesTable.userId, userId));

  res.json({ success: true });
}

export async function getSupportUnreadCount(_req: Request, res: Response): Promise<void> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportMessagesTable)
    .where(
      and(
        eq(supportMessagesTable.senderRole, "user"),
        eq(supportMessagesTable.isRead, false),
      ),
    );
  res.json({ count: row?.count ?? 0 });
}

// Admin presigned URL for support chat image
export async function requestAdminUploadUrl(req: Request, res: Response): Promise<void> {
  const { ObjectStorageService } = await import("../lib/objectStorage");
  const objectStorageService = new ObjectStorageService();

  const schema = z.object({
    name: z.string(),
    size: z.number().max(5 * 1024 * 1024, "File size must not exceed 5 MB"),
    contentType: z.enum(["image/jpeg", "image/png"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch {
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
}

export default router;
