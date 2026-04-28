import { Router } from "express";
import { db } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  usersTable,
  pendingRegistrationsTable,
  candidatesTable,
  employersTable,
  institutionsTable,
  candidateInstitutionsTable,
} from "@workspace/db";
import { requireAdmin } from "../middleware/require-auth";
import { createSetupToken, findUserByEmail } from "../lib/auth";

const router: Router = Router();

router.use(requireAdmin);

/**
 * GET /api/admin/registrations?status=pending|active|rejected|all
 * Returns sign-up applications with their submitted data.
 */
router.get("/admin/registrations", async (req, res) => {
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
router.post("/admin/registrations/:id/approve", async (req, res) => {
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
router.post("/admin/registrations/:id/reject", async (req, res) => {
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
router.post("/admin/onboard", async (req, res) => {
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
          approvedAt: new Date(),
          ...updates,
        })
        .returning();
      return created;
    });

    const { setupUrl, expiresAt, token } = await createSetupToken(user.id);

    // Logging the setupUrl is intentional MVP behaviour: there is no email
    // integration yet, and admins need a recovery channel for the link.
    // Replace with an email send + remove the URL from logs once mail is wired up.
    req.log.info(
      { userId: user.id, setupUrl },
      "admin onboarded user — password setup link generated",
    );

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      setupUrl,
      token,
      expiresAt: expiresAt.toISOString(),
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
router.get("/admin/onboarded", async (_req, res) => {
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

export default router;
