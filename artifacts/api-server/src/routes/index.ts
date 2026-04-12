import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import miningRouter from "./mining";
import tasksRouter from "./tasks";
import referralsRouter from "./referrals";
import walletRouter from "./wallet";
import upgradesRouter from "./upgrades";
import leaderboardRouter from "./leaderboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(miningRouter);
router.use(tasksRouter);
router.use(referralsRouter);
router.use(walletRouter);
router.use(upgradesRouter);
router.use(leaderboardRouter);

export default router;
