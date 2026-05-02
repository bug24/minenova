import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import miningRouter from "./mining";
import tasksRouter from "./tasks";
import referralsRouter from "./referrals";
import walletRouter from "./wallet";
import upgradesRouter from "./upgrades";
import leaderboardRouter from "./leaderboard";
import adminRouter from "./admin";
import adsRouter from "./ads";
import notificationsRouter from "./notifications";
import ludoRouter from "./ludo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(miningRouter);
router.use(tasksRouter);
router.use(referralsRouter);
router.use(walletRouter);
router.use(upgradesRouter);
router.use(leaderboardRouter);
router.use(adminRouter);
router.use(adsRouter);
router.use(notificationsRouter);
router.use(ludoRouter);

export default router;
