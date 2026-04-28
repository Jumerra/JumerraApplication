import { Router } from "express";
import { db } from "@workspace/db";
import { and, eq, isNotNull, ne, desc } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import {
  requireAuth,
  requireOrgMember,
  requireOrgOwner,
} from "../middleware/require-auth";
import { createSetupToken, findUserByEmail } from "../lib/auth";
import { sendAuthLinkEmail, originFromReq } from "../lib/email";

const router: Router = Router();

/**
 * Allowed orgRole values per top-level role. Used for invite validation
 * and role updates.
 */
const ROLE_OPTIONS: Record<string, ReadonlyArray<string>> = {
  admin: ["super_admin", "support"],
  employer: ["owner", "recruiter", "viewer"],
  institution: ["owner", "coordinator", "viewer"],
};

/**
 * Public summary of a staff member used by the team page.
 */
function toStaffRow(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    orgRole: u.orgRole,
    status: u.status,
    employerId: u.employerId,
    institutionId: u.institutionId,
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
  res.json({ members: rows.map(toStaffRow) });
});

/**
 * POST /api/staff/invite
 * Body: { email, fullName, orgRole }
 * Owner/super_admin invites a new teammate to their own org. Creates
 * an "invited" user with a one-time setup token and emails the link.
 */
router.post("/staff/invite", requireOrgOwner, async (req, res) => {
  try {
    const me = req.currentUser!;
    const { email, fullName, orgRole } = req.body ?? {};
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
    const allowed = ROLE_OPTIONS[me.role];
    if (!allowed?.includes(orgRole)) {
      res.status(400).json({
        error: `Invalid orgRole "${orgRole}" for ${me.role}`,
      });
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

    // SECURITY: only expose the setup URL to the inviter when email
    // delivery is NOT configured. Once a real provider is wired up the
    // link is delivered to the invitee directly and must not leak via
    // the API response. The raw `token` is never returned (the URL is
    // sufficient for the no-email fallback workflow).
    res.status(201).json({
      member: toStaffRow(created),
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
router.delete("/staff/:id", requireOrgOwner, async (req, res) => {
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

// Placeholder so the requireAuth import isn't unused if we add /staff/me later.
void requireAuth;

export default router;
