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
import siteContentRouter from "./site-content";
import staffRouter from "./staff";
import orgRolesRouter from "./org-roles";
import notificationsRouter from "./notifications";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

router.use("/candidates", requireAuth);
router.use("/applications", requireAuth);
router.use("/institutions", requireAuth);
router.use("/dashboard", requireAuth);

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(siteContentRouter);
router.use(staffRouter);
router.use(orgRolesRouter);
router.use(notificationsRouter);
router.use(candidatesRouter);
router.use(employersRouter);
router.use(institutionsRouter);
router.use(jobsRouter);
router.use(applicationsRouter);
router.use(skillsRouter);
router.use(dashboardRouter);

export default router;
