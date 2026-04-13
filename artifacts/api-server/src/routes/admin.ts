import { Router, type IRouter } from "express";
import { db, shareMessagesTable, upgradesTable, adminConfigTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || "minenova-admin-2024";

const requireAdmin = (req: any, res: any, next: any) => {
  const secret = req.headers["x-admin-secret"] ?? req.query.secret;
  if (secret !== ADMIN_SECRET) {
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

seedDefaultMessages().catch(console.error);

const DEFAULT_UPGRADES = [
  { tier: 1, name: "Speed Boost I", description: "Increase your mining speed by 20% permanently", hashRateBoost: 20, dailyCapBoost: 140, coinCost: 500, usdtCost: 5, isAutoMining: false, sortOrder: 1, badge: null, icon: "⚡" },
  { tier: 2, name: "Speed Boost II", description: "Increase mining speed to 1.5x permanently", hashRateBoost: 50, dailyCapBoost: 180, coinCost: 1500, usdtCost: 15, isAutoMining: false, sortOrder: 2, badge: "Popular", icon: "🚀" },
  { tier: 3, name: "Speed Boost III", description: "Double your mining speed permanently (2x base)", hashRateBoost: 100, dailyCapBoost: 250, coinCost: 3000, usdtCost: 30, isAutoMining: false, sortOrder: 3, badge: null, icon: "⛏️" },
  { tier: 4, name: "Mining Level 4", description: "Elite mining tier — 2.5x base mining speed", hashRateBoost: 150, dailyCapBoost: 350, coinCost: 6000, usdtCost: 60, isAutoMining: false, sortOrder: 4, badge: "Best Value", icon: "💎" },
  { tier: 5, name: "Auto Miner Pro", description: "Maximum speed (3x) with automatic mining sessions", hashRateBoost: 200, dailyCapBoost: 500, coinCost: 10000, usdtCost: 100, isAutoMining: true, sortOrder: 5, badge: "Elite", icon: "🤖" },
];

async function seedUpgrades() {
  for (const upgrade of DEFAULT_UPGRADES) {
    const rows = await db
      .select()
      .from(upgradesTable)
      .where(eq(upgradesTable.tier, upgrade.tier))
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      await db.insert(upgradesTable).values(upgrade);
    } else if (!existing.icon || existing.usdtCost === null || existing.usdtCost === undefined) {
      await db
        .update(upgradesTable)
        .set({
          name: upgrade.name,
          description: upgrade.description,
          hashRateBoost: upgrade.hashRateBoost,
          dailyCapBoost: upgrade.dailyCapBoost,
          coinCost: upgrade.coinCost,
          usdtCost: upgrade.usdtCost,
          isAutoMining: upgrade.isAutoMining,
          sortOrder: upgrade.sortOrder,
          badge: upgrade.badge,
          icon: upgrade.icon,
        })
        .where(eq(upgradesTable.tier, upgrade.tier));
    }
  }
}

seedUpgrades().catch(console.error);

router.get("/admin/config", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(adminConfigTable);
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  res.json(config);
});

router.post("/admin/config", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({ key: z.string().min(1), value: z.string() });
  const data = schema.safeParse(req.body);
  if (!data.success) { res.status(400).json({ error: data.error.message }); return; }
  const { key, value } = data.data;
  await db
    .insert(adminConfigTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: adminConfigTable.key, set: { value, updatedAt: sql`NOW()` } });
  res.json({ success: true, key, value });
});

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

export default router;
