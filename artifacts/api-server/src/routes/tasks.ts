import { Router, type IRouter } from "express";
import { db, tasksTable, userTaskCompletionsTable, usersTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { CompleteTaskParams, GetTasksResponse, CompleteTaskResponse } from "@workspace/api-zod";

const router: IRouter = Router();

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

  const result = tasks.map(task => ({
    id: task.id,
    title: task.title,
    description: task.description,
    reward: task.reward,
    taskType: task.taskType,
    completedToday: completedTaskIds.has(task.id),
    shareUrl: task.taskType.startsWith("share_") ? `${baseUrl}/?ref=${referralCode}` : null,
  }));

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
