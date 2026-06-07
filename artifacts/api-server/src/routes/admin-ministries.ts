import { Router } from "express";
import { db } from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { ministriesTable, usersTable } from "@workspace/db";
import { requirePermission } from "../lib/permissions";
import { requireAdmin } from "../middleware/require-auth";
import { createSetupToken, findUserByEmail } from "../lib/auth";
import { sendAuthLinkEmail, originFromReq } from "../lib/email";
import {
  isMinistryType,
  defaultDataAccessFor,
  sanitizeDataAccess,
  MINISTRY_SCOPES,
  type MinistryType,
} from "../lib/ministry-scopes";

const router: Router = Router();

/**
 * Admin management of government ministry oversight accounts. Gated by
 * `ministries:manage` (super_admin implicit-all + the `operations`
 * system role). There is NO self-onboarding — ministries can only be
 * created here.
 */

/**
 * GET /api/admin/ministry-scopes
 * The full catalog of data-access scopes (per type) so the admin UI can
 * render the grant/revoke toggles.
 */
router.get(
  "/admin/ministry-scopes",
  requireAdmin,
  requirePermission("ministries:view"),
  (_req, res) => {
    res.json({ scopes: MINISTRY_SCOPES });
  },
);

/**
 * GET /api/admin/ministries
 * Lists all active ministries with their linked user accounts.
 */
router.get(
  "/admin/ministries",
  requireAdmin,
  requirePermission("ministries:view"),
  async (_req, res) => {
    const ministries = await db
      .select()
      .from(ministriesTable)
      .where(isNull(ministriesTable.deletedAt))
      .orderBy(desc(ministriesTable.createdAt));

    // Attach linked user accounts (one query, grouped in JS).
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        fullName: usersTable.fullName,
        status: usersTable.status,
        ministryId: usersTable.ministryId,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "ministry"));

    const byMinistry = new Map<number, typeof users>();
    for (const u of users) {
      if (u.ministryId == null) continue;
      const list = byMinistry.get(u.ministryId) ?? [];
      list.push(u);
      byMinistry.set(u.ministryId, list);
    }

    res.json({
      ministries: ministries.map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type,
        dataAccess: m.dataAccess,
        createdAt: m.createdAt,
        users: byMinistry.get(m.id) ?? [],
      })),
    });
  },
);

/**
 * POST /api/admin/ministries
 * Creates a ministry + an initial "invited" user account, returning a
 * one-time password-setup link (or sending it via email when Resend is
 * configured).
 *
 * Body: { name, type, email, fullName, dataAccess? }
 */
router.post(
  "/admin/ministries",
  requireAdmin,
  requirePermission("ministries:manage"),
  async (req, res) => {
    try {
      const { name, type, email, fullName, dataAccess } = req.body ?? {};
      if (
        typeof name !== "string" ||
        !name.trim() ||
        typeof email !== "string" ||
        !email.trim() ||
        typeof fullName !== "string" ||
        !fullName.trim() ||
        !isMinistryType(type)
      ) {
        res.status(400).json({ error: "Missing or invalid fields" });
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

      // Default to all scopes for the type; if the admin passed an
      // explicit list, sanitise it down to valid keys for this type.
      const access = Array.isArray(dataAccess)
        ? sanitizeDataAccess(type as MinistryType, dataAccess)
        : defaultDataAccessFor(type as MinistryType);

      const user = await db.transaction(async (tx) => {
        const [ministry] = await tx
          .insert(ministriesTable)
          .values({
            name: name.trim(),
            type,
            dataAccess: access,
            createdBy: req.currentUser?.id ?? null,
          })
          .returning();

        const [created] = await tx
          .insert(usersTable)
          .values({
            email: normalizedEmail,
            passwordHash: null,
            role: "ministry",
            status: "invited",
            fullName: fullName.trim(),
            ministryId: ministry.id,
            approvedAt: new Date(),
          })
          .returning();
        return created;
      });

      const { setupUrl, expiresAt } = await createSetupToken(user.id);
      const emailResult = await sendAuthLinkEmail({
        to: user.email,
        fullName: user.fullName,
        linkPath: setupUrl,
        kind: "setup",
        origin: originFromReq(req),
        logger: req.log,
      });

      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          ministryId: user.ministryId,
        },
        // Only leak the setup link when email delivery isn't configured.
        setupUrl: emailResult.sent ? null : setupUrl,
        expiresAt: expiresAt.toISOString(),
        emailSent: emailResult.sent,
      });
    } catch (err) {
      req.log.error({ err }, "ministry create failed");
      res.status(500).json({ error: "Failed to create ministry" });
    }
  },
);

/**
 * PATCH /api/admin/ministries/:id
 * Updates a ministry's name and/or data-access grants. dataAccess is
 * sanitised against the ministry's own type so foreign/unknown keys are
 * dropped.
 */
router.patch(
  "/admin/ministries/:id",
  requireAdmin,
  requirePermission("ministries:manage"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const rows = await db
        .select()
        .from(ministriesTable)
        .where(
          and(eq(ministriesTable.id, id), isNull(ministriesTable.deletedAt)),
        )
        .limit(1);
      const ministry = rows[0];
      if (!ministry) {
        res.status(404).json({ error: "Ministry not found" });
        return;
      }

      const { name, dataAccess } = req.body ?? {};
      const updates: Partial<typeof ministriesTable.$inferInsert> = {};
      if (typeof name === "string" && name.trim()) {
        updates.name = name.trim();
      }
      if (Array.isArray(dataAccess)) {
        updates.dataAccess = sanitizeDataAccess(
          ministry.type as MinistryType,
          dataAccess,
        );
      }
      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }

      const [updated] = await db
        .update(ministriesTable)
        .set(updates)
        .where(eq(ministriesTable.id, id))
        .returning();

      res.json({
        ministry: {
          id: updated.id,
          name: updated.name,
          type: updated.type,
          dataAccess: updated.dataAccess,
        },
      });
    } catch (err) {
      req.log.error({ err }, "ministry update failed");
      res.status(500).json({ error: "Failed to update ministry" });
    }
  },
);

/**
 * POST /api/admin/ministries/:id/reset-link
 * Issues a fresh password-setup link for the ministry's user account
 * (e.g. the original invite expired). Returns the link only when email
 * delivery is unconfigured.
 */
router.post(
  "/admin/ministries/:id/reset-link",
  requireAdmin,
  requirePermission("ministries:manage"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const userRows = await db
        .select()
        .from(usersTable)
        .where(
          and(eq(usersTable.ministryId, id), eq(usersTable.role, "ministry")),
        )
        .limit(1);
      const user = userRows[0];
      if (!user) {
        res.status(404).json({ error: "No user found for this ministry" });
        return;
      }

      const { setupUrl, expiresAt } = await createSetupToken(user.id);
      const emailResult = await sendAuthLinkEmail({
        to: user.email,
        fullName: user.fullName,
        linkPath: setupUrl,
        kind: "setup",
        origin: originFromReq(req),
        logger: req.log,
      });
      res.json({
        setupUrl: emailResult.sent ? null : setupUrl,
        expiresAt: expiresAt.toISOString(),
        emailSent: emailResult.sent,
      });
    } catch (err) {
      req.log.error({ err }, "ministry reset-link failed");
      res.status(500).json({ error: "Failed to issue setup link" });
    }
  },
);

/**
 * DELETE /api/admin/ministries/:id
 * Soft-deletes the ministry and disables its user accounts so they can
 * no longer sign in (status -> 'disabled').
 */
router.delete(
  "/admin/ministries/:id",
  requireAdmin,
  requirePermission("ministries:manage"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      await db.transaction(async (tx) => {
        await tx
          .update(ministriesTable)
          .set({ deletedAt: new Date() })
          .where(eq(ministriesTable.id, id));
        await tx
          .update(usersTable)
          .set({ status: "disabled" })
          .where(
            and(
              eq(usersTable.ministryId, id),
              eq(usersTable.role, "ministry"),
            ),
          );
      });
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "ministry delete failed");
      res.status(500).json({ error: "Failed to delete ministry" });
    }
  },
);

export default router;
