import crypto from "node:crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import {
  eq,
  desc,
  sql,
  and,
  gte,
  lte,
  or,
  ilike,
  inArray,
  isNull,
  isNotNull,
} from "drizzle-orm";
import {
  passwordSetupTokensTable,
  sessionsTable,
  usersTable,
  pendingRegistrationsTable,
  candidatesTable,
  employersTable,
  institutionsTable,
  candidateInstitutionsTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import {
  adminRolesTable,
  adminRolePermissionsTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import { requireAdmin } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";
import { createSetupToken, findUserByEmail } from "../lib/auth";
import { sendAuthLinkEmail, originFromReq } from "../lib/email";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  isSuperAdminUser,
} from "../lib/permissions";

const router: Router = Router();

// Scope this middleware to /admin/* only — without the path prefix it
// would leak onto every other router mounted on /api after this one.
router.use("/admin", requireAdmin);

/**
 * GET /api/admin/registrations?status=pending|active|rejected|all
 * Returns sign-up applications with their submitted data.
 */
router.get("/admin/registrations", requirePermission("registrations:view"), async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "pending";
  const rows = await db
    .select({
      registrationId: pendingRegistrationsTable.id,
      submittedData: pendingRegistrationsTable.submittedData,
      reviewedAt: pendingRegistrationsTable.reviewedAt,
      decisionNote: pendingRegistrationsTable.decisionNote,
      registrationCreatedAt: pendingRegistrationsTable.createdAt,
      userId: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      userStatus: usersTable.status,
      candidateId: usersTable.candidateId,
      employerId: usersTable.employerId,
      institutionId: usersTable.institutionId,
    })
    .from(pendingRegistrationsTable)
    .innerJoin(usersTable, eq(usersTable.id, pendingRegistrationsTable.userId))
    .orderBy(desc(pendingRegistrationsTable.createdAt));
  const filtered =
    status === "all"
      ? rows
      : rows.filter((r) => r.userStatus === status);
  res.json({ registrations: filtered });
});

/**
 * POST /api/admin/registrations/:id/approve
 * Creates the linked entity (candidate/employer/institution) using
 * the data the user submitted at sign-up, links it back to the user,
 * and marks the user active.
 */
router.post("/admin/registrations/:id/approve", requirePermission("registrations:view"), async (req, res) => {
  try {
    const regId = Number(req.params.id);
    if (!Number.isFinite(regId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [reg] = await db
      .select()
      .from(pendingRegistrationsTable)
      .where(eq(pendingRegistrationsTable.id, regId))
      .limit(1);
    if (!reg) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, reg.userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.status === "active") {
      res.status(400).json({ error: "User already active" });
      return;
    }

    if (!["candidate", "employer", "institution"].includes(user.role)) {
      res.status(400).json({ error: "Cannot approve this role" });
      return;
    }

    const data = (reg.submittedData ?? {}) as Record<string, unknown>;
    const reviewerId = req.currentUser!.id;
    const decisionNote = (req.body?.note as string) ?? null;

    await db.transaction(async (tx) => {
      const updates: Partial<typeof usersTable.$inferInsert> = {
        status: "active",
        approvedAt: new Date(),
      };

      if (user.role === "candidate") {
        const [c] = await tx
          .insert(candidatesTable)
          .values({
            fullName: user.fullName,
            headline: (data.headline as string) ?? `${user.role} member`,
            bio: (data.bio as string) ?? "",
            location: (data.location as string) ?? "",
            email: user.email,
            phone: (data.phone as string) ?? "",
            avatarUrl:
              (data.avatarUrl as string) ??
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
                user.fullName,
              )}`,
            institutionId:
              typeof data.institutionId === "number"
                ? (data.institutionId as number)
                : null,
          })
          .returning();
        updates.candidateId = c.id;
        if (typeof data.institutionId === "number") {
          await tx.insert(candidateInstitutionsTable).values({
            candidateId: c.id,
            institutionId: data.institutionId as number,
            isPrimary: true,
          });
        }
      } else if (user.role === "employer") {
        updates.orgRole = "owner";
        const empName = (data.companyName as string) ?? user.fullName;
        const [e] = await tx
          .insert(employersTable)
          .values({
            name: empName,
            industry: (data.industry as string) ?? "Technology",
            location: (data.location as string) ?? "",
            websiteUrl: (data.websiteUrl as string) ?? "",
            logoUrl:
              (data.logoUrl as string) ??
              `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(empName)}`,
            coverUrl:
              (data.coverUrl as string) ??
              `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(empName)}`,
            tagline: (data.tagline as string) ?? "",
            description: (data.description as string) ?? "",
            size: (data.size as string) ?? "1-10",
          })
          .returning();
        updates.employerId = e.id;
      } else {
        updates.orgRole = "owner";
        const instName = (data.institutionName as string) ?? user.fullName;
        const [i] = await tx
          .insert(institutionsTable)
          .values({
            name: instName,
            type: (data.type as string) ?? "university",
            location: (data.location as string) ?? "",
            websiteUrl: (data.websiteUrl as string) ?? "",
            logoUrl:
              (data.logoUrl as string) ??
              `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(instName)}`,
            description: (data.description as string) ?? "",
          })
          .returning();
        updates.institutionId = i.id;
      }

      await tx.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
      await tx
        .update(pendingRegistrationsTable)
        .set({
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
          decisionNote,
        })
        .where(eq(pendingRegistrationsTable.id, reg.id));
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "approve failed");
    res.status(500).json({ error: "Approval failed" });
  }
});

/** POST /api/admin/registrations/:id/reject */
router.post("/admin/registrations/:id/reject", requirePermission("registrations:view"), async (req, res) => {
  try {
    const regId = Number(req.params.id);
    const [reg] = await db
      .select()
      .from(pendingRegistrationsTable)
      .where(eq(pendingRegistrationsTable.id, regId))
      .limit(1);
    if (!reg) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    await db
      .update(usersTable)
      .set({ status: "rejected" })
      .where(eq(usersTable.id, reg.userId));
    await db
      .update(pendingRegistrationsTable)
      .set({
        reviewedAt: new Date(),
        reviewedBy: req.currentUser!.id,
        decisionNote: (req.body?.note as string) ?? null,
      })
      .where(eq(pendingRegistrationsTable.id, reg.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "reject failed");
    res.status(500).json({ error: "Rejection failed" });
  }
});

/**
 * POST /api/admin/onboard
 * Admin directly creates an institution OR employer record + an
 * "invited" user. Returns a one-time setup link that the admin can
 * share with the new owner so they can set their password.
 *
 * Body shape:
 *   { role: 'institution'|'employer', email, fullName, entity: {...} }
 */
router.post("/admin/onboard", requirePermission("onboard:create"), async (req, res) => {
  try {
    const { role, email, fullName, entity } = req.body ?? {};
    if (
      typeof role !== "string" ||
      typeof email !== "string" ||
      typeof fullName !== "string" ||
      typeof entity !== "object" ||
      entity === null
    ) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    if (!["institution", "employer"].includes(role)) {
      res.status(400).json({ error: "Only institutions and employers can be onboarded" });
      return;
    }
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const entName = entity.name ?? fullName;

    const user = await db.transaction(async (tx) => {
      const updates: Partial<typeof usersTable.$inferInsert> = {};
      if (role === "institution") {
        const [i] = await tx
          .insert(institutionsTable)
          .values({
            name: entName,
            type: entity.type ?? "university",
            location: entity.location ?? "",
            websiteUrl: entity.websiteUrl ?? "",
            logoUrl:
              entity.logoUrl ??
              `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(entName)}`,
            description: entity.description ?? "",
            // Same auto-attribution as employers above.
            accountManagerId:
              req.currentUser?.orgRole === "account_manager"
                ? req.currentUser.id
                : null,
          })
          .returning();
        updates.institutionId = i.id;
      } else {
        const [e] = await tx
          .insert(employersTable)
          .values({
            name: entName,
            industry: entity.industry ?? "Technology",
            location: entity.location ?? "",
            websiteUrl: entity.websiteUrl ?? "",
            logoUrl:
              entity.logoUrl ??
              `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(entName)}`,
            coverUrl:
              entity.coverUrl ??
              `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(entName)}`,
            tagline: entity.tagline ?? "",
            description: entity.description ?? "",
            size: entity.size ?? "1-10",
            // Auto-attribution: an account_manager onboarding a new employer
            // takes ownership of that account. Super-admins can reassign
            // later via PATCH /admin/employers/:id/assign.
            accountManagerId:
              req.currentUser?.orgRole === "account_manager"
                ? req.currentUser.id
                : null,
          })
          .returning();
        updates.employerId = e.id;
      }

      const [created] = await tx
        .insert(usersTable)
        .values({
          email: normalizedEmail,
          passwordHash: null,
          role,
          status: "invited",
          fullName,
          orgRole: "owner",
          approvedAt: new Date(),
          ...updates,
        })
        .returning();
      return created;
    });

    const { setupUrl, expiresAt, token } = await createSetupToken(user.id);

    const emailResult = await sendAuthLinkEmail({
      to: user.email,
      fullName: user.fullName,
      linkPath: setupUrl,
      kind: "setup",
      origin: originFromReq(req),
      logger: req.log,
    });

    // SECURITY: only expose the setup URL to the inviter when email
    // delivery is NOT configured (the no-email fallback workflow).
    // Once a real provider is wired up the link is delivered to the
    // invitee directly and must not leak via the API response.
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      setupUrl: emailResult.sent ? null : setupUrl,
      expiresAt: expiresAt.toISOString(),
      emailSent: emailResult.sent,
    });
  } catch (err) {
    req.log.error({ err }, "onboard failed");
    res.status(500).json({ error: "Onboarding failed" });
  }
});

/**
 * GET /api/admin/onboarded
 * Lists invited users (admin-onboarded) so admins can re-share setup
 * links if needed.
 */
router.get("/admin/onboarded", requirePermission("onboard:create"), async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
      employerId: usersTable.employerId,
      institutionId: usersTable.institutionId,
    })
    .from(usersTable)
    .where(eq(usersTable.status, "invited"))
    .orderBy(desc(usersTable.createdAt));
  res.json({ users: rows });
});

/**
 * DELETE /api/admin/candidates/:id
 * Removes a candidate, their applications, institution affiliations,
 * and unlinks the auth user. Wrapped in a transaction so the operation
 * is atomic.
 */
router.delete("/admin/candidates/:id", requirePermission("candidates:manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const ok = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: candidatesTable.id })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, id));
      if (!existing) return false;
      await tx
        .delete(applicationsTable)
        .where(eq(applicationsTable.candidateId, id));
      await tx
        .delete(candidateInstitutionsTable)
        .where(eq(candidateInstitutionsTable.candidateId, id));
      await tx
        .update(usersTable)
        .set({ candidateId: null })
        .where(eq(usersTable.candidateId, id));
      await tx.delete(candidatesTable).where(eq(candidatesTable.id, id));
      return true;
    });
    if (!ok) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, id }, "delete candidate failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

/**
 * DELETE /api/admin/employers/:id
 * Removes an employer, all their jobs, all applications to those jobs,
 * and unlinks any users tied to the employer.
 */
router.delete("/admin/employers/:id", requirePermission("employers:manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const ok = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: employersTable.id })
        .from(employersTable)
        .where(eq(employersTable.id, id));
      if (!existing) return false;
      const jobs = await tx
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(eq(jobsTable.employerId, id));
      const jobIds = jobs.map((j) => j.id);
      if (jobIds.length > 0) {
        await tx
          .delete(applicationsTable)
          .where(
            sql`${applicationsTable.jobId} IN (${sql.join(
              jobIds.map((jid) => sql`${jid}`),
              sql`, `,
            )})`,
          );
        await tx.delete(jobsTable).where(eq(jobsTable.employerId, id));
      }
      // Clear both the org FK and the org role so that we never leave an
      // "owner with no org" account around — that state would silently
      // break org-owner middleware invariants.
      await tx
        .update(usersTable)
        .set({ employerId: null, orgRole: null })
        .where(eq(usersTable.employerId, id));
      await tx.delete(employersTable).where(eq(employersTable.id, id));
      return true;
    });
    if (!ok) {
      res.status(404).json({ error: "Employer not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, id }, "delete employer failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

/**
 * PATCH /api/admin/employers/:id/verify
 * Toggles the employer's verified flag. Body: { verified: boolean }.
 */
router.patch("/admin/employers/:id/verify", requirePermission("employers:manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const verified = Boolean(req.body?.verified);
  try {
    const [updated] = await db
      .update(employersTable)
      .set({ verified })
      .where(eq(employersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Employer not found" });
      return;
    }
    res.json({ ok: true, verified: updated.verified });
  } catch (err) {
    req.log.error({ err, id }, "verify employer failed");
    res.status(500).json({ error: "Update failed" });
  }
});

/**
 * GET /api/admin/account-managers
 * Lists all platform admins flagged as account_manager, plus how many
 * employers/institutions each one currently owns. Used by the
 * "Account Managers" admin page and by the reassign dropdowns on the
 * employers/institutions admin lists.
 */
router.get("/admin/account-managers", requirePermission("account-managers:view"), async (_req, res) => {
  const managers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "admin"),
        eq(usersTable.orgRole, "account_manager"),
      ),
    )
    .orderBy(usersTable.fullName);

  if (managers.length === 0) {
    res.json({ accountManagers: [] });
    return;
  }

  const managerIds = managers.map((m) => m.id);

  // Two batched count queries (one per entity) instead of N+1.
  const empCounts = await db
    .select({
      mid: employersTable.accountManagerId,
      n: sql<number>`count(*)::int`,
    })
    .from(employersTable)
    .where(inArray(employersTable.accountManagerId, managerIds))
    .groupBy(employersTable.accountManagerId);

  const instCounts = await db
    .select({
      mid: institutionsTable.accountManagerId,
      n: sql<number>`count(*)::int`,
    })
    .from(institutionsTable)
    .where(inArray(institutionsTable.accountManagerId, managerIds))
    .groupBy(institutionsTable.accountManagerId);

  const empByMid = new Map<number, number>();
  for (const r of empCounts) {
    if (r.mid != null) empByMid.set(r.mid, Number(r.n));
  }
  const instByMid = new Map<number, number>();
  for (const r of instCounts) {
    if (r.mid != null) instByMid.set(r.mid, Number(r.n));
  }

  res.json({
    accountManagers: managers.map((m) => ({
      id: m.id,
      email: m.email,
      fullName: m.fullName,
      status: m.status,
      assignedEmployerCount: empByMid.get(m.id) ?? 0,
      assignedInstitutionCount: instByMid.get(m.id) ?? 0,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

/**
 * Helper: assignments are super_admin only. Other admin roles can VIEW
 * who manages what but cannot move books between managers.
 */
function isSuperAdmin(
  user: { role: string; orgRole: string | null } | null | undefined,
): boolean {
  if (!user || user.role !== "admin") return false;
  // Treat null orgRole (legacy admins predating org_role) as super_admin
  // so existing accounts don't lose access.
  return user.orgRole === "super_admin" || user.orgRole === null;
}

async function validateManagerAssignment(
  managerId: number | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (managerId === null) return { ok: true };
  if (!Number.isFinite(managerId)) {
    return { ok: false, status: 400, error: "Invalid accountManagerId" };
  }
  const [m] = await db
    .select({ id: usersTable.id, role: usersTable.role, orgRole: usersTable.orgRole, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, managerId));
  if (!m) {
    return { ok: false, status: 404, error: "Account manager not found" };
  }
  if (m.role !== "admin" || m.orgRole !== "account_manager") {
    return {
      ok: false,
      status: 400,
      error: "Target user is not an account manager",
    };
  }
  if (m.status !== "active") {
    return {
      ok: false,
      status: 400,
      error: "Cannot assign to a non-active account manager",
    };
  }
  return { ok: true };
}

/**
 * PATCH /api/admin/employers/:id/assign
 * Body: { accountManagerId: number | null }
 * Super-admin only. Assigns or unassigns the employer's owning
 * account manager. Pass `null` to unassign.
 */
router.patch("/admin/employers/:id/assign", requirePermission("employers:manage"), async (req, res) => {
  if (!isSuperAdmin(req.currentUser)) {
    res.status(403).json({ error: "Only super-admins can reassign accounts" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const raw = req.body?.accountManagerId;
  const managerId: number | null =
    raw === null || raw === undefined ? null : Number(raw);

  const check = await validateManagerAssignment(managerId);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return;
  }

  const [updated] = await db
    .update(employersTable)
    .set({ accountManagerId: managerId })
    .where(eq(employersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Employer not found" });
    return;
  }
  res.json({ ok: true, accountManagerId: updated.accountManagerId });
});

/**
 * PATCH /api/admin/institutions/:id/assign
 * Same shape and rules as the employer counterpart above.
 */
router.patch("/admin/institutions/:id/assign", requirePermission("institutions:manage"), async (req, res) => {
  if (!isSuperAdmin(req.currentUser)) {
    res.status(403).json({ error: "Only super-admins can reassign accounts" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const raw = req.body?.accountManagerId;
  const managerId: number | null =
    raw === null || raw === undefined ? null : Number(raw);

  const check = await validateManagerAssignment(managerId);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return;
  }

  const [updated] = await db
    .update(institutionsTable)
    .set({ accountManagerId: managerId })
    .where(eq(institutionsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }
  res.json({ ok: true, accountManagerId: updated.accountManagerId });
});

/**
 * DELETE /api/admin/institutions/:id
 * Removes an institution, all candidate-institution affiliations
 * tied to it, and unlinks any users belonging to it.
 */
router.delete("/admin/institutions/:id", requirePermission("institutions:manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const ok = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: institutionsTable.id })
        .from(institutionsTable)
        .where(eq(institutionsTable.id, id));
      if (!existing) return false;
      await tx
        .delete(candidateInstitutionsTable)
        .where(eq(candidateInstitutionsTable.institutionId, id));
      await tx
        .update(candidatesTable)
        .set({ institutionId: null })
        .where(eq(candidatesTable.institutionId, id));
      // Clear both the org FK and the org role so we don't leave behind
      // an "owner with no org" account.
      await tx
        .update(usersTable)
        .set({ institutionId: null, orgRole: null })
        .where(eq(usersTable.institutionId, id));
      await tx.delete(institutionsTable).where(eq(institutionsTable.id, id));
      return true;
    });
    if (!ok) {
      res.status(404).json({ error: "Institution not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, id }, "delete institution failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

/**
 * GET /api/admin/applications
 * Cross-platform application list with optional status / date / text filters.
 */
router.get("/admin/applications", requirePermission("applications:view"), async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "all";
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;
  const q = ((req.query.q as string | undefined) ?? "").trim();
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 500);

  const fromDate = fromRaw ? new Date(fromRaw) : undefined;
  const toDate = toRaw ? new Date(toRaw) : undefined;

  const conds = [];
  const VALID = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];
  if (status !== "all" && VALID.includes(status)) {
    conds.push(eq(applicationsTable.status, status));
  }
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    conds.push(gte(applicationsTable.appliedAt, fromDate));
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    conds.push(lte(applicationsTable.appliedAt, toDate));
  }
  if (q.length > 0) {
    const like = `%${q}%`;
    const qCond = or(
      ilike(candidatesTable.fullName, like),
      ilike(employersTable.name, like),
      ilike(jobsTable.title, like),
    );
    if (qCond) conds.push(qCond);
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: applicationsTable.id,
      jobId: applicationsTable.jobId,
      jobTitle: jobsTable.title,
      candidateId: applicationsTable.candidateId,
      candidateName: candidatesTable.fullName,
      candidateAvatarUrl: candidatesTable.avatarUrl,
      employerId: jobsTable.employerId,
      employerName: employersTable.name,
      employerLogoUrl: employersTable.logoUrl,
      status: applicationsTable.status,
      matchScore: applicationsTable.matchScore,
      coverNote: applicationsTable.coverNote,
      appliedAt: applicationsTable.appliedAt,
      updatedAt: applicationsTable.updatedAt,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(where)
    .orderBy(desc(applicationsTable.appliedAt))
    .limit(limit);

  res.json({
    applications: rows.map((r) => ({
      ...r,
      candidateAvatarUrl: r.candidateAvatarUrl ?? "",
      employerLogoUrl: r.employerLogoUrl ?? "",
      coverNote: r.coverNote ?? "",
      appliedAt: r.appliedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

/**
 * DELETE /api/admin/applications/:id
 */
router.delete("/admin/applications/:id", requirePermission("applications:view"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  await db.delete(applicationsTable).where(eq(applicationsTable.id, id));
  res.json({ ok: true });
});

/**
 * GET /api/admin/accounts
 * Lists candidate / employer / institution user accounts with their
 * activation status. Used by the manage pages to surface
 * activate/deactivate + reset-password actions per row.
 */
router.get("/admin/accounts", requirePermission("staff:view"), async (req, res) => {
  const role = typeof req.query.role === "string" ? req.query.role : undefined;
  const allowedRoles = ["candidate", "employer", "institution"] as const;
  type AllowedRole = (typeof allowedRoles)[number];
  const conditions = role && (allowedRoles as readonly string[]).includes(role)
    ? eq(usersTable.role, role as AllowedRole)
    : inArray(usersTable.role, allowedRoles as unknown as string[]);

  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      candidateId: usersTable.candidateId,
      employerId: usersTable.employerId,
      institutionId: usersTable.institutionId,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(conditions)
    .orderBy(desc(usersTable.createdAt));

  res.json({
    accounts: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/**
 * PATCH /api/admin/users/:id/status
 * Activate or deactivate a user. Disabled users cannot log in but their
 * profile and history are preserved. Admins cannot disable themselves
 * (would lock everyone out if they're the last admin); they also cannot
 * change another admin's status from this endpoint to keep the admin
 * pool managed via the dedicated admin-team flow.
 */
router.patch("/admin/users/:id/status", requirePermission("staff:manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const next = req.body?.status;
  if (next !== "active" && next !== "disabled") {
    res
      .status(400)
      .json({ error: "status must be 'active' or 'disabled'" });
    return;
  }
  const me = req.currentUser!;
  if (id === me.id) {
    res.status(400).json({ error: "You cannot change your own status" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.role === "admin") {
    res.status(400).json({
      error: "Admin accounts cannot be activated/disabled here",
    });
    return;
  }
  // pending/rejected/invited are sign-up lifecycle states. We refuse to
  // overwrite them via this endpoint to avoid bypassing the registration
  // review (admin should approve via the registrations flow first).
  if (next === "active" && user.status !== "disabled" && user.status !== "active") {
    res.status(400).json({
      error: `Cannot activate a user in '${user.status}' state. Use the registrations flow first.`,
    });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ status: next })
    .where(eq(usersTable.id, id))
    .returning({
      userId: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      candidateId: usersTable.candidateId,
      employerId: usersTable.employerId,
      institutionId: usersTable.institutionId,
      createdAt: usersTable.createdAt,
    });
  res.json({
    account: { ...updated, createdAt: updated.createdAt.toISOString() },
  });
});

/**
 * POST /api/admin/users/:id/reset-password
 * Issues a fresh setup token, clears the user's password hash, and (when
 * they were active) flips them to 'invited' so login is blocked until
 * they complete the new setup flow. Email delivery is attempted; when
 * not configured, the setupUrl is returned in the response so the admin
 * can hand it to the user out of band.
 */
router.post("/admin/users/:id/reset-password", requirePermission("staff:manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (req.currentUser!.id === id) {
    res.status(400).json({
      error:
        "You cannot reset your own password from here. Use the standard password reset flow.",
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.role === "admin") {
    res.status(403).json({
      error: "Admin accounts cannot be reset from this surface.",
    });
    return;
  }
  if (user.status === "pending" || user.status === "rejected") {
    res.status(400).json({
      error: `Cannot reset password for a user in '${user.status}' state.`,
    });
    return;
  }

  // Atomic: invalidate any prior unused setup tokens, lock the account by
  // wiping the password and flipping it to 'invited', and insert the fresh
  // token in a single transaction. If anything fails the whole thing rolls
  // back so we never leave the account in an unrecoverable state.
  const SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(passwordSetupTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordSetupTokensTable.userId, id),
          isNull(passwordSetupTokensTable.usedAt),
        ),
      );
    await tx
      .update(usersTable)
      .set({ passwordHash: null, status: "invited" })
      .where(eq(usersTable.id, id));
    await tx.insert(passwordSetupTokensTable).values({
      userId: id,
      token,
      expiresAt,
    });
  });
  const setupUrl = `/setup-password?token=${token}`;

  // Hard-revoke any active sessions belonging to this user so the previous
  // credentials/cookie cannot continue making authenticated requests after
  // the password has been wiped. connect-pg-simple stores the session JSON
  // under sessionsTable.sess; userId lives in `sess->>'userId'`.
  await db
    .delete(sessionsTable)
    .where(sql`(${sessionsTable.sess}->>'userId')::int = ${id}`);

  const emailResult = await sendAuthLinkEmail({
    to: user.email,
    fullName: user.fullName,
    linkPath: setupUrl,
    kind: "reset",
    origin: originFromReq(req),
    logger: req.log,
  });

  // Same security posture as /admin/onboard: only leak the link to the
  // admin when no real email provider delivered it.
  res.json({
    setupUrl: emailResult.sent ? null : setupUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: emailResult.sent,
  });
});

/**
 * GET /api/admin/analytics/institutions
 * Per-institution roll-up:
 *  - candidateCount   = unique candidates affiliated via candidate_institutions
 *  - applicationCount = total applications submitted by those candidates
 *  - hiredCount       = total hired applications from those candidates
 * Application/hire counts are application-level (one hire per application
 * with status='hired'), matching the existing hires analytics semantics.
 */
router.get("/admin/analytics/institutions", requirePermission("partner-analytics:view"), async (_req, res) => {
  const rows = await db.execute<{
    institution_id: number;
    institution_name: string;
    location: string;
    candidate_count: string;
    application_count: string;
    hired_count: string;
  }>(sql`
    SELECT
      i.id AS institution_id,
      i.name AS institution_name,
      i.location AS location,
      COUNT(DISTINCT ci.candidate_id)::text AS candidate_count,
      COUNT(DISTINCT a.id)::text AS application_count,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::text AS hired_count
    FROM ${institutionsTable} i
    LEFT JOIN ${candidateInstitutionsTable} ci ON ci.institution_id = i.id
    LEFT JOIN ${applicationsTable} a ON a.candidate_id = ci.candidate_id
    GROUP BY i.id, i.name, i.location
    ORDER BY candidate_count DESC, i.name ASC
  `);
  const mapped = rows.rows.map((r) => ({
    institutionId: r.institution_id,
    institutionName: r.institution_name,
    location: r.location ?? "",
    candidateCount: Number(r.candidate_count),
    applicationCount: Number(r.application_count),
    hiredCount: Number(r.hired_count),
  }));
  const totalCandidates = mapped.reduce((s, r) => s + r.candidateCount, 0);
  const totalHires = mapped.reduce((s, r) => s + r.hiredCount, 0);
  res.json({ totalCandidates, totalHires, rows: mapped });
});

/**
 * GET /api/admin/analytics/employers
 * Per-employer activity roll-up: number of jobs posted, applications
 * received, hires made, and unique candidates hired.
 */
router.get("/admin/analytics/employers", requirePermission("partner-analytics:view"), async (_req, res) => {
  const rows = await db.execute<{
    employer_id: number;
    employer_name: string;
    industry: string;
    jobs_count: string;
    applications_count: string;
    hires_count: string;
    unique_candidates_hired: string;
  }>(sql`
    SELECT
      e.id AS employer_id,
      e.name AS employer_name,
      e.industry AS industry,
      COUNT(DISTINCT j.id)::text AS jobs_count,
      COUNT(DISTINCT a.id)::text AS applications_count,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::text AS hires_count,
      COUNT(DISTINCT a.candidate_id) FILTER (WHERE a.status = 'hired')::text AS unique_candidates_hired
    FROM ${employersTable} e
    LEFT JOIN ${jobsTable} j ON j.employer_id = e.id
    LEFT JOIN ${applicationsTable} a ON a.job_id = j.id
    GROUP BY e.id, e.name, e.industry
    ORDER BY hires_count DESC, applications_count DESC, e.name ASC
  `);
  const mapped = rows.rows.map((r) => ({
    employerId: r.employer_id,
    employerName: r.employer_name,
    industry: r.industry ?? "",
    jobsCount: Number(r.jobs_count),
    applicationsCount: Number(r.applications_count),
    hiresCount: Number(r.hires_count),
    uniqueCandidatesHired: Number(r.unique_candidates_hired),
  }));
  const totalHires = mapped.reduce((s, r) => s + r.hiresCount, 0);
  res.json({ totalEmployers: mapped.length, totalHires, rows: mapped });
});

/**
 * CSV exports for the partner analytics views above. Not in OpenAPI spec
 * because they return text/csv. Same admin-only guard.
 */
function csvEscape(val: string | number): string {
  let s = String(val);
  // Defuse spreadsheet formula injection: any cell that starts with =, +,
  // -, @ or a tab is treated as a formula by Excel/Sheets/Numbers when the
  // CSV is opened. Prefixing a single quote neutralises it.
  if (s.length > 0 && /^[=+\-@\t]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sendCsv(
  res: import("express").Response,
  filename: string,
  lines: string[],
): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
}

router.get("/admin/analytics/institutions.csv", requirePermission("partner-analytics:view"), async (_req, res) => {
  const result = await db.execute<{
    institution_id: number;
    institution_name: string;
    location: string;
    candidate_count: string;
    application_count: string;
    hired_count: string;
  }>(sql`
    SELECT
      i.id AS institution_id,
      i.name AS institution_name,
      i.location AS location,
      COUNT(DISTINCT ci.candidate_id)::text AS candidate_count,
      COUNT(DISTINCT a.id)::text AS application_count,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::text AS hired_count
    FROM ${institutionsTable} i
    LEFT JOIN ${candidateInstitutionsTable} ci ON ci.institution_id = i.id
    LEFT JOIN ${applicationsTable} a ON a.candidate_id = ci.candidate_id
    GROUP BY i.id, i.name, i.location
    ORDER BY candidate_count DESC, i.name ASC
  `);
  const lines = [
    "# TalentLink institution analytics",
    `# Generated,${new Date().toISOString()}`,
    "",
    "institution_id,institution_name,location,candidates,applications,hires",
  ];
  for (const r of result.rows) {
    lines.push(
      [
        r.institution_id,
        csvEscape(r.institution_name),
        csvEscape(r.location ?? ""),
        r.candidate_count,
        r.application_count,
        r.hired_count,
      ].join(","),
    );
  }
  sendCsv(
    res,
    `talentlink-institutions-${new Date().toISOString().slice(0, 10)}.csv`,
    lines,
  );
});

router.get("/admin/analytics/employers.csv", requirePermission("partner-analytics:view"), async (_req, res) => {
  const result = await db.execute<{
    employer_id: number;
    employer_name: string;
    industry: string;
    jobs_count: string;
    applications_count: string;
    hires_count: string;
    unique_candidates_hired: string;
  }>(sql`
    SELECT
      e.id AS employer_id,
      e.name AS employer_name,
      e.industry AS industry,
      COUNT(DISTINCT j.id)::text AS jobs_count,
      COUNT(DISTINCT a.id)::text AS applications_count,
      COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::text AS hires_count,
      COUNT(DISTINCT a.candidate_id) FILTER (WHERE a.status = 'hired')::text AS unique_candidates_hired
    FROM ${employersTable} e
    LEFT JOIN ${jobsTable} j ON j.employer_id = e.id
    LEFT JOIN ${applicationsTable} a ON a.job_id = j.id
    GROUP BY e.id, e.name, e.industry
    ORDER BY hires_count DESC, applications_count DESC, e.name ASC
  `);
  const lines = [
    "# TalentLink employer analytics",
    `# Generated,${new Date().toISOString()}`,
    "",
    "employer_id,employer_name,industry,jobs,applications,hires,unique_candidates_hired",
  ];
  for (const r of result.rows) {
    lines.push(
      [
        r.employer_id,
        csvEscape(r.employer_name),
        csvEscape(r.industry ?? ""),
        r.jobs_count,
        r.applications_count,
        r.hires_count,
        r.unique_candidates_hired,
      ].join(","),
    );
  }
  sendCsv(
    res,
    `talentlink-employers-${new Date().toISOString().slice(0, 10)}.csv`,
    lines,
  );
});

/**
 * GET /api/admin/hires/analytics?bucket=day|week|month|year&from&to
 * Aggregates hires (applications.status='hired') keyed off updatedAt
 * (when the status was set). Returns a continuous series with zero-filled
 * buckets so the chart never has gaps.
 */
const BUCKET_TO_PG: Record<string, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

function defaultRange(bucket: string, now: Date): { from: Date; to: Date } {
  const to = new Date(now);
  const from = new Date(now);
  if (bucket === "day") from.setDate(from.getDate() - 29);
  else if (bucket === "week") from.setDate(from.getDate() - 7 * 11);
  else if (bucket === "month") from.setMonth(from.getMonth() - 11);
  else from.setFullYear(from.getFullYear() - 4);
  return { from, to };
}

function truncateUTC(d: Date, bucket: string): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (bucket === "day") return x;
  if (bucket === "week") {
    // Postgres date_trunc('week') uses Monday as week start (ISO).
    const day = x.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day + 6) % 7; // days since Monday
    x.setUTCDate(x.getUTCDate() - diff);
    return x;
  }
  if (bucket === "month") return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1));
  return new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
}

function advance(d: Date, bucket: string): Date {
  const x = new Date(d);
  if (bucket === "day") x.setUTCDate(x.getUTCDate() + 1);
  else if (bucket === "week") x.setUTCDate(x.getUTCDate() + 7);
  else if (bucket === "month") x.setUTCMonth(x.getUTCMonth() + 1);
  else x.setUTCFullYear(x.getUTCFullYear() + 1);
  return x;
}

function labelFor(d: Date, bucket: string): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (bucket === "day" || bucket === "week") return `${y}-${m}-${day}`;
  if (bucket === "month") return `${y}-${m}`;
  return String(y);
}

async function loadHireBuckets(bucket: string, from: Date, to: Date) {
  const pgBucket = BUCKET_TO_PG[bucket] ?? "day";
  // Force the truncation into UTC so the bucket boundaries match the
  // JS-side `truncateUTC` keys regardless of the Postgres session
  // timezone. Without `AT TIME ZONE 'UTC'`, `date_trunc` uses the session
  // TZ and produces shifted boundaries that the JS lookup map misses.
  const rows = await db.execute<{ period: Date; count: string }>(sql`
    SELECT (date_trunc(${pgBucket}, ${applicationsTable.updatedAt} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS period,
           COUNT(*)::text AS count
    FROM ${applicationsTable}
    WHERE ${applicationsTable.status} = 'hired'
      AND ${applicationsTable.updatedAt} >= ${from}
      AND ${applicationsTable.updatedAt} <= ${to}
    GROUP BY period
    ORDER BY period ASC
  `);
  const counts = new Map<number, number>();
  for (const r of rows.rows) {
    const d = new Date(r.period);
    counts.set(d.getTime(), Number(r.count));
  }
  const points: { periodStart: string; label: string; count: number }[] = [];
  let cursor = truncateUTC(from, bucket);
  const end = truncateUTC(to, bucket);
  while (cursor.getTime() <= end.getTime()) {
    points.push({
      periodStart: cursor.toISOString(),
      label: labelFor(cursor, bucket),
      count: counts.get(cursor.getTime()) ?? 0,
    });
    cursor = advance(cursor, bucket);
    if (points.length > 5000) break;
  }
  const total = points.reduce((s, p) => s + p.count, 0);
  return { points, total };
}

router.get("/admin/hires/analytics", requirePermission("hires:view"), async (req, res) => {
  const bucket = (() => {
    const b = (req.query.bucket as string | undefined) ?? "day";
    return ["day", "week", "month", "year"].includes(b) ? b : "day";
  })();
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;
  const now = new Date();
  const def = defaultRange(bucket, now);
  const from = fromRaw ? new Date(fromRaw) : def.from;
  const to = toRaw ? new Date(toRaw) : def.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }
  const { points, total } = await loadHireBuckets(bucket, from, to);
  res.json({
    bucket,
    from: from.toISOString(),
    to: to.toISOString(),
    total,
    points,
  });
});

/**
 * GET /api/admin/hires/export.csv?bucket=...&from=...&to=...
 * Streams the same data as the analytics endpoint, plus a row-per-hire
 * CSV download. Not in the OpenAPI spec because it returns text/csv.
 */
router.get("/admin/hires/export.csv", requirePermission("hires:view"), async (req, res) => {
  const bucket = (() => {
    const b = (req.query.bucket as string | undefined) ?? "day";
    return ["day", "week", "month", "year"].includes(b) ? b : "day";
  })();
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;
  const now = new Date();
  const def = defaultRange(bucket, now);
  const from = fromRaw ? new Date(fromRaw) : def.from;
  const to = toRaw ? new Date(toRaw) : def.to;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    res.status(400).send("Invalid date range");
    return;
  }
  const { points, total } = await loadHireBuckets(bucket, from, to);

  const escape = (val: string | number) => {
    const s = String(val);
    if (s.includes(",") || s.includes("\n") || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines: string[] = [];
  lines.push(`# TalentLink hires export`);
  lines.push(`# Bucket,${bucket}`);
  lines.push(`# Range,${from.toISOString()},${to.toISOString()}`);
  lines.push(`# Total hires,${total}`);
  lines.push(``);
  lines.push(`period_start,label,hires`);
  for (const p of points) {
    lines.push(`${p.periodStart},${escape(p.label)},${p.count}`);
  }

  const filename = `talentlink-hires-${bucket}-${from
    .toISOString()
    .slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});

// =====================================================================
// Role management — super-admin only.
// Lets super-admins author custom admin sub-roles and edit which
// permissions each grants.
// =====================================================================

function requireSuperAdmin(
  req: { currentUser?: User | null },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): boolean {
  if (!isSuperAdminUser(req.currentUser)) {
    res.status(403).json({ error: "Only super-admins can manage roles" });
    return false;
  }
  return true;
}

/**
 * GET /api/admin/permissions
 * Returns the static catalog used to render the role-management UI.
 */
router.get("/admin/permissions", (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  res.json({ permissions: PERMISSIONS });
});

/**
 * GET /api/admin/roles
 * Lists every admin role with its current permission set and how many
 * users hold it. Super-admin only.
 */
router.get("/admin/roles", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const roles = await db
    .select()
    .from(adminRolesTable)
    .where(eq(adminRolesTable.scope, "admin"))
    .orderBy(desc(adminRolesTable.isSystem), adminRolesTable.name);
  const roleIds = roles.map((r) => r.id);
  const perms =
    roleIds.length > 0
      ? await db
          .select()
          .from(adminRolePermissionsTable)
          .where(inArray(adminRolePermissionsTable.roleId, roleIds))
      : [];
  const counts = await db
    .select({
      orgRole: usersTable.orgRole,
      count: sql<number>`count(*)::int`,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), isNotNull(usersTable.orgRole)))
    .groupBy(usersTable.orgRole);
  const countByName = new Map<string, number>();
  for (const c of counts) {
    if (c.orgRole) countByName.set(c.orgRole, Number(c.count ?? 0));
  }
  res.json({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      createdAt: r.createdAt.toISOString(),
      permissions: perms
        .filter((p) => p.roleId === r.id)
        .map((p) => p.permission),
      memberCount: countByName.get(r.name) ?? 0,
    })),
  });
});

const ROLE_NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

function validatePermissionList(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = new Set<string>();
  for (const k of input) {
    if (typeof k !== "string" || !PERMISSION_KEYS.has(k)) return null;
    out.add(k);
  }
  return Array.from(out);
}

/**
 * POST /api/admin/roles
 * Body: { name, description?, permissions: string[] }
 * Creates a custom (non-system) admin role.
 */
router.post("/admin/roles", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const { name, description, permissions } = req.body ?? {};
  if (typeof name !== "string" || !ROLE_NAME_RE.test(name)) {
    res.status(400).json({
      error:
        "name must be lowercase letters, digits, or underscores (2-31 chars)",
    });
    return;
  }
  const perms = validatePermissionList(permissions);
  if (perms === null) {
    res.status(400).json({ error: "permissions must be an array of valid keys" });
    return;
  }
  // Wrap insert + permission rows in one transaction so a partial
  // failure can't leave a role with no permission rows. Catch the
  // unique-name violation as 409 (instead of bubbling as 500) to make
  // concurrent same-name creates race-safe.
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(adminRolesTable)
        .values({
          name,
          description: typeof description === "string" ? description : "",
          isSystem: false,
        })
        .returning();
      if (perms.length > 0) {
        await tx
          .insert(adminRolePermissionsTable)
          .values(
            perms.map((permission) => ({ roleId: row.id, permission })),
          );
      }
      return row;
    });
    res.status(201).json({ id: created.id, name: created.name });
  } catch (err: any) {
    // 23505 = unique_violation in Postgres (admin_roles_name_unique)
    if (err?.code === "23505") {
      res.status(409).json({ error: "A role with that name already exists" });
      return;
    }
    throw err;
  }
});

/**
 * PATCH /api/admin/roles/:id
 * Body: { description?, permissions? }
 * Edits description and/or permission set. System role names cannot
 * change. Permissions for super_admin cannot be edited (always all).
 */
router.patch("/admin/roles/:id", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [role] = await db
    .select()
    .from(adminRolesTable)
    .where(and(eq(adminRolesTable.id, id), eq(adminRolesTable.scope, "admin")))
    .limit(1);
  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  if (role.name === "super_admin") {
    res.status(400).json({ error: "super_admin permissions cannot be edited" });
    return;
  }
  const { description, permissions } = req.body ?? {};
  if (description !== undefined && description !== null && typeof description !== "string") {
    res.status(400).json({ error: "description must be a string or null" });
    return;
  }
  let perms: string[] | null = null;
  if (permissions !== undefined) {
    perms = validatePermissionList(permissions);
    if (perms === null) {
      res.status(400).json({ error: "permissions must be an array of valid keys" });
      return;
    }
  }
  await db.transaction(async (tx) => {
    if (description !== undefined) {
      await tx
        .update(adminRolesTable)
        .set({ description: description ?? null, updatedAt: new Date() })
        .where(eq(adminRolesTable.id, id));
    }
    if (perms !== null) {
      await tx
        .delete(adminRolePermissionsTable)
        .where(eq(adminRolePermissionsTable.roleId, id));
      if (perms.length > 0) {
        await tx
          .insert(adminRolePermissionsTable)
          .values(perms.map((permission) => ({ roleId: id, permission })));
      }
    }
  });
  res.json({ ok: true });
});

/**
 * DELETE /api/admin/roles/:id
 * Refuses if the role is a system role or if any user currently holds it.
 */
router.delete("/admin/roles/:id", async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [role] = await db
    .select()
    .from(adminRolesTable)
    .where(and(eq(adminRolesTable.id, id), eq(adminRolesTable.scope, "admin")))
    .limit(1);
  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  if (role.isSystem) {
    res.status(400).json({ error: "System roles cannot be deleted" });
    return;
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.orgRole, role.name)));
  if (Number(count ?? 0) > 0) {
    res
      .status(400)
      .json({ error: `Cannot delete: ${count} user(s) still have this role` });
    return;
  }
  await db.delete(adminRolesTable).where(eq(adminRolesTable.id, id));
  res.json({ ok: true });
});

export default router;
