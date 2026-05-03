import { Router, type IRouter } from "express";
import { db, tasksTable, userTaskCompletionsTable, usersTable, transactionsTable, shareMessagesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { CompleteTaskParams, GetTasksResponse, CompleteTaskResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const PLATFORM_MAP: Record<string, string> = {
  share_twitter: "twitter",
  share_facebook: "facebook",
  share_whatsapp: "whatsapp",
};

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.isActive, true)).orderBy(tasksTable.sortOrder);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const completionsToday = await db
    .select({ taskId: userTaskCompletionsTable.taskId })
    .from(userTaskCompletionsTable)
    .where(
      and(
        eq(userTaskCompletionsTable.userId, req.userId!),
        sql`${userTaskCompletionsTable.completedAt} >= ${today}`
      )
    );

  const completedTaskIds = new Set(completionsToday.map(c => c.taskId));

  const user = await db.select({ referralCode: usersTable.referralCode }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  const referralCode = user[0]?.referralCode ?? "";

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const shareLink = `${baseUrl}/register?ref=${referralCode}`;

  const activeMessages = await db.select().from(shareMessagesTable).where(eq(shareMessagesTable.isActive, true));

  const result = tasks.map(task => {
    let shareText: string | null = null;
    if (task.taskType.startsWith("share_")) {
      const platform = PLATFORM_MAP[task.taskType] ?? "general";
      const platformSpecific = activeMessages.filter(m => m.platform === platform);
      const general = activeMessages.filter(m => m.platform === "general");
      const pool = platformSpecific.length > 0 ? platformSpecific : general;
      const chosen = pickRandom(pool);
      if (chosen) {
        shareText = chosen.message.replace(/\{url\}/g, shareLink).replace(/\{referral_code\}/g, referralCode);
      } else {
        shareText = `Join me on MineNova! Earn free crypto daily by mining. Use my referral code: ${referralCode}\n${shareLink}`;
      }
    }
    let taskShareUrl: string | null = null;
    if (task.taskType.startsWith("share_") || task.taskType === "invite_friend") {
      taskShareUrl = shareLink;
    }
    if (task.taskType === "invite_friend" && !shareText) {
      shareText = `Join me on MineNova! Earn free crypto daily just by mining — no hardware needed.\n\nUse my referral link: ${shareLink}`;
    }
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      reward: task.reward,
      taskType: task.taskType,
      completedToday: completedTaskIds.has(task.id),
      shareUrl: taskShareUrl,
      shareText,
    };
  });

  res.json(GetTasksResponse.parse(result));
});

router.post("/tasks/:taskId/complete", requireAuth, async (req, res): Promise<void> => {
  const params = CompleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { taskId } = params.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!task || !task.isActive) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [alreadyDone] = await db
    .select()
    .from(userTaskCompletionsTable)
    .where(
      and(
        eq(userTaskCompletionsTable.userId, req.userId!),
        eq(userTaskCompletionsTable.taskId, taskId),
        sql`${userTaskCompletionsTable.completedAt} >= ${today}`
      )
    )
    .limit(1);

  if (alreadyDone) {
    res.status(400).json({ error: "Task already completed today" });
    return;
  }

  await db.insert(userTaskCompletionsTable).values({
    userId: req.userId!,
    taskId,
  });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  const newBalance = user.coinBalance + task.reward;
  const newTotalEarned = user.totalEarned + task.reward;

  await db.update(usersTable).set({ coinBalance: newBalance, totalEarned: newTotalEarned }).where(eq(usersTable.id, req.userId!));

  await db.insert(transactionsTable).values({
    userId: req.userId!,
    type: "task",
    amount: task.reward,
    status: "completed",
    description: `Completed: ${task.title}`,
  });

  res.json(CompleteTaskResponse.parse({
    coinsEarned: task.reward,
    newBalance,
    message: `Earned ${task.reward} coins from completing task!`,
  }));
});

export default router;
