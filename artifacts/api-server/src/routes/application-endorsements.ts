import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  applicationEndorsementsTable,
  applicationStatusHistoryTable,
  applicationsTable,
  candidateInstitutionsTable,
  candidatesTable,
  db,
  employersTable,
  institutionDepartmentsTable,
  institutionsTable,
  jobsTable,
  usersTable,
} from "@workspace/db";
import { isOrgOwnerOrRegistrar, requireAuth } from "../middleware/require-auth";
import {
  getScopedStudentIds,
  resolveInstitutionScope,
} from "../lib/institution-scope";
import { sendNotification, sendNotificationToCandidate } from "../lib/notifier";

const router: IRouter = Router();

/**
 * GET /institutions/:id/pending-endorsements
 *
 * Applications submitted by students within the caller's institution
 * scope (owner/registrar = org-wide, dean = faculty, HoD = department)
 * that have NOT yet been endorsed. Filtered to early pipeline stages
 * (applied / screening / interview) — endorsing a hire is too late
 * to be useful to the employer.
 */
router.get(
  "/institutions/:id/pending-endorsements",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    if (!Number.isInteger(institutionId) || institutionId <= 0) {
      res.status(400).json({ error: "Invalid institution id" });
      return;
    }

    const scope = await resolveInstitutionScope(req.currentUser, institutionId);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }

    // Verified students only — institutions cannot endorse someone
    // they haven't already accepted as their student.
    const studentIds = await getScopedStudentIds(
      institutionId,
      scope.departmentIds,
    );
    if (studentIds.length === 0) {
      res.json([]);
      return;
    }

    const rows = await db
      .select({
        applicationId: applicationsTable.id,
        appliedAt: applicationsTable.appliedAt,
        matchScore: applicationsTable.matchScore,
        candidateId: candidatesTable.id,
        candidateName: candidatesTable.fullName,
        candidateAvatarUrl: candidatesTable.avatarUrl,
        candidateHeadline: candidatesTable.headline,
        jobId: jobsTable.id,
        jobTitle: jobsTable.title,
        employerId: employersTable.id,
        employerName: employersTable.name,
        employerLogoUrl: employersTable.logoUrl,
      })
      .from(applicationsTable)
      .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
      .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, applicationsTable.candidateId),
      )
      .leftJoin(
        applicationEndorsementsTable,
        eq(applicationEndorsementsTable.applicationId, applicationsTable.id),
      )
      .where(
        and(
          inArray(applicationsTable.candidateId, studentIds),
          inArray(applicationsTable.status, ["applied", "screening", "interview"]),
          isNull(applicationEndorsementsTable.id),
        ),
      )
      .orderBy(desc(applicationsTable.appliedAt));

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    // Pull each candidate's department-at-this-institution so the UI
    // can group / filter by faculty even for owner-scoped views.
    const candidateIds = Array.from(new Set(rows.map((r) => r.candidateId)));
    const links = await db
      .select({
        candidateId: candidateInstitutionsTable.candidateId,
        departmentId: candidateInstitutionsTable.departmentId,
        departmentName: institutionDepartmentsTable.name,
      })
      .from(candidateInstitutionsTable)
      .leftJoin(
        institutionDepartmentsTable,
        eq(
          institutionDepartmentsTable.id,
          candidateInstitutionsTable.departmentId,
        ),
      )
      .where(
        and(
          eq(candidateInstitutionsTable.institutionId, institutionId),
          inArray(candidateInstitutionsTable.candidateId, candidateIds),
        ),
      );
    const deptByCandidate = new Map<
      number,
      { id: number | null; name: string | null }
    >();
    for (const l of links) {
      deptByCandidate.set(l.candidateId, {
        id: l.departmentId,
        name: l.departmentName ?? null,
      });
    }

    res.json(
      rows.map((r) => {
        const dept = deptByCandidate.get(r.candidateId);
        return {
          applicationId: r.applicationId,
          candidateId: r.candidateId,
          candidateName: r.candidateName,
          candidateAvatarUrl: r.candidateAvatarUrl,
          candidateHeadline: r.candidateHeadline ?? "",
          departmentId: dept?.id ?? null,
          departmentName: dept?.name ?? null,
          jobId: r.jobId,
          jobTitle: r.jobTitle,
          employerId: r.employerId,
          employerName: r.employerName,
          employerLogoUrl: r.employerLogoUrl,
          matchScore: r.matchScore,
          appliedAt: r.appliedAt.toISOString(),
        };
      }),
    );
  },
);

/**
 * Resolve the application + the candidate's verified affiliation row
 * for the caller's institution. Returns either the joined data or a
 * suitable HTTP error envelope.
 */
async function loadApplicationForEndorsement(
  applicationId: number,
  institutionId: number,
): Promise<
  | {
      ok: true;
      candidateId: number;
      affiliationDepartmentId: number | null;
      affiliationFacultyId: number | null;
      candidateName: string;
      jobId: number;
      jobTitle: string;
      employerId: number;
      employerUserId: number | null;
      institutionName: string;
      status: string;
    }
  | { ok: false; status: number; error: string }
> {
  const [app] = await db
    .select({
      candidateId: applicationsTable.candidateId,
      candidateName: candidatesTable.fullName,
      jobId: jobsTable.id,
      jobTitle: jobsTable.title,
      employerId: employersTable.id,
      status: applicationsTable.status,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, applicationsTable.candidateId),
    )
    .where(eq(applicationsTable.id, applicationId))
    .limit(1);
  if (!app) {
    return { ok: false, status: 404, error: "Application not found" };
  }

  // Verified affiliation between the candidate and the caller's
  // institution. Without one, the candidate is not "ours" to endorse.
  const [link] = await db
    .select({
      departmentId: candidateInstitutionsTable.departmentId,
      verifiedAt: candidateInstitutionsTable.verifiedAt,
      facultyId: institutionDepartmentsTable.facultyId,
    })
    .from(candidateInstitutionsTable)
    .leftJoin(
      institutionDepartmentsTable,
      eq(
        institutionDepartmentsTable.id,
        candidateInstitutionsTable.departmentId,
      ),
    )
    .where(
      and(
        eq(candidateInstitutionsTable.institutionId, institutionId),
        eq(candidateInstitutionsTable.candidateId, app.candidateId),
      ),
    )
    .limit(1);
  if (!link || link.verifiedAt == null) {
    return {
      ok: false,
      status: 403,
      error: "This candidate is not a verified student of your institution",
    };
  }

  const [inst] = await db
    .select({ name: institutionsTable.name })
    .from(institutionsTable)
    .where(eq(institutionsTable.id, institutionId))
    .limit(1);

  // Best-effort owner-of-employer lookup so we can drop a notification
  // on the employer's bell. Multiple users may belong to the employer;
  // we notify the first one (typically the owner).
  const [employerUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.employerId, app.employerId))
    .limit(1);

  return {
    ok: true,
    candidateId: app.candidateId,
    candidateName: app.candidateName,
    affiliationDepartmentId: link.departmentId,
    affiliationFacultyId: link.facultyId,
    jobId: app.jobId,
    jobTitle: app.jobTitle,
    employerId: app.employerId,
    employerUserId: employerUser?.id ?? null,
    institutionName: inst?.name ?? "Your institution",
    status: app.status,
  };
}

// Endorsing an in-flight application is the product intent — once
// the employer has either hired or rejected (or the candidate
// withdrew), an endorsement can no longer change the outcome and
// would just clutter the historical record. Enforce server-side so
// direct API callers can't bypass the UI's pending-list filter.
const ENDORSABLE_STATUSES = new Set(["applied", "screening", "interview"]);

router.post(
  "/applications/:id/endorse",
  requireAuth,
  async (req, res): Promise<void> => {
    const applicationId = Number(req.params.id);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "institution" || me.institutionId == null) {
      res.status(403).json({ error: "Only institution staff may endorse" });
      return;
    }
    const institutionId = me.institutionId;

    // Permission gate: same as the pending-list reader. This rejects
    // institution accounts from a different org, accounts whose role
    // lacks `students:view`, and surfaces 401/403 in one place rather
    // than relying on the per-role scope branches below to do auth.
    const scope = await resolveInstitutionScope(me, institutionId);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }

    const loaded = await loadApplicationForEndorsement(
      applicationId,
      institutionId,
    );
    if (!loaded.ok) {
      res.status(loaded.status).json({ error: loaded.error });
      return;
    }

    if (!ENDORSABLE_STATUSES.has(loaded.status)) {
      res.status(409).json({
        error:
          "Only active applications (applied, screening, or interview) can be endorsed",
      });
      return;
    }

    // Scope check: dean must own the affiliation's faculty; HoD must
    // own its department. Owner/registrar (implicit-all) bypass.
    // Coordinator/viewer/etc fall through with no extra restriction
    // beyond resolveInstitutionScope's permission gate above. This
    // mirrors canActOnCandidateAffiliation in routes/institutions.ts.
    if (!isOrgOwnerOrRegistrar(me)) {
      if (me.orgRole === "dean") {
        if (
          me.assignedFacultyId == null ||
          loaded.affiliationFacultyId !== me.assignedFacultyId
        ) {
          res
            .status(403)
            .json({ error: "This student is outside your assigned faculty" });
          return;
        }
      } else if (me.orgRole === "hod") {
        if (
          me.assignedDepartmentId == null ||
          loaded.affiliationDepartmentId !== me.assignedDepartmentId
        ) {
          res
            .status(403)
            .json({ error: "This student is outside your assigned department" });
          return;
        }
      } else if (
        me.assignedDepartmentId != null &&
        loaded.affiliationDepartmentId !== me.assignedDepartmentId
      ) {
        res
          .status(403)
          .json({ error: "This student is outside your assigned department" });
        return;
      } else if (
        me.assignedFacultyId != null &&
        loaded.affiliationFacultyId !== me.assignedFacultyId
      ) {
        res
          .status(403)
          .json({ error: "This student is outside your assigned faculty" });
        return;
      }
    }

    const noteRaw = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (noteRaw.length > 280) {
      res.status(400).json({ error: "Note must be 280 characters or fewer" });
      return;
    }
    const note = noteRaw.length > 0 ? noteRaw : null;

    let created;
    try {
      [created] = await db
        .insert(applicationEndorsementsTable)
        .values({
          applicationId,
          institutionId,
          endorsedByUserId: me.id,
          note,
        })
        .returning();
    } catch (err) {
      // Unique-violation on (applicationId) → already endorsed.
      if ((err as { code?: string })?.code === "23505") {
        res.status(409).json({ error: "Application is already endorsed" });
        return;
      }
      throw err;
    }

    // Append a status-history breadcrumb so the candidate timeline
    // surfaces the endorsement event alongside status changes. Uses
    // a synthetic status string consumers can render; doesn't change
    // the application's actual `status` column.
    try {
      await db.insert(applicationStatusHistoryTable).values({
        applicationId,
        status: "endorsed",
        changedBy: me.id,
      });
    } catch (err) {
      req.log.warn({ err }, "endorse: failed to append history row");
    }

    // Notify the candidate. Best-effort, mirrors applications.ts.
    try {
      await sendNotificationToCandidate(loaded.candidateId, {
        kind: "application_endorsed",
        title: `${loaded.institutionName} endorsed your application`,
        body: `Your ${loaded.jobTitle} application now carries a "Verified by ${loaded.institutionName}" badge.`,
        link: `/account/applications/${applicationId}`,
        category: "applicationStatus",
        data: { applicationId, institutionId },
      });
    } catch (err) {
      req.log.warn({ err }, "endorse: candidate notify failed");
    }

    // Notify the employer (best-effort).
    if (loaded.employerUserId != null) {
      try {
        await sendNotification({
          userId: loaded.employerUserId,
          kind: "application_endorsed",
          title: `${loaded.institutionName} endorsed an applicant`,
          body: `${loaded.candidateName} for ${loaded.jobTitle} is now verified by their institution.`,
          link: `/dashboard/employer/pipeline`,
          category: "applicationStatus",
          data: { applicationId, institutionId },
        });
      } catch (err) {
        req.log.warn({ err }, "endorse: employer notify failed");
      }
    }

    res.status(201).json({
      institutionId,
      institutionName: loaded.institutionName,
      note: created!.note,
      endorsedAt: created!.createdAt.toISOString(),
    });
  },
);

router.delete(
  "/applications/:id/endorse",
  requireAuth,
  async (req, res): Promise<void> => {
    const applicationId = Number(req.params.id);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "institution" || me.institutionId == null) {
      res.status(403).json({ error: "Only institution staff may unendorse" });
      return;
    }

    const [existing] = await db
      .select()
      .from(applicationEndorsementsTable)
      .where(eq(applicationEndorsementsTable.applicationId, applicationId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Endorsement not found" });
      return;
    }
    if (existing.institutionId !== me.institutionId) {
      res.status(403).json({ error: "Not your institution's endorsement" });
      return;
    }
    // Allow removal by an owner/registrar OR the original endorser.
    const isOriginalEndorser =
      existing.endorsedByUserId != null && existing.endorsedByUserId === me.id;
    if (!isOrgOwnerOrRegistrar(me) && !isOriginalEndorser) {
      res
        .status(403)
        .json({ error: "Only the original endorser or an owner/registrar may remove this" });
      return;
    }

    await db
      .delete(applicationEndorsementsTable)
      .where(eq(applicationEndorsementsTable.id, existing.id));

    res.status(204).end();
  },
);

export default router;
