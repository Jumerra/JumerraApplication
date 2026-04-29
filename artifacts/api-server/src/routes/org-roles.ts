import { Router } from "express";
import {
  db,
  adminRolesTable,
  adminRolePermissionsTable,
  usersTable,
  type RoleScope,
} from "@workspace/db";
import { and, eq, desc, isNull, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth";
import {
  PERMISSIONS_BY_SCOPE,
  PERMISSION_KEYS_BY_SCOPE,
  scopeForUser,
  isImplicitAllUser,
} from "../lib/permissions";

const router: Router = Router();

router.use("/org-roles", requireAuth);

/**
 * Resolve the caller's permission scope and own-org id. Returns null
 * when the caller doesn't fit the scope system (e.g. candidates) or
 * is an org-scoped user without a linked org id.
 *
 * For employer/institution callers, every /org-roles read+write must
 * be filtered by the resolved org id so that orgs cannot see or
 * mutate each other's roles. Admins have no org id (global scope).
 */
type CallerCtx =
  | { scope: "admin" }
  | { scope: "employer"; employerId: number }
  | { scope: "institution"; institutionId: number };

function callerCtx(req: {
  currentUser: {
    role: string;
    orgRole: string | null;
    employerId: number | null;
    institutionId: number | null;
  } | null | undefined;
}): CallerCtx | null {
  const scope = scopeForUser(req.currentUser as never);
  if (!scope) return null;
  const me = req.currentUser!;
  if (scope === "admin") return { scope: "admin" };
  if (scope === "employer") {
    if (me.employerId === null) return null;
    return { scope: "employer", employerId: me.employerId };
  }
  if (me.institutionId === null) return null;
  return { scope: "institution", institutionId: me.institutionId };
}

function scopeFilters(ctx: CallerCtx) {
  if (ctx.scope === "admin") {
    return [
      eq(adminRolesTable.scope, "admin"),
      isNull(adminRolesTable.employerId),
      isNull(adminRolesTable.institutionId),
    ];
  }
  if (ctx.scope === "employer") {
    return [
      eq(adminRolesTable.scope, "employer"),
      eq(adminRolesTable.employerId, ctx.employerId),
    ];
  }
  return [
    eq(adminRolesTable.scope, "institution"),
    eq(adminRolesTable.institutionId, ctx.institutionId),
  ];
}

function requireOwnerForScope(
  req: {
    currentUser: { role: string; orgRole: string | null } | null | undefined;
  },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): boolean {
  if (!isImplicitAllUser(req.currentUser as never)) {
    res
      .status(403)
      .json({ error: "Only the org owner can manage roles" });
    return false;
  }
  return true;
}

const ROLE_NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

function validatePermissionList(
  scope: RoleScope,
  input: unknown,
): string[] | null {
  if (!Array.isArray(input)) return null;
  const valid = PERMISSION_KEYS_BY_SCOPE[scope];
  const out = new Set<string>();
  for (const k of input) {
    if (typeof k !== "string" || !valid.has(k)) return null;
    out.add(k);
  }
  return Array.from(out);
}

/**
 * GET /api/org-roles/permissions
 * Returns the permission catalog for the caller's scope.
 */
router.get("/org-roles/permissions", (req, res) => {
  const ctx = callerCtx(req);
  if (!ctx) {
    res.status(403).json({ error: "No role scope for this user" });
    return;
  }
  res.json({
    scope: ctx.scope,
    permissions: PERMISSIONS_BY_SCOPE[ctx.scope],
  });
});

/**
 * GET /api/org-roles
 * Lists every role in the caller's own org. Members count is also
 * scoped to the caller's org. This endpoint is readable by any org
 * member (the staff page populates its role dropdown from here);
 * writes below are owner-only.
 */
router.get("/org-roles", async (req, res) => {
  const ctx = callerCtx(req);
  if (!ctx) {
    res.status(403).json({ error: "No role scope for this user" });
    return;
  }
  const roles = await db
    .select()
    .from(adminRolesTable)
    .where(and(...scopeFilters(ctx)))
    .orderBy(desc(adminRolesTable.isSystem), adminRolesTable.name);
  const roleIds = roles.map((r) => r.id);
  const perms =
    roleIds.length > 0
      ? await db
          .select()
          .from(adminRolePermissionsTable)
          .where(inArray(adminRolePermissionsTable.roleId, roleIds))
      : [];
  // Member counts, filtered to the caller's own org.
  let counts: Array<{ orgRole: string | null; count: number | string | null }> = [];
  if (ctx.scope === "admin") {
    counts = await db
      .select({
        orgRole: usersTable.orgRole,
        count: sql<number>`count(*)::int`,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"))
      .groupBy(usersTable.orgRole);
  } else if (ctx.scope === "employer") {
    counts = await db
      .select({
        orgRole: usersTable.orgRole,
        count: sql<number>`count(*)::int`,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "employer"),
          eq(usersTable.employerId, ctx.employerId),
        ),
      )
      .groupBy(usersTable.orgRole);
  } else {
    counts = await db
      .select({
        orgRole: usersTable.orgRole,
        count: sql<number>`count(*)::int`,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "institution"),
          eq(usersTable.institutionId, ctx.institutionId),
        ),
      )
      .groupBy(usersTable.orgRole);
  }
  const countByName = new Map<string, number>();
  for (const c of counts) {
    if (c.orgRole) countByName.set(c.orgRole, Number(c.count ?? 0));
  }
  res.json({
    scope: ctx.scope,
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

/**
 * POST /api/org-roles
 * Body: { name, description?, permissions: string[] }
 * Owner-only. Creates a custom (non-system) role within caller's org.
 */
router.post("/org-roles", async (req, res) => {
  const ctx = callerCtx(req);
  if (!ctx) {
    res.status(403).json({ error: "No role scope for this user" });
    return;
  }
  if (!requireOwnerForScope(req, res)) return;
  const { name, description, permissions } = req.body ?? {};
  if (typeof name !== "string" || !ROLE_NAME_RE.test(name)) {
    res.status(400).json({
      error:
        "name must be lowercase letters, digits, or underscores (2-31 chars)",
    });
    return;
  }
  const perms = validatePermissionList(ctx.scope, permissions);
  if (perms === null) {
    res
      .status(400)
      .json({ error: "permissions must be an array of valid keys" });
    return;
  }
  // App-level uniqueness check inside the caller's org. The DB partial
  // indexes also cover this, but this gives a clean 409 message.
  const dup = await db
    .select({ id: adminRolesTable.id })
    .from(adminRolesTable)
    .where(and(...scopeFilters(ctx), eq(adminRolesTable.name, name)))
    .limit(1);
  if (dup.length > 0) {
    res.status(409).json({ error: "A role with that name already exists" });
    return;
  }
  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(adminRolesTable)
        .values({
          scope: ctx.scope,
          employerId: ctx.scope === "employer" ? ctx.employerId : null,
          institutionId:
            ctx.scope === "institution" ? ctx.institutionId : null,
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
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      res
        .status(409)
        .json({ error: "A role with that name already exists" });
      return;
    }
    throw err;
  }
});

/**
 * PATCH /api/org-roles/:id
 * Body: { description?, permissions? }
 * Owner-only. The role must belong to the caller's own org. The
 * implicit-all role (owner / super_admin) cannot be edited.
 */
router.patch("/org-roles/:id", async (req, res) => {
  const ctx = callerCtx(req);
  if (!ctx) {
    res.status(403).json({ error: "No role scope for this user" });
    return;
  }
  if (!requireOwnerForScope(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [role] = await db
    .select()
    .from(adminRolesTable)
    .where(and(eq(adminRolesTable.id, id), ...scopeFilters(ctx)))
    .limit(1);
  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  if (
    (ctx.scope === "admin" && role.name === "super_admin") ||
    ((ctx.scope === "employer" || ctx.scope === "institution") &&
      role.name === "owner")
  ) {
    res
      .status(400)
      .json({ error: "Owner role permissions cannot be edited" });
    return;
  }
  const { description, permissions } = req.body ?? {};
  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    res.status(400).json({ error: "description must be a string or null" });
    return;
  }
  let perms: string[] | null = null;
  if (permissions !== undefined) {
    perms = validatePermissionList(ctx.scope, permissions);
    if (perms === null) {
      res
        .status(400)
        .json({ error: "permissions must be an array of valid keys" });
      return;
    }
  }
  await db.transaction(async (tx) => {
    if (description !== undefined) {
      await tx
        .update(adminRolesTable)
        .set({ description: description ?? "", updatedAt: new Date() })
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
 * DELETE /api/org-roles/:id
 * Owner-only. The role must belong to the caller's own org. Refuses
 * if the role is a system role or if any user in the caller's org
 * currently holds it.
 */
router.delete("/org-roles/:id", async (req, res) => {
  const ctx = callerCtx(req);
  if (!ctx) {
    res.status(403).json({ error: "No role scope for this user" });
    return;
  }
  if (!requireOwnerForScope(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [role] = await db
    .select()
    .from(adminRolesTable)
    .where(and(eq(adminRolesTable.id, id), ...scopeFilters(ctx)))
    .limit(1);
  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  if (role.isSystem) {
    res.status(400).json({ error: "System roles cannot be deleted" });
    return;
  }
  let holders: Array<{ id: number }> = [];
  if (ctx.scope === "admin") {
    holders = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(eq(usersTable.role, "admin"), eq(usersTable.orgRole, role.name)),
      );
  } else if (ctx.scope === "employer") {
    holders = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "employer"),
          eq(usersTable.employerId, ctx.employerId),
          eq(usersTable.orgRole, role.name),
        ),
      );
  } else {
    holders = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "institution"),
          eq(usersTable.institutionId, ctx.institutionId),
          eq(usersTable.orgRole, role.name),
        ),
      );
  }
  if (holders.length > 0) {
    res.status(400).json({
      error: `Cannot delete: ${holders.length} user(s) still have this role`,
    });
    return;
  }
  await db.delete(adminRolesTable).where(eq(adminRolesTable.id, id));
  res.json({ ok: true });
});

export default router;
