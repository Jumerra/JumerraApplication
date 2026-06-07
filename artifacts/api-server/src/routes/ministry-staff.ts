import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  usersTable,
  adminRolesTable,
  adminRolePermissionsTable,
} from "@workspace/db";
import { requireMinistry } from "../lib/ministry-scopes";
import { requirePermission } from "../lib/permissions";
import { findUserByEmail, hashPassword } from "../lib/auth";

const router: Router = Router();

/**
 * Ministry self-service staff management. A ministry owner (or anyone
 * granted `ministry-staff:manage`) can invite teammates, change their
 * role, reset their password, or remove them — all scoped to the
 * caller's own ministry. New staff are created with a default password
 * the owner types and `mustChangePassword = true`, mirroring how the
 * super-admin creates the ministry owner (no email/setup-link flow).
 *
 * `requireMinistry` attaches `req.ministry` (the caller's active
 * ministry) and `req.currentUser`. Every query is constrained to that
 * ministry id so one ministry can never touch another's staff.
 */

// Roles a ministry teammate can be assigned. "owner" is intentionally
// excluded: there is exactly one owner (the account the super-admin
// created), and ownership is not transferable from this UI.
const ASSIGNABLE_ROLES = new Set(["manager", "analyst"]);

/**
 * GET /api/ministry/roles
 * The assignable ministry roles (with descriptions + their permission
 * keys) so the invite/edit UI can render the role picker.
 */
router.get(
  "/ministry/roles",
  requireMinistry,
  requirePermission("ministry-staff:view"),
  async (req, res) => {
    const ministryId = req.ministry!.id;
    const roles = await db
      .select({
        id: adminRolesTable.id,
        name: adminRolesTable.name,
        description: adminRolesTable.description,
      })
      .from(adminRolesTable)
      .where(
        and(
          eq(adminRolesTable.scope, "ministry"),
          eq(adminRolesTable.ministryId, ministryId),
        ),
      );

    const perms = await db
      .select({
        roleId: adminRolePermissionsTable.roleId,
        permission: adminRolePermissionsTable.permission,
      })
      .from(adminRolePermissionsTable)
      .innerJoin(
        adminRolesTable,
        eq(adminRolesTable.id, adminRolePermissionsTable.roleId),
      )
      .where(
        and(
          eq(adminRolesTable.scope, "ministry"),
          eq(adminRolesTable.ministryId, ministryId),
        ),
      );

    const byRole = new Map<number, string[]>();
    for (const p of perms) {
      const list = byRole.get(p.roleId) ?? [];
      list.push(p.permission);
      byRole.set(p.roleId, list);
    }

    res.json({
      roles: roles
        .filter((r) => ASSIGNABLE_ROLES.has(r.name))
        .map((r) => ({
          name: r.name,
          description: r.description,
          permissions: byRole.get(r.id) ?? [],
        })),
    });
  },
);

/**
 * GET /api/ministry/staff
 * Lists every user account attached to the caller's ministry.
 */
router.get(
  "/ministry/staff",
  requireMinistry,
  requirePermission("ministry-staff:view"),
  async (req, res) => {
    const ministryId = req.ministry!.id;
    const staff = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        fullName: usersTable.fullName,
        status: usersTable.status,
        orgRole: usersTable.orgRole,
        mustChangePassword: usersTable.mustChangePassword,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "ministry"),
          eq(usersTable.ministryId, ministryId),
        ),
      )
      .orderBy(desc(usersTable.createdAt));

    res.json({ staff });
  },
);

/**
 * POST /api/ministry/staff
 * Invites a new teammate with a default password (typed by the owner)
 * and forces them to change it on first login.
 *
 * Body: { email, fullName, role, defaultPassword }
 */
router.post(
  "/ministry/staff",
  requireMinistry,
  requirePermission("ministry-staff:manage"),
  async (req, res) => {
    try {
      const ministryId = req.ministry!.id;
      const { email, fullName, role, defaultPassword } = req.body ?? {};
      if (
        typeof email !== "string" ||
        !email.trim() ||
        typeof fullName !== "string" ||
        !fullName.trim() ||
        typeof role !== "string" ||
        !ASSIGNABLE_ROLES.has(role)
      ) {
        res.status(400).json({ error: "Missing or invalid fields" });
        return;
      }
      if (typeof defaultPassword !== "string" || defaultPassword.length < 8) {
        res
          .status(400)
          .json({ error: "Default password must be at least 8 characters" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const existing = await findUserByEmail(normalizedEmail);
      if (existing) {
        res
          .status(409)
          .json({ error: "An account with that email already exists" });
        return;
      }

      // The role must actually exist for this ministry (seeded on
      // create); this also defends against a stale/forged role name.
      const roleRows = await db
        .select({ id: adminRolesTable.id })
        .from(adminRolesTable)
        .where(
          and(
            eq(adminRolesTable.scope, "ministry"),
            eq(adminRolesTable.ministryId, ministryId),
            eq(adminRolesTable.name, role),
          ),
        )
        .limit(1);
      if (roleRows.length === 0) {
        res.status(400).json({ error: "Unknown role for this ministry" });
        return;
      }

      const passwordHash = await hashPassword(defaultPassword);
      const [created] = await db
        .insert(usersTable)
        .values({
          email: normalizedEmail,
          passwordHash,
          role: "ministry",
          status: "active",
          orgRole: role,
          mustChangePassword: true,
          fullName: fullName.trim(),
          ministryId,
          approvedAt: new Date(),
        })
        .returning();

      res.status(201).json({
        staff: {
          id: created.id,
          email: created.email,
          fullName: created.fullName,
          status: created.status,
          orgRole: created.orgRole,
          mustChangePassword: created.mustChangePassword,
          createdAt: created.createdAt,
        },
      });
    } catch (err) {
      req.log.error({ err }, "ministry staff invite failed");
      res.status(500).json({ error: "Failed to invite teammate" });
    }
  },
);

/**
 * Loads a staff member that belongs to the caller's ministry and is not
 * the caller themselves and not the ministry owner. Returns the row or
 * sends the appropriate error response and returns null.
 */
async function loadManageableStaff(req: Request, res: Response) {
  const ministryId = req.ministry!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  if (id === req.currentUser!.id) {
    res.status(400).json({ error: "You cannot modify your own account here" });
    return null;
  }
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, id),
        eq(usersTable.role, "ministry"),
        eq(usersTable.ministryId, ministryId),
      ),
    )
    .limit(1);
  const target = rows[0];
  if (!target) {
    res.status(404).json({ error: "Teammate not found" });
    return null;
  }
  if (target.orgRole === "owner") {
    res.status(403).json({ error: "The ministry owner cannot be changed here" });
    return null;
  }
  return target;
}

/**
 * PATCH /api/ministry/staff/:id
 * Updates a teammate's role and/or status (active | disabled).
 *
 * Body: { role?, status? }
 */
router.patch(
  "/ministry/staff/:id",
  requireMinistry,
  requirePermission("ministry-staff:manage"),
  async (req, res) => {
    try {
      const ministryId = req.ministry!.id;
      const target = await loadManageableStaff(req, res);
      if (!target) return;

      const { role, status } = req.body ?? {};
      const updates: Partial<typeof usersTable.$inferInsert> = {};

      if (role !== undefined) {
        if (typeof role !== "string" || !ASSIGNABLE_ROLES.has(role)) {
          res.status(400).json({ error: "Invalid role" });
          return;
        }
        const roleRows = await db
          .select({ id: adminRolesTable.id })
          .from(adminRolesTable)
          .where(
            and(
              eq(adminRolesTable.scope, "ministry"),
              eq(adminRolesTable.ministryId, ministryId),
              eq(adminRolesTable.name, role),
            ),
          )
          .limit(1);
        if (roleRows.length === 0) {
          res.status(400).json({ error: "Unknown role for this ministry" });
          return;
        }
        updates.orgRole = role;
      }

      if (status !== undefined) {
        if (status !== "active" && status !== "disabled") {
          res.status(400).json({ error: "Invalid status" });
          return;
        }
        updates.status = status;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }

      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, target.id))
        .returning();

      res.json({
        staff: {
          id: updated.id,
          email: updated.email,
          fullName: updated.fullName,
          status: updated.status,
          orgRole: updated.orgRole,
          mustChangePassword: updated.mustChangePassword,
          createdAt: updated.createdAt,
        },
      });
    } catch (err) {
      req.log.error({ err }, "ministry staff update failed");
      res.status(500).json({ error: "Failed to update teammate" });
    }
  },
);

/**
 * POST /api/ministry/staff/:id/reset-password
 * Sets a new default password for a teammate and re-arms the forced
 * change, so they must pick a new password on next login.
 *
 * Body: { defaultPassword }
 */
router.post(
  "/ministry/staff/:id/reset-password",
  requireMinistry,
  requirePermission("ministry-staff:manage"),
  async (req, res) => {
    try {
      const target = await loadManageableStaff(req, res);
      if (!target) return;

      const { defaultPassword } = req.body ?? {};
      if (typeof defaultPassword !== "string" || defaultPassword.length < 8) {
        res
          .status(400)
          .json({ error: "Default password must be at least 8 characters" });
        return;
      }

      const passwordHash = await hashPassword(defaultPassword);
      await db
        .update(usersTable)
        .set({ passwordHash, mustChangePassword: true, status: "active" })
        .where(eq(usersTable.id, target.id));

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "ministry staff reset-password failed");
      res.status(500).json({ error: "Failed to reset password" });
    }
  },
);

/**
 * DELETE /api/ministry/staff/:id
 * Removes a teammate by disabling their account (status -> 'disabled'),
 * so they can no longer sign in. Soft, reversible via PATCH.
 */
router.delete(
  "/ministry/staff/:id",
  requireMinistry,
  requirePermission("ministry-staff:manage"),
  async (req, res) => {
    try {
      const target = await loadManageableStaff(req, res);
      if (!target) return;

      await db
        .update(usersTable)
        .set({ status: "disabled" })
        .where(eq(usersTable.id, target.id));

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "ministry staff delete failed");
      res.status(500).json({ error: "Failed to remove teammate" });
    }
  },
);

export default router;
