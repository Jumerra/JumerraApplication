import { Router, type IRouter } from "express";
import healthRouter from "./health";
import candidatesRouter from "./candidates";
import employersRouter from "./employers";
import institutionsRouter from "./institutions";
import jobsRouter from "./jobs";
import applicationsRouter from "./applications";
import skillsRouter from "./skills";
import dashboardRouter from "./dashboard";
import authRouter from "./auth";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(candidatesRouter);
router.use(employersRouter);
router.use(institutionsRouter);
router.use(jobsRouter);
router.use(applicationsRouter);
router.use(skillsRouter);
router.use(dashboardRouter);

export default router;
