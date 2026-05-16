import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, sql, asc } from "drizzle-orm";
import {
  db,
  candidatesTable,
  candidateInstitutionsTable,
  institutionsTable,
  employersTable,
  applicationsTable,
  jobsTable,
  usersTable,
  mentorshipRequestsTable,
  employerReviewsTable,
  placementStoriesTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth";
import { sendNotification } from "../lib/notifier";

const router: IRouter = Router();

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns the set of institution ids that the candidate is verified at.
 * Mentorship and reviews are scoped to verified affiliations only.
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
        isNotNull(candidateInstitutionsTable.verifiedAt),
      ),
    );
  return rows.map((r) => r.institutionId);
}

/**
 * Returns true if the candidate has been hired at the given employer.
 * Source of truth: applications.status='hired'.
 */
async function candidateWasHiredAtEmployer(
  candidateId: number,
  employerId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(
      and(
        eq(applicationsTable.candidateId, candidateId),
        eq(jobsTable.employerId, employerId),
        eq(applicationsTable.status, "hired"),
      ),
    )
    .limit(1);
  return !!row;
}

async function findUserIdForCandidate(
  candidateId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.candidateId, candidateId))
    .limit(1);
  return row?.id ?? null;
}

// ===========================================================================
// Mentorship
// ===========================================================================

const PatchOptinBody = z.object({ optin: z.boolean() });

/**
 * PATCH /candidates/:id/mentor-optin
 * Owner or admin can flip the candidate into the alumni mentor directory.
 */
router.patch(
  "/candidates/:id/mentor-optin",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "admin" && me.candidateId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = PatchOptinBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [updated] = await db
      .update(candidatesTable)
      .set({ alumniMentorOptin: parsed.data.optin })
      .where(eq(candidatesTable.id, id))
      .returning({
        id: candidatesTable.id,
        alumniMentorOptin: candidatesTable.alumniMentorOptin,
      });
    if (!updated) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({ ok: true, alumniMentorOptin: updated.alumniMentorOptin });
  },
);

/**
 * GET /candidates/:id/mentors
 * Lists alumni mentors at any institution the candidate is verified at.
 * Mentor must (a) be opted in, (b) share at least one verified institution
 * with the requester, (c) not be the requester themselves.
 */
router.get(
  "/candidates/:id/mentors",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "admin" && me.candidateId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const institutionIds = await verifiedInstitutionIdsForCandidate(id);
    if (institutionIds.length === 0) {
      res.json({ mentors: [] });
      return;
    }

    // Find candidates linked to any of those institutions, excluding self.
    const links = await db
      .select({
        candidateId: candidateInstitutionsTable.candidateId,
        institutionId: candidateInstitutionsTable.institutionId,
        verifiedAt: candidateInstitutionsTable.verifiedAt,
      })
      .from(candidateInstitutionsTable)
      .where(
        and(
          inArray(
            candidateInstitutionsTable.institutionId,
            institutionIds,
          ),
          isNotNull(candidateInstitutionsTable.verifiedAt),
        ),
      );

    const mentorCandidateIds = Array.from(
      new Set(
        links
          .map((l) => l.candidateId)
          .filter((cid) => cid !== id),
      ),
    );
    if (mentorCandidateIds.length === 0) {
      res.json({ mentors: [] });
      return;
    }

    // Mentors must (a) be opted in AND (b) have actually been hired at
    // some point — i.e. they're alumni who can speak to working life,
    // not just other students.
    const hiredRows = await db
      .selectDistinct({ candidateId: applicationsTable.candidateId })
      .from(applicationsTable)
      .where(
        and(
          inArray(applicationsTable.candidateId, mentorCandidateIds),
          eq(applicationsTable.status, "hired"),
        ),
      );
    const hiredIds = new Set(hiredRows.map((r) => r.candidateId));
    const eligibleIds = mentorCandidateIds.filter((cid) => hiredIds.has(cid));
    if (eligibleIds.length === 0) {
      res.json({ mentors: [] });
      return;
    }

    const candidates = await db
      .select()
      .from(candidatesTable)
      .where(
        and(
          inArray(candidatesTable.id, eligibleIds),
          eq(candidatesTable.alumniMentorOptin, true),
        ),
      );

    const institutions = await db
      .select({
        id: institutionsTable.id,
        name: institutionsTable.name,
        logoUrl: institutionsTable.logoUrl,
      })
      .from(institutionsTable)
      .where(inArray(institutionsTable.id, institutionIds));
    const instById = new Map(institutions.map((i) => [i.id, i]));

    // Outgoing requests from me — used by client to show "Pending" pill.
    const myReqs = await db
      .select({
        mentorCandidateId: mentorshipRequestsTable.mentorCandidateId,
        status: mentorshipRequestsTable.status,
      })
      .from(mentorshipRequestsTable)
      .where(eq(mentorshipRequestsTable.requesterCandidateId, id));
    const reqStatusByMentor = new Map(
      myReqs.map((r) => [r.mentorCandidateId, r.status]),
    );

    const linksByCandidate = new Map<
      number,
      { institutionId: number; verifiedAt: Date | null }[]
    >();
    for (const l of links) {
      if (!linksByCandidate.has(l.candidateId)) {
        linksByCandidate.set(l.candidateId, []);
      }
      linksByCandidate.get(l.candidateId)!.push({
        institutionId: l.institutionId,
        verifiedAt: l.verifiedAt,
      });
    }

    const mentors = candidates
      .map((c) => {
        const myLinks = linksByCandidate.get(c.id) ?? [];
        const sharedInstitutions = myLinks
          .filter((l) => institutionIds.includes(l.institutionId))
          .map((l) => instById.get(l.institutionId))
          .filter((v): v is { id: number; name: string; logoUrl: string } => !!v);
        return {
          id: c.id,
          fullName: c.fullName,
          headline: c.headline,
          bio: c.bio,
          avatarUrl: c.avatarUrl,
          location: c.location,
          yearsExperience: c.yearsExperience,
          skills: c.skills,
          institutions: sharedInstitutions,
          requestStatus: reqStatusByMentor.get(c.id) ?? null,
        };
      })
      .sort((a, b) => b.yearsExperience - a.yearsExperience);

    res.json({ mentors });
  },
);

const CreateMentorRequestBody = z.object({
  mentorCandidateId: z.number().int().positive(),
  message: z.string().trim().min(1).max(2000),
});

/**
 * POST /candidates/:id/mentor-requests
 * One-shot intro request from requester → mentor. Verified shared
 * institution required. Mentor must be opted in. Notifies the mentor.
 */
router.post(
  "/candidates/:id/mentor-requests",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.candidateId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = CreateMentorRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { mentorCandidateId, message } = parsed.data;
    if (mentorCandidateId === id) {
      res.status(400).json({ error: "Cannot request yourself as mentor" });
      return;
    }

    const [mentor] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, mentorCandidateId));
    if (!mentor) {
      res.status(404).json({ error: "Mentor not found" });
      return;
    }
    if (!mentor.alumniMentorOptin) {
      res.status(400).json({ error: "Mentor is not accepting requests" });
      return;
    }

    const myInsts = new Set(await verifiedInstitutionIdsForCandidate(id));
    const mentorInsts = await verifiedInstitutionIdsForCandidate(
      mentorCandidateId,
    );
    const sharedInstitutionId = mentorInsts.find((iid) => myInsts.has(iid));
    if (sharedInstitutionId == null) {
      res.status(403).json({
        error: "You and this mentor are not verified at the same institution",
      });
      return;
    }

    try {
      const [created] = await db
        .insert(mentorshipRequestsTable)
        .values({
          requesterCandidateId: id,
          mentorCandidateId,
          institutionId: sharedInstitutionId,
          message,
          status: "pending",
        })
        .returning();

      // Notify mentor via in-app bell (handoff is one-shot; reply happens
      // by email outside the platform).
      const mentorUserId = await findUserIdForCandidate(mentorCandidateId);
      if (mentorUserId != null) {
        await sendNotification({
          userId: mentorUserId,
          kind: "mentor_request",
          title: `${me.fullName} asked to connect`,
          body: message.slice(0, 280),
          link: `/dashboard/candidate/mentor-requests`,
          category: "strongMatch",
        });
      }

      res.status(201).json({
        request: {
          id: created.id,
          status: created.status,
          mentorCandidateId,
          institutionId: sharedInstitutionId,
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err: unknown) {
      // Unique-violation: dedupe spam — reuse existing row's status.
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        const [existing] = await db
          .select()
          .from(mentorshipRequestsTable)
          .where(
            and(
              eq(mentorshipRequestsTable.requesterCandidateId, id),
              eq(
                mentorshipRequestsTable.mentorCandidateId,
                mentorCandidateId,
              ),
            ),
          );
        res.status(409).json({
          error: "You already have an open request with this mentor.",
          status: existing?.status ?? "pending",
        });
        return;
      }
      throw err;
    }
  },
);

/**
 * GET /candidates/:id/mentor-requests
 * Returns both incoming (mentor view) and outgoing (requester view)
 * mentorship requests for the candidate.
 */
router.get(
  "/candidates/:id/mentor-requests",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "admin" && me.candidateId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const all = await db
      .select()
      .from(mentorshipRequestsTable)
      .where(
        sql`${mentorshipRequestsTable.requesterCandidateId} = ${id} OR ${mentorshipRequestsTable.mentorCandidateId} = ${id}`,
      )
      .orderBy(desc(mentorshipRequestsTable.createdAt));

    const otherIds = Array.from(
      new Set(
        all.map((r) =>
          r.requesterCandidateId === id
            ? r.mentorCandidateId
            : r.requesterCandidateId,
        ),
      ),
    );
    const others =
      otherIds.length === 0
        ? []
        : await db
            .select({
              id: candidatesTable.id,
              fullName: candidatesTable.fullName,
              email: candidatesTable.email,
              headline: candidatesTable.headline,
              avatarUrl: candidatesTable.avatarUrl,
            })
            .from(candidatesTable)
            .where(inArray(candidatesTable.id, otherIds));
    const otherById = new Map(others.map((o) => [o.id, o]));

    const serialize = (r: typeof mentorshipRequestsTable.$inferSelect) => {
      const incoming = r.mentorCandidateId === id;
      const counterpartId = incoming
        ? r.requesterCandidateId
        : r.mentorCandidateId;
      const cp = otherById.get(counterpartId);
      return {
        id: r.id,
        direction: incoming ? "incoming" : "outgoing",
        status: r.status,
        message: r.message,
        institutionId: r.institutionId,
        // Email is only revealed when accepted (one-shot intro handoff).
        counterpart: {
          id: counterpartId,
          fullName: cp?.fullName ?? "Unknown",
          headline: cp?.headline ?? "",
          avatarUrl: cp?.avatarUrl ?? "",
          email: r.status === "accepted" ? cp?.email ?? null : null,
        },
        createdAt: r.createdAt.toISOString(),
        respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      };
    };

    res.json({ requests: all.map(serialize) });
  },
);

const PatchMentorRequestBody = z.object({
  status: z.enum(["accepted", "declined"]),
});

/**
 * PATCH /mentor-requests/:id
 * Mentor accepts or declines. Accepting reveals email addresses to both
 * parties (one-shot handoff) and notifies the requester.
 */
router.patch(
  "/mentor-requests/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.candidateId == null) {
      res.status(403).json({ error: "Candidate-only action" });
      return;
    }
    const parsed = PatchMentorRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(mentorshipRequestsTable)
      .where(eq(mentorshipRequestsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.mentorCandidateId !== me.candidateId) {
      res.status(403).json({ error: "Only the mentor can respond" });
      return;
    }
    if (existing.status !== "pending") {
      res.status(400).json({ error: "Request already responded to" });
      return;
    }

    const [updated] = await db
      .update(mentorshipRequestsTable)
      .set({ status: parsed.data.status, respondedAt: new Date() })
      .where(eq(mentorshipRequestsTable.id, id))
      .returning();

    const requesterUserId = await findUserIdForCandidate(
      existing.requesterCandidateId,
    );
    if (requesterUserId != null) {
      await sendNotification({
        userId: requesterUserId,
        kind: "mentor_request_response",
        title:
          parsed.data.status === "accepted"
            ? `${me.fullName} accepted your mentor request`
            : `${me.fullName} declined your mentor request`,
        body:
          parsed.data.status === "accepted"
            ? "You can now reach out by email — check your mentor inbox."
            : "",
        link: `/dashboard/candidate/mentor-requests`,
        category: "strongMatch",
      });
    }

    res.json({ ok: true, status: updated.status });
  },
);

// ===========================================================================
// Employer reviews
// ===========================================================================

const CreateReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(20).max(4000),
  institutionId: z.number().int().positive(),
});

/**
 * GET /employers/:id/reviews
 * Public. Returns approved reviews grouped (client-side) by institution.
 */
router.get(
  "/employers/:id/reviews",
  async (req, res): Promise<void> => {
    const employerId = Number(req.params.id);
    if (!Number.isInteger(employerId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await db
      .select({
        review: employerReviewsTable,
        candidate: {
          id: candidatesTable.id,
          fullName: candidatesTable.fullName,
          avatarUrl: candidatesTable.avatarUrl,
          headline: candidatesTable.headline,
        },
        institution: {
          id: institutionsTable.id,
          name: institutionsTable.name,
          logoUrl: institutionsTable.logoUrl,
        },
      })
      .from(employerReviewsTable)
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, employerReviewsTable.candidateId),
      )
      .innerJoin(
        institutionsTable,
        eq(institutionsTable.id, employerReviewsTable.institutionId),
      )
      .where(
        and(
          eq(employerReviewsTable.employerId, employerId),
          eq(employerReviewsTable.status, "approved"),
        ),
      )
      .orderBy(desc(employerReviewsTable.createdAt));

    res.json({
      reviews: rows.map((r) => ({
        id: r.review.id,
        rating: r.review.rating,
        body: r.review.body,
        createdAt: r.review.createdAt.toISOString(),
        candidate: r.candidate,
        institution: r.institution,
      })),
    });
  },
);

/**
 * POST /employers/:id/reviews
 * Auth + verified-hire required. Reviewer must have an active verified
 * affiliation with the institution they're reviewing under. One review
 * per (employer, candidate) — the unique index enforces this.
 */
router.post(
  "/employers/:id/reviews",
  requireAuth,
  async (req, res): Promise<void> => {
    const employerId = Number(req.params.id);
    if (!Number.isInteger(employerId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.candidateId == null) {
      res.status(403).json({ error: "Only candidates can leave reviews" });
      return;
    }
    const parsed = CreateReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const candidateId = me.candidateId;
    const { rating, body, institutionId } = parsed.data;

    const [employer] = await db
      .select({ id: employersTable.id })
      .from(employersTable)
      .where(eq(employersTable.id, employerId));
    if (!employer) {
      res.status(404).json({ error: "Employer not found" });
      return;
    }

    const wasHired = await candidateWasHiredAtEmployer(candidateId, employerId);
    if (!wasHired) {
      res.status(403).json({
        error: "Only candidates hired at this employer can leave a review.",
      });
      return;
    }

    const verifiedInsts = await verifiedInstitutionIdsForCandidate(candidateId);
    if (!verifiedInsts.includes(institutionId)) {
      res.status(403).json({
        error: "You are not verified at the chosen institution.",
      });
      return;
    }

    try {
      const [created] = await db
        .insert(employerReviewsTable)
        .values({
          employerId,
          candidateId,
          institutionId,
          rating,
          body,
          status: "pending",
        })
        .returning();
      res.status(201).json({
        review: {
          id: created.id,
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res.status(409).json({
          error: "You have already submitted a review for this employer.",
        });
        return;
      }
      throw err;
    }
  },
);

// ===========================================================================
// Placement stories (public read, admin moderate)
// ===========================================================================

/**
 * GET /placement-stories
 * Public. Approved spotlights ordered by sortOrder asc, then most recent.
 */
router.get("/placement-stories", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      story: placementStoriesTable,
      candidate: {
        id: candidatesTable.id,
        fullName: candidatesTable.fullName,
        avatarUrl: candidatesTable.avatarUrl,
        headline: candidatesTable.headline,
      },
      employer: {
        id: employersTable.id,
        name: employersTable.name,
        logoUrl: employersTable.logoUrl,
      },
    })
    .from(placementStoriesTable)
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, placementStoriesTable.candidateId),
    )
    .innerJoin(
      employersTable,
      eq(employersTable.id, placementStoriesTable.employerId),
    )
    .where(eq(placementStoriesTable.status, "approved"))
    .orderBy(
      asc(placementStoriesTable.sortOrder),
      desc(placementStoriesTable.createdAt),
    )
    .limit(20);

  res.json({
    stories: rows.map((r) => ({
      id: r.story.id,
      quote: r.story.quote,
      photoUrl: r.story.photoUrl,
      candidate: r.candidate,
      employer: r.employer,
      createdAt: r.story.createdAt.toISOString(),
    })),
  });
});

/**
 * GET /employers/:id/reviews/eligibility
 * Tells the client whether the current user can submit a review for this
 * employer (verified hire) and which of their verified institutions they
 * should attribute the review to. Used to gate the "Write review" CTA.
 */
router.get(
  "/employers/:id/reviews/eligibility",
  requireAuth,
  async (req, res): Promise<void> => {
    const employerId = Number(req.params.id);
    if (!Number.isInteger(employerId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (me.candidateId == null) {
      res.json({ canReview: false, institutions: [] });
      return;
    }
    const wasHired = await candidateWasHiredAtEmployer(
      me.candidateId,
      employerId,
    );
    if (!wasHired) {
      res.json({ canReview: false, institutions: [] });
      return;
    }
    const instIds = await verifiedInstitutionIdsForCandidate(me.candidateId);
    if (instIds.length === 0) {
      res.json({ canReview: false, institutions: [] });
      return;
    }
    const institutions = await db
      .select({ id: institutionsTable.id, name: institutionsTable.name })
      .from(institutionsTable)
      .where(inArray(institutionsTable.id, instIds));
    res.json({ canReview: true, institutions });
  },
);

const CreateStoryBody = z.object({
  employerId: z.number().int().positive(),
  quote: z.string().trim().min(20).max(800),
  photoUrl: z.string().url().optional().nullable(),
});

/**
 * POST /placement-stories
 * Candidate (verified hire required) submits a spotlight for moderation.
 */
router.post(
  "/placement-stories",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    if (me.candidateId == null) {
      res.status(403).json({ error: "Only candidates can submit stories" });
      return;
    }
    const parsed = CreateStoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { employerId, quote, photoUrl } = parsed.data;
    const wasHired = await candidateWasHiredAtEmployer(me.candidateId, employerId);
    if (!wasHired) {
      res.status(403).json({
        error: "You can only submit a story for an employer that hired you.",
      });
      return;
    }
    const verifiedInsts = await verifiedInstitutionIdsForCandidate(me.candidateId);
    const [created] = await db
      .insert(placementStoriesTable)
      .values({
        candidateId: me.candidateId,
        employerId,
        institutionId: verifiedInsts[0] ?? null,
        quote,
        photoUrl: photoUrl ?? null,
        status: "pending",
      })
      .returning();
    res.status(201).json({
      story: {
        id: created.id,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      },
    });
  },
);

// ===========================================================================
// Admin moderation
// ===========================================================================

/** GET /admin/employer-reviews?status=pending */
router.get(
  "/admin/employer-reviews",
  requireAdmin,
  async (req, res): Promise<void> => {
    const status = (req.query.status as string) ?? "pending";
    const rows = await db
      .select({
        review: employerReviewsTable,
        candidate: {
          id: candidatesTable.id,
          fullName: candidatesTable.fullName,
          avatarUrl: candidatesTable.avatarUrl,
        },
        employer: {
          id: employersTable.id,
          name: employersTable.name,
          logoUrl: employersTable.logoUrl,
        },
        institution: {
          id: institutionsTable.id,
          name: institutionsTable.name,
        },
      })
      .from(employerReviewsTable)
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, employerReviewsTable.candidateId),
      )
      .innerJoin(
        employersTable,
        eq(employersTable.id, employerReviewsTable.employerId),
      )
      .innerJoin(
        institutionsTable,
        eq(institutionsTable.id, employerReviewsTable.institutionId),
      )
      .where(
        status === "all"
          ? undefined
          : eq(employerReviewsTable.status, status),
      )
      .orderBy(desc(employerReviewsTable.createdAt));
    res.json({
      reviews: rows.map((r) => ({
        id: r.review.id,
        rating: r.review.rating,
        body: r.review.body,
        status: r.review.status,
        createdAt: r.review.createdAt.toISOString(),
        moderationNote: r.review.moderationNote,
        candidate: r.candidate,
        employer: r.employer,
        institution: r.institution,
      })),
    });
  },
);

const ModerateBody = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional().nullable(),
});

router.patch(
  "/admin/employer-reviews/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const parsed = ModerateBody.safeParse(req.body);
    if (!parsed.success || !Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [updated] = await db
      .update(employerReviewsTable)
      .set({
        status: parsed.data.status,
        moderationNote: parsed.data.note ?? null,
        moderatedAt: new Date(),
        moderatedBy: req.currentUser!.id,
      })
      .where(eq(employerReviewsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json({ ok: true, status: updated.status });
  },
);

/** GET /admin/placement-stories?status= */
router.get(
  "/admin/placement-stories",
  requireAdmin,
  async (req, res): Promise<void> => {
    const status = (req.query.status as string) ?? "pending";
    const rows = await db
      .select({
        story: placementStoriesTable,
        candidate: {
          id: candidatesTable.id,
          fullName: candidatesTable.fullName,
          avatarUrl: candidatesTable.avatarUrl,
        },
        employer: {
          id: employersTable.id,
          name: employersTable.name,
          logoUrl: employersTable.logoUrl,
        },
      })
      .from(placementStoriesTable)
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, placementStoriesTable.candidateId),
      )
      .innerJoin(
        employersTable,
        eq(employersTable.id, placementStoriesTable.employerId),
      )
      .where(
        status === "all"
          ? undefined
          : eq(placementStoriesTable.status, status),
      )
      .orderBy(desc(placementStoriesTable.createdAt));
    res.json({
      stories: rows.map((r) => ({
        id: r.story.id,
        quote: r.story.quote,
        photoUrl: r.story.photoUrl,
        status: r.story.status,
        sortOrder: r.story.sortOrder,
        createdAt: r.story.createdAt.toISOString(),
        moderationNote: r.story.moderationNote,
        candidate: r.candidate,
        employer: r.employer,
      })),
    });
  },
);

const ModerateStoryBody = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

router.patch(
  "/admin/placement-stories/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const parsed = ModerateStoryBody.safeParse(req.body);
    if (!parsed.success || !Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const updates: Record<string, unknown> = {
      status: parsed.data.status,
      moderationNote: parsed.data.note ?? null,
      moderatedAt: new Date(),
      moderatedBy: req.currentUser!.id,
    };
    if (parsed.data.sortOrder != null) {
      updates.sortOrder = parsed.data.sortOrder;
    }
    const [updated] = await db
      .update(placementStoriesTable)
      .set(updates)
      .where(eq(placementStoriesTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    res.json({ ok: true, status: updated.status });
  },
);

export default router;
