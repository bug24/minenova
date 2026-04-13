import { Router, type IRouter } from "express";
import { db, shareMessagesTable, adminConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const DEFAULT_PASSWORD = process.env.ADMIN_SECRET || "minenova-admin-2024";

async function getAdminPassword(): Promise<string> {
  const [row] = await db
    .select({ value: adminConfigTable.value })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "admin_password"))
    .limit(1);
  return row?.value ?? DEFAULT_PASSWORD;
}

async function seedAdminConfig() {
  const [existing] = await db
    .select({ key: adminConfigTable.key })
    .from(adminConfigTable)
    .where(eq(adminConfigTable.key, "admin_password"))
    .limit(1);

  if (!existing) {
    await db.insert(adminConfigTable).values({ key: "admin_password", value: DEFAULT_PASSWORD });
  }
}

const requireAdmin = async (req: any, res: any, next: any) => {
  const secret = req.headers["x-admin-secret"] ?? req.query.secret;
  const currentPassword = await getAdminPassword();
  if (secret !== currentPassword) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

const DEFAULT_MESSAGES = [
  {
    platform: "general",
    message: "I came across this platform where you mine and actually withdraw your earnings as USDT, no delays, no stress.\n\nIt's simple and it's already paying users.\n\nTry it here:\n{url}",
    sortOrder: 0,
  },
  {
    platform: "general",
    message: "If you're looking for a legit way to earn crypto online, this is it. You mine NovaCoin, withdraw as USDT, and the payments are real.\n\nI've already cashed out. Give it a try:\n{url}",
    sortOrder: 1,
  },
  {
    platform: "general",
    message: "Earning crypto while I sleep? Yes, it's real.\n\nMineNova lets you run a 12-hour mining session and withdraw your earnings as USDT. No complicated setup, no gimmicks.\n\nJoin free:\n{url}",
    sortOrder: 2,
  },
  {
    platform: "twitter",
    message: "Just discovered a platform where you mine crypto and actually withdraw as USDT 💰 No delays, no stress — it's already paying users.\n\nTry it free 👇\n{url}",
    sortOrder: 0,
  },
  {
    platform: "twitter",
    message: "Mining crypto doesn't have to be complicated ⛏️\n\nMineNova: mine for 12 hours, earn coins, withdraw as USDT. Simple as that.\n\nSign up here 👉 {url}",
    sortOrder: 1,
  },
  {
    platform: "whatsapp",
    message: "Hey! I've been using this app called MineNova to mine crypto and withdraw as USDT. It's legit and already paying people out. Check it out here: {url}",
    sortOrder: 0,
  },
  {
    platform: "whatsapp",
    message: "Bro/Sis, you need to try this. It's a crypto mining app that actually pays — USDT withdrawals, no stress. I've been using it and it works. Link: {url}",
    sortOrder: 1,
  },
  {
    platform: "facebook",
    message: "I came across this platform where you mine and actually withdraw your earnings as USDT, no delays, no stress.\n\nIt's simple and it's already paying users.\n\nTry it here: {url}",
    sortOrder: 0,
  },
  {
    platform: "facebook",
    message: "Looking for a real way to earn crypto? MineNova lets you mine for free and withdraw as USDT. I've been using it — it actually works!\n\nJoin here: {url}",
    sortOrder: 1,
  },
];

async function seedDefaultMessages() {
  const existing = await db.select({ id: shareMessagesTable.id }).from(shareMessagesTable).limit(1);
  if (existing.length === 0) {
    await db.insert(shareMessagesTable).values(
      DEFAULT_MESSAGES.map(m => ({ ...m, isActive: true }))
    );
  }
}

seedAdminConfig().catch(console.error);
seedDefaultMessages().catch(console.error);

router.get("/admin/share-messages", requireAdmin, async (_req, res): Promise<void> => {
  const messages = await db.select().from(shareMessagesTable).orderBy(shareMessagesTable.platform, shareMessagesTable.sortOrder);
  res.json(messages);
});

router.post("/admin/share-messages", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    platform: z.enum(["twitter", "whatsapp", "facebook", "general"]),
    message: z.string().min(1),
    isActive: z.boolean().default(true),
    sortOrder: z.number().default(0),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.message }); return; }
  const [msg] = await db.insert(shareMessagesTable).values(data.data).returning();
  res.json(msg);
});

router.put("/admin/share-messages/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  const schema = z.object({
    platform: z.enum(["twitter", "whatsapp", "facebook", "general"]).optional(),
    message: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().optional(),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.message }); return; }
  const [msg] = await db.update(shareMessagesTable).set(data.data).where(eq(shareMessagesTable.id, id)).returning();
  if (!msg) { res.status(404).json({ error: "Not found" }); return; }
  res.json(msg);
});

router.delete("/admin/share-messages/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  await db.delete(shareMessagesTable).where(eq(shareMessagesTable.id, id));
  res.json({ success: true });
});

router.post("/admin/change-password", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
  });
  const data = schema.safeParse(req.body);
  if (!data.success) {
    res.status(400).json({ error: data.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  await db
    .update(adminConfigTable)
    .set({ value: data.data.newPassword })
    .where(eq(adminConfigTable.key, "admin_password"));
  res.json({ success: true });
});

export default router;
