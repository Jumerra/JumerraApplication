import { Router } from "express";
import { db } from "@workspace/db";
import { eq, desc, sql, and, gte, lte, or, ilike } from "drizzle-orm";
import {
  usersTable,
  pendingRegistrationsTable,
  candidatesTable,
  employersTable,
  institutionsTable,
  candidateInstitutionsTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import { requireAdmin } from "../middleware/require-auth";
import { createSetupToken, findUserByEmail } from "../lib/auth";
import { sendAuthLinkEmail, originFromReq } from "../lib/email";

const router: Router = Router();

// Scope this middleware to /admin/* only — without the path prefix it
// would leak onto every other router mounted on /api after this one.
router.use("/admin", requireAdmin);

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

/**
 * DELETE /api/admin/candidates/:id
 * Removes a candidate, their applications, institution affiliations,
 * and unlinks the auth user. Wrapped in a transaction so the operation
 * is atomic.
 */
router.delete("/admin/candidates/:id", async (req, res) => {
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
router.delete("/admin/employers/:id", async (req, res) => {
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
router.patch("/admin/employers/:id/verify", async (req, res) => {
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
 * DELETE /api/admin/institutions/:id
 * Removes an institution, all candidate-institution affiliations
 * tied to it, and unlinks any users belonging to it.
 */
router.delete("/admin/institutions/:id", async (req, res) => {
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
router.get("/admin/applications", async (req, res) => {
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
router.delete("/admin/applications/:id", async (req, res) => {
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

router.get("/admin/hires/analytics", async (req, res) => {
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
router.get("/admin/hires/export.csv", async (req, res) => {
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

export default router;
