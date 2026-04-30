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
import storageRouter from "./storage";
import boostRouter from "./boost";
import cvRouter from "./cv";
import institutionSubscriptionRouter from "./institution-subscription";
import employerSubscriptionRouter from "./employer-subscription";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

router.use("/candidates", requireAuth);
router.use("/applications", requireAuth);
router.use("/institutions", requireAuth);
// /dashboard hosts both public landing-page stats (used by `/`, the
// home route, while the user is signed out) AND private per-role
// dashboards (admin, employer, institution, candidate).  Globally
// requiring auth on `/dashboard/*` was causing the public home page
// to fire authenticated calls to `/dashboard/platform`,
// `/dashboard/activity`, and `/dashboard/salary-insights`, which
// returned 401 for signed-out viewers.  An older fetch wrapper
// shipped to some browsers reacted to those 401s by clearing the
// stored bearer token, which then broke any session that had just
// been established.  Whitelist the public stats paths and only gate
// the truly private subpaths.
const PUBLIC_DASHBOARD_PATHS = new Set([
  "/platform",
  "/activity",
  "/salary-insights",
]);
router.use("/dashboard", (req, res, next) => {
  if (PUBLIC_DASHBOARD_PATHS.has(req.path)) return next();
  return requireAuth(req, res, next);
});

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(siteContentRouter);
router.use(staffRouter);
router.use(orgRolesRouter);
router.use(notificationsRouter);
router.use(storageRouter);
router.use(boostRouter);
router.use(cvRouter);
router.use(institutionSubscriptionRouter);
router.use(employerSubscriptionRouter);
router.use(candidatesRouter);
router.use(employersRouter);
router.use(institutionsRouter);
router.use(jobsRouter);
router.use(applicationsRouter);
router.use(skillsRouter);
router.use(dashboardRouter);

export default router;
