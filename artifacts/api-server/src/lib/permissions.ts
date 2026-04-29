import {
  db,
  adminRolesTable,
  adminRolePermissionsTable,
  type User,
} from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Catalog of every permission an admin sub-role can be granted. The
 * super-admin always has every permission implicitly. Permissions are
 * grouped for nicer rendering in the role-management UI.
 */
export type PermissionDef = {
  key: string;
  label: string;
  category: string;
  description: string;
};

export const PERMISSIONS: ReadonlyArray<PermissionDef> = [
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

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/**
 * System (built-in) roles seeded on first boot. The super_admin role
 * has implicit all-permissions and is special-cased everywhere; the
 * others get sensible defaults that the super-admin may edit later.
 */
export const SYSTEM_ROLES: ReadonlyArray<{
  name: string;
  description: string;
  permissions: ReadonlyArray<string>;
}> = [
  {
    name: "super_admin",
    description: "Unrestricted access to every part of the platform admin.",
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
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
    name: "finance",
    description: "Tracks revenue-relevant activity (hires, partner performance).",
    permissions: ["hires:view", "partner-analytics:view"],
  },
  {
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
];

/**
 * True for accounts that should bypass all permission checks. Mirrors
 * `isSuperAdmin` in routes/admin.ts: legacy admins with a null
 * `org_role` are treated as super-admin.
 */
export function isSuperAdminUser(user: User | null | undefined): boolean {
  if (!user || user.role !== "admin") return false;
  return user.orgRole === "super_admin" || user.orgRole === null;
}

/**
 * Returns the set of permission keys the given user effectively has.
 * Non-admins always get an empty set (these permissions are admin-only).
 * Super-admin gets the full catalog. Other admins get whatever rows
 * are in `admin_role_permissions` for the role whose name matches
 * their `org_role`.
 */
export async function getUserPermissions(
  user: User | null | undefined,
): Promise<Set<string>> {
  if (!user || user.role !== "admin") return new Set();
  if (isSuperAdminUser(user)) return new Set(PERMISSION_KEYS);
  if (!user.orgRole) return new Set();
  const rows = await db
    .select({ permission: adminRolePermissionsTable.permission })
    .from(adminRolePermissionsTable)
    .innerJoin(
      adminRolesTable,
      eq(adminRolesTable.id, adminRolePermissionsTable.roleId),
    )
    .where(eq(adminRolesTable.name, user.orgRole));
  return new Set(rows.map((r) => r.permission));
}

/**
 * Express middleware factory. Assumes an upstream `requireAdmin` (or
 * equivalent) has already populated `req.currentUser`. Only allows
 * admins whose role grants `permission`; super-admins bypass.
 */
import type { Request, Response, NextFunction } from "express";

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.currentUser;
    if (!user || user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    if (isSuperAdminUser(user)) {
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
 * Idempotent seed: ensures every system role exists with its default
 * permissions. Safe to call on every server boot. Does NOT touch
 * non-system roles or wipe permissions on existing system roles whose
 * permissions have been customized.
 */
export async function seedSystemRoles(): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    const existing = await db
      .select()
      .from(adminRolesTable)
      .where(eq(adminRolesTable.name, role.name))
      .limit(1);
    let roleId: number;
    if (existing.length === 0) {
      const [created] = await db
        .insert(adminRolesTable)
        .values({
          name: role.name,
          description: role.description,
          isSystem: true,
        })
        .returning();
      roleId = created.id;
      // Newly inserted system role: install the default permissions.
      await db.insert(adminRolePermissionsTable).values(
        role.permissions.map((permission) => ({
          roleId,
          permission,
        })),
      );
    } else {
      roleId = existing[0].id;
      // Make sure isSystem stays true for built-ins even if someone
      // hand-edited the table.
      if (!existing[0].isSystem) {
        await db
          .update(adminRolesTable)
          .set({ isSystem: true })
          .where(eq(adminRolesTable.id, roleId));
      }
    }
  }
}
