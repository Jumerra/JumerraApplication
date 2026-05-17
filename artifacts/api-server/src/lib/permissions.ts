import {
  db,
  adminRolesTable,
  adminRolePermissionsTable,
  employersTable,
  institutionsTable,
  type User,
  type RoleScope,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Catalog of every permission a sub-role can be granted. Implicit-all
 * roles (admin:super_admin, employer:owner, institution:owner) bypass
 * every check. Permissions are grouped for nicer rendering in the
 * role-management UI.
 */
export type PermissionDef = {
  key: string;
  label: string;
  category: string;
  description: string;
};

// =============================================================
// ADMIN scope
// =============================================================
export const ADMIN_PERMISSIONS: ReadonlyArray<PermissionDef> = [
  {
    key: "registrations:view",
    label: "Review registrations",
    category: "Onboarding",
    description: "Approve or reject employer/institution sign-ups.",
  },
  {
    key: "onboard:create",
    label: "Onboard new orgs",
    category: "Onboarding",
    description: "Create employer/institution accounts directly.",
  },
  {
    key: "candidates:view",
    label: "View candidates",
    category: "People",
    description: "Browse the platform candidate directory.",
  },
  {
    key: "candidates:manage",
    label: "Manage candidate accounts",
    category: "People",
    description: "Disable, re-enable, or reset candidate passwords.",
  },
  {
    key: "employers:view",
    label: "View employers",
    category: "Accounts",
    description: "See the employer directory.",
  },
  {
    key: "employers:manage",
    label: "Manage employer accounts",
    category: "Accounts",
    description: "Disable / reset employer accounts and reassign managers.",
  },
  {
    key: "institutions:view",
    label: "View institutions",
    category: "Accounts",
    description: "See the institution directory.",
  },
  {
    key: "institutions:manage",
    label: "Manage institution accounts",
    category: "Accounts",
    description: "Disable / reset institution accounts and reassign managers.",
  },
  {
    key: "applications:view",
    label: "View applications",
    category: "Pipeline",
    description: "Read-only oversight of all job applications.",
  },
  {
    key: "hires:view",
    label: "View hires",
    category: "Pipeline",
    description: "See completed hire activity.",
  },
  {
    key: "partner-analytics:view",
    label: "View partner analytics",
    category: "Insights",
    description: "Per-employer / per-institution performance dashboards.",
  },
  {
    key: "account-managers:view",
    label: "View account managers",
    category: "Insights",
    description: "Roster of account managers and their books.",
  },
  {
    key: "site-content:edit",
    label: "Edit site content",
    category: "Marketing",
    description: "Update home-page copy and images.",
  },
  {
    key: "payments:view",
    label: "View platform revenue",
    category: "Insights",
    description:
      "See total revenue across candidate, institution, and employer services with time-series charts.",
  },
  {
    key: "staff:view",
    label: "View team",
    category: "Admin team",
    description: "See other admin team members.",
  },
  {
    key: "staff:manage",
    label: "Manage team",
    category: "Admin team",
    description: "Invite, remove, and change admin teammates' roles.",
  },
];

// Backwards compat: many call-sites still import PERMISSIONS.
export const PERMISSIONS = ADMIN_PERMISSIONS;
export const PERMISSION_KEYS = new Set(ADMIN_PERMISSIONS.map((p) => p.key));

// =============================================================
// EMPLOYER scope
// =============================================================
export const EMPLOYER_PERMISSIONS: ReadonlyArray<PermissionDef> = [
  {
    key: "jobs:view",
    label: "View jobs",
    category: "Jobs",
    description: "See job postings owned by this employer.",
  },
  {
    key: "jobs:manage",
    label: "Manage jobs",
    category: "Jobs",
    description: "Create, edit, publish, close, and delete job postings.",
  },
  {
    key: "applications:view",
    label: "View applications",
    category: "Pipeline",
    description: "See incoming applications and candidate matches.",
  },
  {
    key: "applications:respond",
    label: "Respond to applications",
    category: "Pipeline",
    description: "Move applicants forward, reject, schedule interviews, hire.",
  },
  {
    key: "candidates:view",
    label: "Search candidates",
    category: "People",
    description: "Browse the platform candidate directory.",
  },
  {
    key: "org-profile:edit",
    label: "Edit company profile",
    category: "Org",
    description: "Update company details, logo, and description.",
  },
  {
    key: "analytics:view",
    label: "View analytics",
    category: "Insights",
    description: "Hiring funnel and pipeline analytics for this employer.",
  },
  {
    key: "staff:view",
    label: "View team",
    category: "Team",
    description: "See other team members.",
  },
  {
    key: "staff:manage",
    label: "Manage team",
    category: "Team",
    description: "Invite, remove, and change teammates' roles.",
  },
];

// =============================================================
// INSTITUTION scope
// =============================================================
export const INSTITUTION_PERMISSIONS: ReadonlyArray<PermissionDef> = [
  {
    key: "students:view",
    label: "View students",
    category: "Students",
    description: "Browse affiliated students and their placement status.",
  },
  {
    key: "students:invite",
    label: "Invite students",
    category: "Students",
    description: "Send invites to add students to this institution.",
  },
  {
    key: "students:verify",
    label: "Verify attendance",
    category: "Students",
    description: "Confirm or revoke a candidate's affiliation with this institution.",
  },
  {
    key: "placements:view",
    label: "View placements",
    category: "Insights",
    description: "Read-only access to placement and hire reports.",
  },
  {
    key: "analytics:view",
    label: "View analytics",
    category: "Insights",
    description: "Outcomes dashboards and partner analytics.",
  },
  {
    key: "org-profile:edit",
    label: "Edit institution profile",
    category: "Org",
    description: "Update institution details, logo, and description.",
  },
  {
    key: "staff:view",
    label: "View team",
    category: "Team",
    description: "See other team members.",
  },
  {
    key: "staff:manage",
    label: "Manage team",
    category: "Team",
    description: "Invite, remove, and change teammates' roles.",
  },
];

export const PERMISSIONS_BY_SCOPE: Record<RoleScope, ReadonlyArray<PermissionDef>> = {
  admin: ADMIN_PERMISSIONS,
  employer: EMPLOYER_PERMISSIONS,
  institution: INSTITUTION_PERMISSIONS,
};

export const PERMISSION_KEYS_BY_SCOPE: Record<RoleScope, Set<string>> = {
  admin: new Set(ADMIN_PERMISSIONS.map((p) => p.key)),
  employer: new Set(EMPLOYER_PERMISSIONS.map((p) => p.key)),
  institution: new Set(INSTITUTION_PERMISSIONS.map((p) => p.key)),
};

/**
 * System (built-in) roles seeded on first boot. Implicit-all roles:
 *   admin:super_admin, employer:owner, institution:owner.
 * The other system roles get sensible defaults that the org owner may
 * later edit.
 */
type SystemRoleSpec = {
  scope: RoleScope;
  name: string;
  description: string;
  permissions: ReadonlyArray<string>;
};

export const SYSTEM_ROLES: ReadonlyArray<SystemRoleSpec> = [
  // ---- ADMIN ----
  {
    scope: "admin",
    name: "super_admin",
    description: "Unrestricted access to every part of the platform admin.",
    permissions: ADMIN_PERMISSIONS.map((p) => p.key),
  },
  {
    scope: "admin",
    name: "support",
    description: "Read-only access to help diagnose issues for users.",
    permissions: [
      "registrations:view",
      "candidates:view",
      "employers:view",
      "institutions:view",
      "applications:view",
      "hires:view",
      "partner-analytics:view",
      "account-managers:view",
    ],
  },
  {
    scope: "admin",
    name: "account_manager",
    description: "Owns a book of employer/institution accounts and onboards new ones.",
    permissions: [
      "employers:view",
      "institutions:view",
      "onboard:create",
      "account-managers:view",
      "candidates:view",
    ],
  },
  {
    scope: "admin",
    name: "finance",
    description:
      "Tracks revenue-relevant activity (platform revenue, hires, partner performance).",
    permissions: ["payments:view", "hires:view", "partner-analytics:view"],
  },
  {
    scope: "admin",
    name: "hr",
    description: "Manages the admin team and candidate-facing operations.",
    permissions: [
      "staff:view",
      "staff:manage",
      "candidates:view",
      "candidates:manage",
    ],
  },
  {
    scope: "admin",
    name: "operations",
    description: "Runs day-to-day onboarding and account ops.",
    permissions: [
      "registrations:view",
      "onboard:create",
      "employers:view",
      "employers:manage",
      "institutions:view",
      "institutions:manage",
    ],
  },

  // ---- EMPLOYER ----
  {
    scope: "employer",
    name: "owner",
    description: "Full control of the employer account — every permission.",
    permissions: EMPLOYER_PERMISSIONS.map((p) => p.key),
  },
  {
    scope: "employer",
    name: "recruiter",
    description: "Day-to-day hiring: post jobs, respond to applications.",
    permissions: [
      "jobs:view",
      "jobs:manage",
      "applications:view",
      "applications:respond",
      "candidates:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    scope: "employer",
    name: "viewer",
    description: "Read-only access to jobs, applications, and analytics.",
    permissions: [
      "jobs:view",
      "applications:view",
      "candidates:view",
      "analytics:view",
      "staff:view",
    ],
  },

  // ---- INSTITUTION ----
  {
    scope: "institution",
    name: "owner",
    description: "Full control of the institution account — every permission.",
    permissions: INSTITUTION_PERMISSIONS.map((p) => p.key),
  },
  {
    scope: "institution",
    name: "registrar",
    description:
      "Owner-equivalent for academic operations: manages faculties, departments, and staff.",
    permissions: INSTITUTION_PERMISSIONS.map((p) => p.key),
  },
  {
    scope: "institution",
    name: "dean",
    description:
      "Manages and verifies students within their assigned faculty.",
    permissions: [
      "students:view",
      "students:invite",
      "students:verify",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    scope: "institution",
    name: "hod",
    description:
      "Head of Department — manages and verifies students in their department.",
    permissions: [
      "students:view",
      "students:invite",
      "students:verify",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    scope: "institution",
    name: "coordinator",
    description: "Manages students, verifies attendance, sees outcomes.",
    permissions: [
      "students:view",
      "students:invite",
      "students:verify",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
  {
    scope: "institution",
    name: "viewer",
    description: "Read-only access to students, placements, and analytics.",
    permissions: [
      "students:view",
      "placements:view",
      "analytics:view",
      "staff:view",
    ],
  },
];

/**
 * Maps a top-level user role to its permission scope. Returns null
 * for roles that don't have a permission system (e.g. candidates).
 */
export function scopeForUser(user: User | null | undefined): RoleScope | null {
  if (!user) return null;
  if (user.role === "admin") return "admin";
  if (user.role === "employer") return "employer";
  if (user.role === "institution") return "institution";
  return null;
}

/**
 * True for accounts that should bypass all permission checks within
 * their scope. admin:super_admin (or null orgRole legacy admins),
 * employer:owner, institution:owner are all implicit-all.
 */
export function isImplicitAllUser(
  user: User | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "admin") {
    return user.orgRole === "super_admin" || user.orgRole === null;
  }
  if (user.role === "employer") {
    return user.orgRole === "owner";
  }
  if (user.role === "institution") {
    // Registrars are explicitly owner-equivalent for academic ops.
    return user.orgRole === "owner" || user.orgRole === "registrar";
  }
  return false;
}

// Backwards compat: existing call-sites import isSuperAdminUser.
export function isSuperAdminUser(
  user: User | null | undefined,
): boolean {
  if (!user || user.role !== "admin") return false;
  return user.orgRole === "super_admin" || user.orgRole === null;
}

/**
 * Returns the set of permission keys the given user effectively has,
 * within their own scope. Candidates and roles outside the scope
 * system always get an empty set. Implicit-all users get the full
 * catalog for their scope.
 *
 * For employer/institution scopes, the lookup is constrained to the
 * caller's own org id, so two employers may have a same-named "viewer"
 * role with completely different permission sets.
 */
export async function getUserPermissions(
  user: User | null | undefined,
): Promise<Set<string>> {
  const scope = scopeForUser(user);
  if (!user || !scope) return new Set();
  if (isImplicitAllUser(user)) {
    return new Set(PERMISSION_KEYS_BY_SCOPE[scope]);
  }
  if (!user.orgRole) return new Set();
  const filters = [
    eq(adminRolesTable.scope, scope),
    eq(adminRolesTable.name, user.orgRole),
  ];
  if (scope === "employer") {
    if (user.employerId === null) return new Set();
    filters.push(eq(adminRolesTable.employerId, user.employerId));
  } else if (scope === "institution") {
    if (user.institutionId === null) return new Set();
    filters.push(eq(adminRolesTable.institutionId, user.institutionId));
  }
  const rows = await db
    .select({ permission: adminRolePermissionsTable.permission })
    .from(adminRolePermissionsTable)
    .innerJoin(
      adminRolesTable,
      eq(adminRolesTable.id, adminRolePermissionsTable.roleId),
    )
    .where(and(...filters));
  return new Set(rows.map((r) => r.permission));
}

/**
 * Express middleware factory. Allows a user with `permission` (within
 * their own scope) through. Implicit-all users bypass. Anyone else
 * (including signed-out users and candidates) gets 403.
 */
import type { Request, Response, NextFunction } from "express";

export function requirePermission(permission: string) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const user = req.currentUser;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (isImplicitAllUser(user)) {
      next();
      return;
    }
    const perms = await getUserPermissions(user);
    if (!perms.has(permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}

/**
 * Insert any missing system roles for one specific org. Used at boot
 * (per-org backfill) and right after a new employer/institution is
 * provisioned. Idempotent and safe to call repeatedly.
 *
 * `target` describes which org (if any) we're seeding for. Admin
 * scope has no per-org rows: pass `{ scope: "admin" }`.
 */
export async function seedSystemRolesFor(
  target:
    | { scope: "admin" }
    | { scope: "employer"; employerId: number }
    | { scope: "institution"; institutionId: number },
  executor: Pick<typeof db, "select" | "insert" | "update"> = db,
): Promise<void> {
  const systemRoles = SYSTEM_ROLES.filter((r) => r.scope === target.scope);
  for (const role of systemRoles) {
    const filters = [
      eq(adminRolesTable.scope, role.scope),
      eq(adminRolesTable.name, role.name),
    ];
    if (target.scope === "employer") {
      filters.push(eq(adminRolesTable.employerId, target.employerId));
    } else if (target.scope === "institution") {
      filters.push(eq(adminRolesTable.institutionId, target.institutionId));
    }
    const existing = await executor
      .select()
      .from(adminRolesTable)
      .where(and(...filters))
      .limit(1);
    if (existing.length === 0) {
      const [created] = await executor
        .insert(adminRolesTable)
        .values({
          scope: role.scope,
          employerId: target.scope === "employer" ? target.employerId : null,
          institutionId:
            target.scope === "institution" ? target.institutionId : null,
          name: role.name,
          description: role.description,
          isSystem: true,
        })
        .returning();
      if (role.permissions.length > 0) {
        await executor.insert(adminRolePermissionsTable).values(
          role.permissions.map((permission) => ({
            roleId: created.id,
            permission,
          })),
        );
      }
    } else if (!existing[0].isSystem) {
      await executor
        .update(adminRolesTable)
        .set({ isSystem: true })
        .where(eq(adminRolesTable.id, existing[0].id));
    }
  }
}

/**
 * Boot-time seed: ensures every existing org has its scope's system
 * roles, and cleans up any legacy rows from a previous schema where
 * employer/institution roles had no org id. Safe to call on every
 * server boot.
 */
export async function seedSystemRoles(): Promise<void> {
  // Admin scope: no org id, single set of rows.
  await seedSystemRolesFor({ scope: "admin" });

  // Backfill per-org system roles for every existing employer/institution.
  const employers = await db
    .select({ id: employersTable.id })
    .from(employersTable);
  for (const emp of employers) {
    await seedSystemRolesFor({ scope: "employer", employerId: emp.id });
  }
  const institutions = await db
    .select({ id: institutionsTable.id })
    .from(institutionsTable);
  for (const inst of institutions) {
    await seedSystemRolesFor({
      scope: "institution",
      institutionId: inst.id,
    });
  }

  // Drop legacy global rows that were written before the org_id columns
  // existed: any scope='employer'|'institution' row with no org id is
  // unreachable (and a tenant-isolation hazard) under the new model.
  await db
    .delete(adminRolesTable)
    .where(
      and(
        eq(adminRolesTable.scope, "employer"),
        isNull(adminRolesTable.employerId),
      ),
    );
  await db
    .delete(adminRolesTable)
    .where(
      and(
        eq(adminRolesTable.scope, "institution"),
        isNull(adminRolesTable.institutionId),
      ),
    );
}
