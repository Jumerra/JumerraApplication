/**
 * Alumni warm intros (Task #74).
 *
 * Surfaces alumni from the candidate's verified institution(s) who
 * already work at a job's employer, and lets the candidate ping them
 * for a one-tap endorsement.
 *
 * "Works at employer" = has a hired application against a job posted
 * by that employer. "Alumni" = candidate-role user with a verified
 * institution affiliation matching one of the requester's.
 *
 * Routes:
 *   GET  /jobs/:id/alumni-at-employer
 *   POST /jobs/:id/intro-requests
 *   GET  /me/intro-requests             (alumni inbox + my sent)
 *   POST /me/intro-requests/:id/respond
 *   PATCH /me/allow-intro-requests
 *
 * Throttles (enforced in POST /jobs/:id/intro-requests):
 *   - Max 3 alumni requests per (candidate, job).
 *   - Max 1 request per (candidate, alumni) per 30 days.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  alumniIntroRequestsTable,
  applicationsTable,
  candidateInstitutionsTable,
  candidatesTable,
  employersTable,
  institutionsTable,
  jobsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { sendNotification } from "../lib/notifier";

const router: IRouter = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_JOB = 3;

/**
 * Verified institution IDs for a candidate (only verified
 * affiliations count — unverified rows are self-asserted).
 */
async function verifiedInstitutionIdsForCandidate(
  candidateId: number,
): Promise<number[]> {
  const rows = await db
    .select({ institutionId: candidateInstitutionsTable.institutionId })
    .from(candidateInstitutionsTable)
    .where(
      and(
        eq(candidateInstitutionsTable.candidateId, candidateId),
        sql`${candidateInstitutionsTable.verifiedAt} IS NOT NULL`,
      ),
    );
  return rows.map((r) => r.institutionId);
}

/**
 * Resolve the set of (candidateId, userId, allowIntroRequests) for
 * candidates who:
 *   (a) are verified at any institution in `institutionIds`,
 *   (b) have at least one HIRED application against a job posted by
 *       `employerId`.
 * Returns one row per qualifying candidate; the userId may be null if
 * the candidate has no linked auth account.
 */
async function alumniAtEmployer(
  institutionIds: number[],
  employerId: number,
): Promise<
  Array<{
    candidateId: number;
    userId: number | null;
    fullName: string;
    avatarUrl: string;
    headline: string;
    institutionId: number;
    allowIntroRequests: boolean;
  }>
> {
  if (institutionIds.length === 0) return [];

  // 1) Candidates hired at any job from this employer.
  const hiredRows = await db
    .selectDistinct({ candidateId: applicationsTable.candidateId })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(
      and(
        eq(jobsTable.employerId, employerId),
        eq(applicationsTable.status, "hired"),
      ),
    );
  const hiredIds = hiredRows.map((r) => r.candidateId);
  if (hiredIds.length === 0) return [];

  // 2) Of those, the ones with a verified affiliation to one of our
  //    institutions. JOIN candidates -> candidate_institutions -> users.
  const rows = await db
    .select({
      candidateId: candidatesTable.id,
      userId: usersTable.id,
      fullName: candidatesTable.fullName,
      avatarUrl: candidatesTable.avatarUrl,
      headline: candidatesTable.headline,
      institutionId: candidateInstitutionsTable.institutionId,
      allowIntroRequests: candidatesTable.allowIntroRequests,
      userAllow: usersTable.id, // placeholder; we filter on candidates col
    })
    .from(candidatesTable)
    .innerJoin(
      candidateInstitutionsTable,
      eq(candidateInstitutionsTable.candidateId, candidatesTable.id),
    )
    .leftJoin(usersTable, eq(usersTable.candidateId, candidatesTable.id))
    .where(
      and(
        inArray(candidatesTable.id, hiredIds),
        inArray(candidateInstitutionsTable.institutionId, institutionIds),
        sql`${candidateInstitutionsTable.verifiedAt} IS NOT NULL`,
      ),
    );

  // Dedupe by candidateId (a candidate could be verified at multiple
  // institutions in the set — count them once, prefer the first hit).
  const seen = new Set<number>();
  const result: Array<{
    candidateId: number;
    userId: number | null;
    fullName: string;
    avatarUrl: string;
    headline: string;
    institutionId: number;
    allowIntroRequests: boolean;
  }> = [];
  for (const r of rows) {
    if (seen.has(r.candidateId)) continue;
    seen.add(r.candidateId);
    result.push({
      candidateId: r.candidateId,
      userId: r.userId,
      fullName: r.fullName,
      avatarUrl: r.avatarUrl,
      headline: r.headline,
      institutionId: r.institutionId,
      allowIntroRequests: r.allowIntroRequests,
    });
  }
  return result;
}

/**
 * GET /jobs/:id/alumni-at-employer
 *
 * Public-ish (requires auth so we know the candidate's institution
 * set). Non-candidate viewers get an empty result rather than 403 so
 * the UI can no-op gracefully.
 */
router.get(
  "/jobs/:id/alumni-at-employer",
  requireAuth,
  async (req, res): Promise<void> => {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "candidate" || !me.candidateId) {
      res.json({ count: 0, sample: [], institution: null });
      return;
    }

    const [job] = await db
      .select({
        id: jobsTable.id,
        employerId: jobsTable.employerId,
        employerName: employersTable.name,
      })
      .from(jobsTable)
      .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
      .where(eq(jobsTable.id, jobId));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const myInstitutionIds = await verifiedInstitutionIdsForCandidate(
      me.candidateId,
    );
    if (myInstitutionIds.length === 0) {
      res.json({ count: 0, sample: [], institution: null });
      return;
    }

    const alumni = await alumniAtEmployer(myInstitutionIds, job.employerId);

    // Don't surface self or alumni who have opted out.
    const eligible = alumni.filter(
      (a) =>
        a.candidateId !== me.candidateId &&
        a.allowIntroRequests &&
        a.userId != null,
    );

    // Pick a representative institution to label the panel — prefer
    // the one most alumni share.
    const instCounts = new Map<number, number>();
    for (const a of eligible) {
      instCounts.set(
        a.institutionId,
        (instCounts.get(a.institutionId) ?? 0) + 1,
      );
    }
    let topInstId: number | null = null;
    let topCount = 0;
    for (const [iid, c] of instCounts) {
      if (c > topCount) {
        topInstId = iid;
        topCount = c;
      }
    }
    let institutionLabel: { id: number; name: string } | null = null;
    if (topInstId != null) {
      const [inst] = await db
        .select({ id: institutionsTable.id, name: institutionsTable.name })
        .from(institutionsTable)
        .where(eq(institutionsTable.id, topInstId));
      if (inst) institutionLabel = { id: inst.id, name: inst.name };
    }

    // Pull existing requests so the UI can show "Requested" state.
    let existingByAlumni = new Map<number, string>();
    if (eligible.length > 0) {
      const alumniUserIds = eligible
        .map((a) => a.userId)
        .filter((x): x is number => x != null);
      if (alumniUserIds.length > 0) {
        const since = new Date(Date.now() - THIRTY_DAYS_MS);
        const existing = await db
          .select({
            alumniUserId: alumniIntroRequestsTable.alumniUserId,
            status: alumniIntroRequestsTable.status,
            createdAt: alumniIntroRequestsTable.createdAt,
          })
          .from(alumniIntroRequestsTable)
          .where(
            and(
              eq(alumniIntroRequestsTable.candidateId, me.candidateId),
              inArray(alumniIntroRequestsTable.alumniUserId, alumniUserIds),
              gt(alumniIntroRequestsTable.createdAt, since),
            ),
          );
        for (const e of existing) {
          existingByAlumni.set(e.alumniUserId, e.status);
        }
      }
    }

    res.json({
      institution: institutionLabel,
      employer: { id: job.employerId, name: job.employerName },
      count: eligible.length,
      // Cap surface area; the panel only needs a handful of avatars.
      sample: eligible.slice(0, 6).map((a) => ({
        alumniUserId: a.userId!,
        candidateId: a.candidateId,
        fullName: a.fullName,
        avatarUrl: a.avatarUrl,
        headline: a.headline,
        // null = no existing request; otherwise pending|accepted|declined
        requestStatus: existingByAlumni.get(a.userId!) ?? null,
      })),
    });
  },
);

const CreateIntroRequestBody = z.object({
  alumniUserId: z.number().int().positive(),
});

/**
 * POST /jobs/:id/intro-requests
 *
 * Candidate creates a warm-intro request to an alumni for this job.
 * Enforces both throttles before inserting.
 */
router.post(
  "/jobs/:id/intro-requests",
  requireAuth,
  async (req, res): Promise<void> => {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "candidate" || !me.candidateId) {
      res.status(403).json({ error: "Only candidates may request intros" });
      return;
    }
    const parsed = CreateIntroRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { alumniUserId } = parsed.data;

    const [job] = await db
      .select({
        id: jobsTable.id,
        title: jobsTable.title,
        employerId: jobsTable.employerId,
        employerName: employersTable.name,
      })
      .from(jobsTable)
      .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
      .where(eq(jobsTable.id, jobId));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    // Confirm alumni eligibility server-side. Client-supplied
    // alumniUserId must (a) be a real user, (b) opt-in, (c) verified
    // at one of the candidate's institutions, (d) hired at this
    // employer, (e) not the requester themselves.
    //
    // We intentionally collapse all of the (a)..(d) failure modes
    // into a single generic 403 so an attacker can't differentiate
    // "no such user" from "exists but not eligible" — that would
    // leak user-id existence / candidate-account linkage.
    const [alumniUser] = await db
      .select({
        id: usersTable.id,
        candidateId: usersTable.candidateId,
        fullName: usersTable.fullName,
      })
      .from(usersTable)
      .where(eq(usersTable.id, alumniUserId));
    if (alumniUser?.candidateId === me.candidateId) {
      res.status(400).json({ error: "Cannot request an intro from yourself" });
      return;
    }
    const myInstitutionIds = await verifiedInstitutionIdsForCandidate(
      me.candidateId,
    );
    const eligible = await alumniAtEmployer(myInstitutionIds, job.employerId);
    const eligibleMatch =
      alumniUser?.candidateId != null
        ? eligible.find((a) => a.candidateId === alumniUser.candidateId)
        : undefined;
    if (
      !alumniUser ||
      alumniUser.candidateId == null ||
      !eligibleMatch ||
      !eligibleMatch.allowIntroRequests
    ) {
      // Generic message — do not differentiate the failure reason.
      res.status(403).json({ error: "This alumni is not available for intros" });
      return;
    }

    // Throttle checks + insert in a single transaction. We lock prior
    // rows for this (candidate, job-or-alumni) pair with `FOR UPDATE`
    // so two concurrent requests can't both pass the 3/job or
    // 1/30-days check and double-insert.
    const myCandidateId: number = me.candidateId;
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    let created: typeof alumniIntroRequestsTable.$inferSelect | null = null;
    let throttleError: string | null = null;
    await db.transaction(async (tx) => {
      // Take transaction-scoped advisory locks keyed on the throttle
      // dimensions. This serializes concurrent first-time requests
      // (where there are no prior rows for `SELECT ... FOR UPDATE`
      // to lock) so two parallel inserts cannot both pass the cap
      // and the 30-day check. Locks release automatically on commit.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${myCandidateId}::bigint, ${jobId}::bigint)`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${myCandidateId}::bigint, ${alumniUserId}::bigint)`,
      );

      const perJobRows = await tx
        .select({ id: alumniIntroRequestsTable.id })
        .from(alumniIntroRequestsTable)
        .where(
          and(
            eq(alumniIntroRequestsTable.candidateId, myCandidateId),
            eq(alumniIntroRequestsTable.jobId, jobId),
          ),
        );
      if (perJobRows.length >= MAX_REQUESTS_PER_JOB) {
        throttleError = `Limit of ${MAX_REQUESTS_PER_JOB} intro requests per job reached.`;
        return;
      }

      const recentRows = await tx
        .select({ id: alumniIntroRequestsTable.id })
        .from(alumniIntroRequestsTable)
        .where(
          and(
            eq(alumniIntroRequestsTable.candidateId, myCandidateId),
            eq(alumniIntroRequestsTable.alumniUserId, alumniUserId),
            gt(alumniIntroRequestsTable.createdAt, since),
          ),
        )
        .limit(1);
      if (recentRows.length > 0) {
        throttleError =
          "You can only request an intro from this alumni once every 30 days.";
        return;
      }

      const [row] = await tx
        .insert(alumniIntroRequestsTable)
        .values({
          candidateId: myCandidateId,
          jobId,
          alumniUserId,
          status: "pending",
        })
        .returning();
      created = row;
    });
    if (throttleError) {
      res.status(429).json({ error: throttleError });
      return;
    }
    if (!created) {
      res.status(500).json({ error: "Failed to create intro request" });
      return;
    }
    // Help the type narrower — `created` is non-null past this point.
    const createdRow: typeof alumniIntroRequestsTable.$inferSelect = created;

    // Notify alumni via in-app + push. Email delivery currently
    // stubbed (Resend integration TODO platform-wide).
    await sendNotification({
      userId: alumniUserId,
      kind: "intro_request",
      title: `${me.fullName} would love a quick intro`,
      body: `They're applying for ${job.title} at ${job.employerName}.`,
      link: `/dashboard/candidate/intro-requests`,
      category: "introRequest",
      data: { introRequestId: createdRow.id, jobId, employerId: job.employerId },
    }).catch(() => {});

    res.status(201).json({
      id: createdRow.id,
      status: createdRow.status,
      jobId,
      alumniUserId,
      createdAt: createdRow.createdAt.toISOString(),
    });
  },
);

const RespondIntroBody = z.object({
  accept: z.boolean(),
  message: z.string().trim().max(280).optional(),
});

/**
 * POST /me/intro-requests/:id/respond
 * Alumni accept/decline. Optional one-liner becomes the endorsement
 * on the application card.
 */
router.post(
  "/me/intro-requests/:id/respond",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = RespondIntroBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const me = req.currentUser!;
    const [row] = await db
      .select()
      .from(alumniIntroRequestsTable)
      .where(eq(alumniIntroRequestsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Intro request not found" });
      return;
    }
    if (row.alumniUserId !== me.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (row.status !== "pending") {
      res.status(409).json({ error: "Already responded" });
      return;
    }

    const newStatus = parsed.data.accept ? "accepted" : "declined";
    const [updated] = await db
      .update(alumniIntroRequestsTable)
      .set({
        status: newStatus,
        response: parsed.data.message ?? null,
        respondedAt: new Date(),
      })
      .where(eq(alumniIntroRequestsTable.id, id))
      .returning();

    // Notify the requesting candidate that they have an answer.
    const [reqUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.candidateId, row.candidateId))
      .limit(1);
    const [job] = await db
      .select({ title: jobsTable.title })
      .from(jobsTable)
      .where(eq(jobsTable.id, row.jobId));
    if (reqUser) {
      await sendNotification({
        userId: reqUser.id,
        kind: "intro_response",
        title:
          newStatus === "accepted"
            ? `${me.fullName} accepted your intro request`
            : `${me.fullName} declined your intro request`,
        body: job ? `For ${job.title}` : "",
        link: `/jobs/${row.jobId}`,
        category: "introRequest",
        data: {
          introRequestId: id,
          jobId: row.jobId,
          status: newStatus,
        },
      }).catch(() => {});
    }

    res.json({
      id: updated.id,
      status: updated.status,
      response: updated.response,
      respondedAt: updated.respondedAt?.toISOString() ?? null,
    });
  },
);

/**
 * GET /me/intro-requests
 * Returns both inbox (received) and sent (outgoing for candidates).
 */
router.get(
  "/me/intro-requests",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;

    // Inbox: where I'm the alumni.
    const inboxRows = await db
      .select({
        request: alumniIntroRequestsTable,
        job: jobsTable,
        employer: employersTable,
        candidate: candidatesTable,
      })
      .from(alumniIntroRequestsTable)
      .innerJoin(jobsTable, eq(jobsTable.id, alumniIntroRequestsTable.jobId))
      .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, alumniIntroRequestsTable.candidateId),
      )
      .where(eq(alumniIntroRequestsTable.alumniUserId, me.id))
      .orderBy(desc(alumniIntroRequestsTable.createdAt));

    // Sent: where I'm the candidate (only meaningful for candidates).
    let sentRows: typeof inboxRows = [];
    if (me.role === "candidate" && me.candidateId) {
      sentRows = await db
        .select({
          request: alumniIntroRequestsTable,
          job: jobsTable,
          employer: employersTable,
          candidate: candidatesTable,
        })
        .from(alumniIntroRequestsTable)
        .innerJoin(jobsTable, eq(jobsTable.id, alumniIntroRequestsTable.jobId))
        .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
        .innerJoin(
          candidatesTable,
          eq(candidatesTable.id, alumniIntroRequestsTable.candidateId),
        )
        .where(eq(alumniIntroRequestsTable.candidateId, me.candidateId))
        .orderBy(desc(alumniIntroRequestsTable.createdAt));
    }

    const shape = (r: (typeof inboxRows)[number]) => ({
      id: r.request.id,
      status: r.request.status,
      response: r.request.response,
      jobId: r.job.id,
      jobTitle: r.job.title,
      employerId: r.employer.id,
      employerName: r.employer.name,
      employerLogoUrl: r.employer.logoUrl,
      candidateId: r.candidate.id,
      candidateName: r.candidate.fullName,
      candidateAvatarUrl: r.candidate.avatarUrl,
      candidateHeadline: r.candidate.headline,
      createdAt: r.request.createdAt.toISOString(),
      respondedAt: r.request.respondedAt?.toISOString() ?? null,
    });

    res.json({
      inbox: inboxRows.map(shape),
      sent: sentRows.map(shape),
    });
  },
);

const ToggleAllowBody = z.object({ allow: z.boolean() });

/**
 * PATCH /me/allow-intro-requests
 * Candidate-only global opt-out. Flips
 * candidates.allow_intro_requests.
 */
router.patch(
  "/me/allow-intro-requests",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    if (me.role !== "candidate" || !me.candidateId) {
      res.status(403).json({ error: "Only candidates have this setting" });
      return;
    }
    const parsed = ToggleAllowBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [updated] = await db
      .update(candidatesTable)
      .set({ allowIntroRequests: parsed.data.allow })
      .where(eq(candidatesTable.id, me.candidateId))
      .returning({
        allowIntroRequests: candidatesTable.allowIntroRequests,
      });
    res.json({ ok: true, allowIntroRequests: updated.allowIntroRequests });
  },
);

export default router;
