import { Router } from "express";
import { db } from "@workspace/db";
import { and, eq, isNotNull, isNull, ne, desc, inArray } from "drizzle-orm";
import {
  adminRolesTable,
  employersTable,
  institutionDepartmentsTable,
  institutionFacultiesTable,
  institutionsTable,
  usersTable,
} from "@workspace/db";
import {
  requireAuth,
  requireOrgMember,
  requireOrgOwnerOrRegistrar,
} from "../middleware/require-auth";
import { createSetupToken, findUserByEmail } from "../lib/auth";
import { sendAuthLinkEmail, originFromReq } from "../lib/email";
import { enforceStarterQuota } from "../lib/institution-quotas";

/**
 * Validates that `orgRole` is a defined role within the caller's
 * org. For admins this is global; for employer/institution it must
 * exist within the specific orgId.
 */
async function isValidOrgRole(
  topLevelRole: string,
  orgRole: string,
  orgId: number | null,
): Promise<boolean> {
  let scope: "admin" | "employer" | "institution" | null = null;
  if (topLevelRole === "admin") scope = "admin";
  else if (topLevelRole === "employer") scope = "employer";
  else if (topLevelRole === "institution") scope = "institution";
  if (!scope) return false;
  const filters = [
    eq(adminRolesTable.scope, scope),
    eq(adminRolesTable.name, orgRole),
  ];
  if (scope === "employer") {
    if (orgId === null) return false;
    filters.push(eq(adminRolesTable.employerId, orgId));
  } else if (scope === "institution") {
    if (orgId === null) return false;
    filters.push(eq(adminRolesTable.institutionId, orgId));
  } else {
    filters.push(isNull(adminRolesTable.employerId));
    filters.push(isNull(adminRolesTable.institutionId));
  }
  const [row] = await db
    .select({ id: adminRolesTable.id })
    .from(adminRolesTable)
    .where(and(...filters))
    .limit(1);
  return !!row;
}

const router: Router = Router();

/**
 * Resolves the human-readable name for a set of department ids in one
 * round-trip. Used by `/staff` to enrich the response so the table can
 * render names without a follow-up call per row.
 */
async function resolveDepartmentNames(
  departmentIds: number[],
): Promise<Map<number, string>> {
  const ids = Array.from(new Set(departmentIds.filter((n) => Number.isFinite(n))));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: institutionDepartmentsTable.id,
      name: institutionDepartmentsTable.name,
    })
    .from(institutionDepartmentsTable)
    .where(inArray(institutionDepartmentsTable.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Validates that a department id belongs to the given institution.
 * Used to prevent a malicious owner from assigning a coordinator to
 * another institution's department by guessing ids.
 */
async function departmentBelongsToInstitution(
  departmentId: number,
  institutionId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: institutionDepartmentsTable.id })
    .from(institutionDepartmentsTable)
    .where(
      and(
        eq(institutionDepartmentsTable.id, departmentId),
        eq(institutionDepartmentsTable.institutionId, institutionId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Validates that a faculty id belongs to the given institution.
 * Mirrors `departmentBelongsToInstitution` so dean assignments can't
 * be hijacked across orgs by guessing ids.
 */
async function facultyBelongsToInstitution(
  facultyId: number,
  institutionId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: institutionFacultiesTable.id })
    .from(institutionFacultiesTable)
    .where(
      and(
        eq(institutionFacultiesTable.id, facultyId),
        eq(institutionFacultiesTable.institutionId, institutionId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Resolves the human-readable name for a set of faculty ids in one
 * round-trip. Sister to `resolveDepartmentNames` for dean staffers.
 */
async function resolveFacultyNames(
  facultyIds: number[],
): Promise<Map<number, string>> {
  const ids = Array.from(new Set(facultyIds.filter((n) => Number.isFinite(n))));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: institutionFacultiesTable.id,
      name: institutionFacultiesTable.name,
    })
    .from(institutionFacultiesTable)
    .where(inArray(institutionFacultiesTable.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Public summary of a staff member used by the team page. Department
 * name is supplied separately so the call can batch the lookups across
 * a list of staffers.
 */
function toStaffRow(
  u: typeof usersTable.$inferSelect,
  departmentName: string | null = null,
  facultyName: string | null = null,
) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    orgRole: u.orgRole,
    status: u.status,
    employerId: u.employerId,
    institutionId: u.institutionId,
    assignedDepartmentId: u.assignedDepartmentId ?? null,
    assignedDepartmentName: departmentName,
    assignedFacultyId: u.assignedFacultyId ?? null,
    assignedFacultyName: facultyName,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * GET /api/staff
 * Returns the staff visible to the current user:
 *   admin       -> all users with role=admin
 *   employer    -> all users with the same employerId
 *   institution -> all users with the same institutionId
 * Requires the caller to be a member of an organization.
 */
router.get("/staff", requireOrgMember, async (req, res) => {
  const me = req.currentUser!;
  let rows: Array<typeof usersTable.$inferSelect> = [];
  if (me.role === "admin") {
    rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .orderBy(desc(usersTable.createdAt));
  } else if (me.role === "employer" && me.employerId !== null) {
    rows = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "employer"),
          eq(usersTable.employerId, me.employerId),
        ),
      )
      .orderBy(desc(usersTable.createdAt));
  } else if (me.role === "institution" && me.institutionId !== null) {
    rows = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "institution"),
          eq(usersTable.institutionId, me.institutionId),
        ),
      )
      .orderBy(desc(usersTable.createdAt));
  }
  const deptNames = await resolveDepartmentNames(
    rows
      .map((r) => r.assignedDepartmentId)
      .filter((id): id is number => typeof id === "number"),
  );
  const facultyNames = await resolveFacultyNames(
    rows
      .map((r) => r.assignedFacultyId)
      .filter((id): id is number => typeof id === "number"),
  );
  res.json({
    members: rows.map((r) =>
      toStaffRow(
        r,
        r.assignedDepartmentId != null
          ? deptNames.get(r.assignedDepartmentId) ?? null
          : null,
        r.assignedFacultyId != null
          ? facultyNames.get(r.assignedFacultyId) ?? null
          : null,
      ),
    ),
  });
});

/**
 * Resolves and validates a (departmentId, facultyId) pair against the
 * caller's role rules:
 *   * owner/registrar → both must be null (org-wide)
 *   * dean            → facultyId required, departmentId must be null
 *   * hod             → departmentId required, facultyId must be null
 *   * coordinator     → optional departmentId, no facultyId
 *   * viewer          → both must be null
 * Returns either `{ ok: true, deptId, facultyId }` for the resolved
 * values or `{ ok: false, error }` describing the validation failure.
 */
async function resolveInstitutionScope(
  orgRole: string,
  institutionId: number,
  rawDeptId: unknown,
  rawFacultyId: unknown,
): Promise<
  | { ok: true; deptId: number | null; facultyId: number | null }
  | { ok: false; error: string }
> {
  const isInt = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v);
  const deptProvided = rawDeptId !== undefined && rawDeptId !== null;
  const facultyProvided = rawFacultyId !== undefined && rawFacultyId !== null;
  if (deptProvided && !isInt(rawDeptId)) {
    return { ok: false, error: "assignedDepartmentId must be an integer" };
  }
  if (facultyProvided && !isInt(rawFacultyId)) {
    return { ok: false, error: "assignedFacultyId must be an integer" };
  }
  switch (orgRole) {
    case "owner":
    case "registrar":
    case "viewer":
      return { ok: true, deptId: null, facultyId: null };
    case "dean": {
      if (!facultyProvided) {
        return {
          ok: false,
          error: "Dean requires assignedFacultyId",
        };
      }
      if (deptProvided) {
        return {
          ok: false,
          error: "Dean cannot also have assignedDepartmentId",
        };
      }
      const facultyId = rawFacultyId as number;
      if (!(await facultyBelongsToInstitution(facultyId, institutionId))) {
        return {
          ok: false,
          error: "Faculty does not belong to your institution",
        };
      }
      return { ok: true, deptId: null, facultyId };
    }
    case "hod": {
      if (!deptProvided) {
        return {
          ok: false,
          error: "Head of Department requires assignedDepartmentId",
        };
      }
      if (facultyProvided) {
        return {
          ok: false,
          error: "Head of Department cannot also have assignedFacultyId",
        };
      }
      const deptId = rawDeptId as number;
      if (!(await departmentBelongsToInstitution(deptId, institutionId))) {
        return {
          ok: false,
          error: "Department does not belong to your institution",
        };
      }
      return { ok: true, deptId, facultyId: null };
    }
    case "coordinator": {
      if (facultyProvided) {
        return {
          ok: false,
          error: "Coordinator cannot have assignedFacultyId",
        };
      }
      if (deptProvided) {
        const deptId = rawDeptId as number;
        if (!(await departmentBelongsToInstitution(deptId, institutionId))) {
          return {
            ok: false,
            error: "Department does not belong to your institution",
          };
        }
        return { ok: true, deptId, facultyId: null };
      }
      return { ok: true, deptId: null, facultyId: null };
    }
    default:
      // For unknown roles (admin, custom org roles) leave scope cleared.
      return { ok: true, deptId: null, facultyId: null };
  }
}

/**
 * POST /api/staff/invite
 * Body: { email, fullName, orgRole, assignedDepartmentId?, assignedFacultyId? }
 * Owner / Registrar / super_admin invites a new teammate to their own
 * org. Creates an "invited" user with a one-time setup token and emails
 * the link.
 */
router.post("/staff/invite", requireOrgOwnerOrRegistrar, async (req, res) => {
  try {
    const me = req.currentUser!;
    const { email, fullName, orgRole, assignedDepartmentId, assignedFacultyId } =
      req.body ?? {};
    if (
      typeof email !== "string" ||
      typeof fullName !== "string" ||
      typeof orgRole !== "string"
    ) {
      res
        .status(400)
        .json({ error: "email, fullName, and orgRole are required" });
      return;
    }
    const meOrgId =
      me.role === "employer"
        ? me.employerId
        : me.role === "institution"
          ? me.institutionId
          : null;
    if (!(await isValidOrgRole(me.role, orgRole, meOrgId))) {
      res.status(400).json({
        error: `Invalid orgRole "${orgRole}" for ${me.role}`,
      });
      return;
    }

    // Department/faculty scoping is only meaningful for institution
    // staff. For employer/admin invites the values are silently
    // dropped. For institution invites the role determines whether
    // dept or faculty (or neither) is required.
    let resolvedDeptId: number | null = null;
    let resolvedFacultyId: number | null = null;
    if (me.role === "institution") {
      const scope = await resolveInstitutionScope(
        orgRole,
        me.institutionId!,
        assignedDepartmentId,
        assignedFacultyId,
      );
      if (!scope.ok) {
        res.status(400).json({ error: scope.error });
        return;
      }
      resolvedDeptId = scope.deptId;
      resolvedFacultyId = scope.facultyId;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      res
        .status(409)
        .json({ error: "An account with that email already exists" });
      return;
    }

    // Starter staff-seat cap — institutions only. Employer seats are
    // gated separately by the employer subscription. Checked AFTER the
    // duplicate-email guard so an existing-user 409 still takes
    // precedence over the upsell.
    if (me.role === "institution" && me.institutionId != null) {
      const quotaErr = await enforceStarterQuota(
        me.institutionId,
        "staffSeats",
      );
      if (quotaErr) {
        res.status(quotaErr.status).json(quotaErr.body);
        return;
      }
    }

    const baseInsert = {
      email: normalizedEmail,
      passwordHash: null,
      role: me.role,
      status: "invited" as const,
      fullName,
      orgRole,
      approvedAt: new Date(),
      employerId: me.role === "employer" ? me.employerId : null,
      institutionId: me.role === "institution" ? me.institutionId : null,
      assignedDepartmentId: resolvedDeptId,
      assignedFacultyId: resolvedFacultyId,
    };

    const [created] = await db
      .insert(usersTable)
      .values(baseInsert)
      .returning();

    const { setupUrl, expiresAt, token } = await createSetupToken(created.id);

    const emailResult = await sendAuthLinkEmail({
      to: created.email,
      fullName: created.fullName,
      linkPath: setupUrl,
      kind: "setup",
      origin: originFromReq(req),
      logger: req.log,
    });

    const deptNames = await resolveDepartmentNames(
      resolvedDeptId != null ? [resolvedDeptId] : [],
    );
    const facultyNames = await resolveFacultyNames(
      resolvedFacultyId != null ? [resolvedFacultyId] : [],
    );

    // SECURITY: only expose the setup URL to the inviter when email
    // delivery is NOT configured. Once a real provider is wired up the
    // link is delivered to the invitee directly and must not leak via
    // the API response. The raw `token` is never returned (the URL is
    // sufficient for the no-email fallback workflow).
    res.status(201).json({
      member: toStaffRow(
        created,
        resolvedDeptId != null ? deptNames.get(resolvedDeptId) ?? null : null,
        resolvedFacultyId != null
          ? facultyNames.get(resolvedFacultyId) ?? null
          : null,
      ),
      setupUrl: emailResult.sent ? null : setupUrl,
      expiresAt: expiresAt.toISOString(),
      emailSent: emailResult.sent,
    });
  } catch (err) {
    req.log.error({ err }, "staff invite failed");
    res.status(500).json({ error: "Invite failed" });
  }
});

/**
 * DELETE /api/staff/:id
 * Owner/super_admin removes a teammate from the same org. Cannot
 * remove yourself. Cannot remove the last owner of an employer or
 * institution org.
 */
router.delete("/staff/:id", requireOrgOwnerOrRegistrar, async (req, res) => {
  try {
    const me = req.currentUser!;
    const targetId = Number(req.params.id);
    if (!Number.isFinite(targetId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (targetId === me.id) {
      res.status(400).json({ error: "You cannot remove yourself" });
      return;
    }
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, targetId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Same-org check
    if (me.role === "admin") {
      if (target.role !== "admin") {
        res.status(403).json({ error: "Cannot remove non-admin from here" });
        return;
      }
    } else if (me.role === "employer") {
      if (
        target.role !== "employer" ||
        target.employerId !== me.employerId
      ) {
        res.status(403).json({ error: "Member belongs to another org" });
        return;
      }
    } else if (me.role === "institution") {
      if (
        target.role !== "institution" ||
        target.institutionId !== me.institutionId
      ) {
        res.status(403).json({ error: "Member belongs to another org" });
        return;
      }
    }

    // Last-owner protection (only enforced for org-scoped roles)
    if (target.orgRole === "owner" && me.role !== "admin") {
      const orgFilter =
        me.role === "employer"
          ? and(
              eq(usersTable.role, "employer"),
              eq(usersTable.employerId, me.employerId!),
              eq(usersTable.orgRole, "owner"),
              ne(usersTable.id, target.id),
              isNotNull(usersTable.employerId),
            )
          : and(
              eq(usersTable.role, "institution"),
              eq(usersTable.institutionId, me.institutionId!),
              eq(usersTable.orgRole, "owner"),
              ne(usersTable.id, target.id),
              isNotNull(usersTable.institutionId),
            );
      const remaining = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(orgFilter);
      if (remaining.length === 0) {
        res
          .status(400)
          .json({ error: "Cannot remove the last owner of this organization" });
        return;
      }
    }

    await db.delete(usersTable).where(eq(usersTable.id, target.id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "staff remove failed");
    res.status(500).json({ error: "Remove failed" });
  }
});

/**
 * PATCH /api/staff/:id/role
 * Body: { orgRole: string }
 * Owner / super_admin can change a teammate's org_role within the same
 * top-level role (admin, employer, institution). Cannot change your own
 * role and cannot demote the last owner of an org.
 */
router.patch("/staff/:id/role", requireOrgOwnerOrRegistrar, async (req, res) => {
  try {
    const me = req.currentUser!;
    const targetId = Number(req.params.id);
    const { orgRole, assignedDepartmentId, assignedFacultyId } = req.body ?? {};
    // `assignedDepartmentId` and `assignedFacultyId` participate in
    // three modes each:
    //   - omitted (`undefined`) → leave the existing value unchanged
    //   - `null`                → clear the assignment (org-wide access)
    //   - integer               → assign to that scope
    const hasDeptUpdate = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "assignedDepartmentId",
    );
    const hasFacultyUpdate = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "assignedFacultyId",
    );
    if (!Number.isFinite(targetId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (typeof orgRole !== "string") {
      res.status(400).json({ error: "orgRole is required" });
      return;
    }
    if (targetId === me.id) {
      res.status(400).json({ error: "You cannot change your own role" });
      return;
    }
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, targetId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Same-org check (mirrors the delete handler)
    if (me.role === "admin") {
      if (target.role !== "admin") {
        res
          .status(403)
          .json({ error: "Cannot change non-admin from here" });
        return;
      }
    } else if (me.role === "employer") {
      if (
        target.role !== "employer" ||
        target.employerId !== me.employerId
      ) {
        res.status(403).json({ error: "Member belongs to another org" });
        return;
      }
    } else if (me.role === "institution") {
      if (
        target.role !== "institution" ||
        target.institutionId !== me.institutionId
      ) {
        res.status(403).json({ error: "Member belongs to another org" });
        return;
      }
    }

    const targetOrgId =
      target.role === "employer"
        ? target.employerId
        : target.role === "institution"
          ? target.institutionId
          : null;
    if (!(await isValidOrgRole(target.role, orgRole, targetOrgId))) {
      res
        .status(400)
        .json({ error: `Invalid orgRole "${orgRole}" for ${target.role}` });
      return;
    }

    // Last-owner protection: don't allow demoting the only owner of an
    // employer/institution org (admins exempt).
    if (
      target.orgRole === "owner" &&
      orgRole !== "owner" &&
      me.role !== "admin"
    ) {
      const orgFilter =
        me.role === "employer"
          ? and(
              eq(usersTable.role, "employer"),
              eq(usersTable.employerId, me.employerId!),
              eq(usersTable.orgRole, "owner"),
              ne(usersTable.id, target.id),
              isNotNull(usersTable.employerId),
            )
          : and(
              eq(usersTable.role, "institution"),
              eq(usersTable.institutionId, me.institutionId!),
              eq(usersTable.orgRole, "owner"),
              ne(usersTable.id, target.id),
              isNotNull(usersTable.institutionId),
            );
      const remaining = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(orgFilter);
      if (remaining.length === 0) {
        res
          .status(400)
          .json({ error: "Cannot demote the last owner of this organization" });
        return;
      }
    }

    // If we're demoting an account_manager into another admin role,
    // their employer/institution assignments would otherwise become
    // orphaned (the manager roster only counts users whose orgRole is
    // still account_manager). Clear those assignments so super-admin
    // can reassign them cleanly.
    const isDemotingManager =
      target.role === "admin" &&
      target.orgRole === "account_manager" &&
      orgRole !== "account_manager";

    // Resolve the (department, faculty) change for institution staff.
    // For non-institution targets these stay unchanged. For institution
    // targets we feed the *intended* values (request override OR
    // current row value) into the role-aware validator.
    let nextDeptId: number | null | undefined = undefined;
    let nextFacultyId: number | null | undefined = undefined;
    if (target.role === "institution" && target.institutionId != null) {
      // Treat undefined-but-no-update as "use existing value" so the
      // validator can enforce role-specific requirements (e.g. dean
      // must end up with a faculty even if the caller only updated
      // orgRole and faculty was already set).
      const intendedDept = hasDeptUpdate
        ? assignedDepartmentId
        : target.assignedDepartmentId;
      const intendedFaculty = hasFacultyUpdate
        ? assignedFacultyId
        : target.assignedFacultyId;
      const scope = await resolveInstitutionScope(
        orgRole,
        target.institutionId,
        intendedDept,
        intendedFaculty,
      );
      if (!scope.ok) {
        res.status(400).json({ error: scope.error });
        return;
      }
      // Only include in the patch if the resolved value differs from
      // current OR the caller explicitly attempted an update.
      if (hasDeptUpdate || scope.deptId !== (target.assignedDepartmentId ?? null)) {
        nextDeptId = scope.deptId;
      }
      if (
        hasFacultyUpdate ||
        scope.facultyId !== (target.assignedFacultyId ?? null)
      ) {
        nextFacultyId = scope.facultyId;
      }
    }

    const updated = await db.transaction(async (tx) => {
      if (isDemotingManager) {
        await tx
          .update(employersTable)
          .set({ accountManagerId: null })
          .where(eq(employersTable.accountManagerId, target.id));
        await tx
          .update(institutionsTable)
          .set({ accountManagerId: null })
          .where(eq(institutionsTable.accountManagerId, target.id));
      }
      const patch: {
        orgRole: string;
        assignedDepartmentId?: number | null;
        assignedFacultyId?: number | null;
      } = {
        orgRole,
      };
      if (nextDeptId !== undefined) patch.assignedDepartmentId = nextDeptId;
      if (nextFacultyId !== undefined) patch.assignedFacultyId = nextFacultyId;
      const [row] = await tx
        .update(usersTable)
        .set(patch)
        .where(eq(usersTable.id, target.id))
        .returning();
      return row;
    });
    const finalDeptId = updated.assignedDepartmentId;
    const finalFacultyId = updated.assignedFacultyId;
    const deptNames = await resolveDepartmentNames(
      finalDeptId != null ? [finalDeptId] : [],
    );
    const facultyNames = await resolveFacultyNames(
      finalFacultyId != null ? [finalFacultyId] : [],
    );
    res.json({
      member: toStaffRow(
        updated,
        finalDeptId != null ? deptNames.get(finalDeptId) ?? null : null,
        finalFacultyId != null ? facultyNames.get(finalFacultyId) ?? null : null,
      ),
    });
  } catch (err) {
    req.log.error({ err }, "staff role update failed");
    res.status(500).json({ error: "Update failed" });
  }
});

// Placeholder so the requireAuth import isn't unused if we add /staff/me later.
void requireAuth;

export default router;
