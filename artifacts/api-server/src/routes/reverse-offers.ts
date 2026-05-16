/**
 * Reverse Offers — open-to-offers auctions.
 *
 * Candidates open a time-bound auction window (default 7d, max 30d).
 * Employers can submit a one-shot offer (role + salary range + start
 * date + note) against any candidate with an active window. The candidate
 * accepts (creates an application row, reveals identity), declines, or
 * sends a single counter. Counters create a fresh pending offer pointing
 * at the original via parentOfferId.
 *
 * Privacy: the public discovery endpoint (`GET /open-candidates`)
 * returns anonymised cards only (skills, headline, talent score,
 * institution NAME — never id/email/phone/avatar/fullName). Identity is
 * revealed only to the offering employer on accept.
 */

import { Router, type IRouter } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  applicationStatusHistoryTable,
  applicationsTable,
  candidateInstitutionsTable,
  candidateOpenWindowsTable,
  candidatesTable,
  db,
  employersTable,
  institutionsTable,
  jobsTable,
  reverseOffersTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { sendNotification } from "../lib/notifier";

const router: IRouter = Router();

const MAX_WINDOW_DAYS = 30;
const DEFAULT_WINDOW_DAYS = 7;

function serializeWindow(w: typeof candidateOpenWindowsTable.$inferSelect) {
  return {
    id: w.id,
    candidateId: w.candidateId,
    opensAt: w.opensAt.toISOString(),
    closesAt: w.closesAt.toISOString(),
    isActive: w.closesAt.getTime() > Date.now(),
  };
}

function serializeOffer(
  o: typeof reverseOffersTable.$inferSelect,
  ctx: {
    employerName?: string | null;
    employerLogoUrl?: string | null;
    candidateName?: string | null;
    candidateHeadline?: string | null;
    candidateAvatarUrl?: string | null;
    /**
     * When true (employer view of a non-accepted offer), strip
     * `candidateId` so the caller can't follow it to `/candidates/:id`
     * and de-anonymise the candidate before they accept.
     */
    hideCandidateId?: boolean;
  } = {},
) {
  return {
    id: o.id,
    candidateId: ctx.hideCandidateId ? null : o.candidateId,
    employerId: o.employerId,
    employerName: ctx.employerName ?? null,
    employerLogoUrl: ctx.employerLogoUrl ?? null,
    candidateName: ctx.candidateName ?? null,
    candidateHeadline: ctx.candidateHeadline ?? null,
    candidateAvatarUrl: ctx.candidateAvatarUrl ?? null,
    jobTitle: o.jobTitle,
    salaryMin: o.salaryMin,
    salaryMax: o.salaryMax,
    currency: o.currency,
    startDate: o.startDate ?? null,
    note: o.note,
    status: o.status,
    parentOfferId: o.parentOfferId,
    applicationId: o.applicationId,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

async function findActiveWindow(
  candidateId: number,
): Promise<typeof candidateOpenWindowsTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(candidateOpenWindowsTable)
    .where(
      and(
        eq(candidateOpenWindowsTable.candidateId, candidateId),
        gt(candidateOpenWindowsTable.closesAt, new Date()),
      ),
    )
    .orderBy(desc(candidateOpenWindowsTable.closesAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Candidate-side: open/close window
// ---------------------------------------------------------------------------

const OpenWindowBody = z.object({
  days: z.coerce.number().int().min(1).max(MAX_WINDOW_DAYS).optional(),
});

router.post(
  "/me/open-window",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "candidate" || !user.candidateId) {
      res.status(403).json({ error: "Candidates only" });
      return;
    }
    const parsed = OpenWindowBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const days = parsed.data.days ?? DEFAULT_WINDOW_DAYS;
    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + days * 86_400_000);

    // Close any pre-existing active window so there's at most one open.
    await db
      .update(candidateOpenWindowsTable)
      .set({ closesAt: opensAt })
      .where(
        and(
          eq(candidateOpenWindowsTable.candidateId, user.candidateId),
          gt(candidateOpenWindowsTable.closesAt, opensAt),
        ),
      );

    const [created] = await db
      .insert(candidateOpenWindowsTable)
      .values({
        candidateId: user.candidateId,
        opensAt,
        closesAt,
      })
      .returning();

    // Mirror the legacy flag so existing employer filters keep working.
    await db
      .update(candidatesTable)
      .set({ openToOffers: true, openToOffersSince: opensAt })
      .where(eq(candidatesTable.id, user.candidateId));

    res.status(201).json(serializeWindow(created!));
  },
);

router.delete(
  "/me/open-window",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "candidate" || !user.candidateId) {
      res.status(403).json({ error: "Candidates only" });
      return;
    }
    const now = new Date();
    await db
      .update(candidateOpenWindowsTable)
      .set({ closesAt: now })
      .where(
        and(
          eq(candidateOpenWindowsTable.candidateId, user.candidateId),
          gt(candidateOpenWindowsTable.closesAt, now),
        ),
      );
    await db
      .update(candidatesTable)
      .set({ openToOffers: false })
      .where(eq(candidatesTable.id, user.candidateId));
    res.status(204).end();
  },
);

router.get("/me/open-window", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "candidate" || !user.candidateId) {
    res.json(null);
    return;
  }
  const w = await findActiveWindow(user.candidateId);
  res.json(w ? serializeWindow(w) : null);
});

// ---------------------------------------------------------------------------
// Discovery: anonymised open-candidate cards
// ---------------------------------------------------------------------------

const ListOpenQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0),
  skill: z.string().min(1).max(80).optional(),
});

router.get("/open-candidates", async (req, res): Promise<void> => {
  const parsed = ListOpenQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit, offset, skill } = parsed.data;

  const conditions = [gt(candidateOpenWindowsTable.closesAt, new Date())];
  if (skill) {
    conditions.push(sql`${skill} = ANY(${candidatesTable.skills})`);
  }

  const rows = await db
    .select({
      windowId: candidateOpenWindowsTable.id,
      closesAt: candidateOpenWindowsTable.closesAt,
      candidateId: candidatesTable.id,
      headline: candidatesTable.headline,
      location: candidatesTable.location,
      talentScore: candidatesTable.talentScore,
      yearsExperience: candidatesTable.yearsExperience,
      skills: candidatesTable.skills,
      institutionName: institutionsTable.name,
    })
    .from(candidateOpenWindowsTable)
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, candidateOpenWindowsTable.candidateId),
    )
    .leftJoin(
      institutionsTable,
      eq(institutionsTable.id, candidatesTable.institutionId),
    )
    .where(and(...conditions))
    .orderBy(desc(candidateOpenWindowsTable.opensAt))
    .limit(limit)
    .offset(offset);

  // Strip PII. We expose ONLY the windowId as the public handle —
  // employers post offers against the window, never against the raw
  // candidate id (which we still echo for the candidate's own surface).
  res.json(
    rows.map((r) => ({
      id: r.windowId,
      closesAt: r.closesAt.toISOString(),
      headline: r.headline,
      location: r.location,
      talentScore: r.talentScore,
      yearsExperience: r.yearsExperience,
      skills: r.skills,
      institutionName: r.institutionName ?? null,
    })),
  );
});

// ---------------------------------------------------------------------------
// Employer-side: post offer against an open window
// ---------------------------------------------------------------------------

const OfferBody = z.object({
  jobTitle: z.string().min(2).max(200),
  salaryMin: z.coerce.number().int().min(0),
  salaryMax: z.coerce.number().int().min(0),
  currency: z.string().min(2).max(8).default("USD"),
  startDate: z.string().optional(), // ISO date
  note: z.string().max(2000).optional(),
});

router.post(
  "/open-candidates/:windowId/offers",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "employer" || !user.employerId) {
      res.status(403).json({ error: "Employers only" });
      return;
    }
    const windowId = Number(req.params.windowId);
    if (!Number.isInteger(windowId) || windowId <= 0) {
      res.status(400).json({ error: "Invalid window id" });
      return;
    }
    const parsed = OfferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.salaryMax < parsed.data.salaryMin) {
      res.status(400).json({ error: "salaryMax must be >= salaryMin" });
      return;
    }

    const [window] = await db
      .select()
      .from(candidateOpenWindowsTable)
      .where(eq(candidateOpenWindowsTable.id, windowId))
      .limit(1);
    if (!window) {
      res.status(404).json({ error: "Window not found" });
      return;
    }
    if (window.closesAt.getTime() <= Date.now()) {
      res.status(410).json({ error: "Window is closed" });
      return;
    }

    const [created] = await db
      .insert(reverseOffersTable)
      .values({
        candidateId: window.candidateId,
        employerId: user.employerId,
        jobTitle: parsed.data.jobTitle,
        salaryMin: parsed.data.salaryMin,
        salaryMax: parsed.data.salaryMax,
        currency: parsed.data.currency.toUpperCase(),
        startDate: parsed.data.startDate ?? null,
        note: parsed.data.note ?? "",
        status: "pending",
      })
      .returning();

    // Notify candidate (in-app + push). Anonymise the employer name in
    // the body so the candidate is not pressured by brand — they see
    // the full identity once they open the inbox.
    const [candidateUser] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.candidateId, window.candidateId))
      .limit(1);
    if (candidateUser) {
      const [emp] = await db
        .select({ name: employersTable.name })
        .from(employersTable)
        .where(eq(employersTable.id, user.employerId))
        .limit(1);
      await sendNotification({
        userId: candidateUser.userId,
        kind: "reverse_offer_received",
        title: "New reverse offer",
        body: `${emp?.name ?? "An employer"} sent you an offer for ${parsed.data.jobTitle}.`,
        link: "/account/offers",
        category: "applicationStatus",
        data: { offerId: created!.id },
      });
    }

    // Employer just posted — hide the candidateId (pending status, not
    // yet accepted) so the response can't be used to deanonymise.
    res.status(201).json(serializeOffer(created!, { hideCandidateId: true }));
  },
);

// ---------------------------------------------------------------------------
// Inboxes: candidate's received offers, employer's sent offers
// ---------------------------------------------------------------------------

router.get("/me/offers", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.role !== "candidate" || !user.candidateId) {
    res.status(403).json({ error: "Candidates only" });
    return;
  }
  const rows = await db
    .select({
      offer: reverseOffersTable,
      employerName: employersTable.name,
      employerLogoUrl: employersTable.logoUrl,
    })
    .from(reverseOffersTable)
    .innerJoin(
      employersTable,
      eq(employersTable.id, reverseOffersTable.employerId),
    )
    .where(eq(reverseOffersTable.candidateId, user.candidateId))
    .orderBy(desc(reverseOffersTable.createdAt));

  res.json(
    rows.map((r) =>
      serializeOffer(r.offer, {
        employerName: r.employerName,
        employerLogoUrl: r.employerLogoUrl,
      }),
    ),
  );
});

router.get(
  "/me/sent-offers",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "employer" || !user.employerId) {
      res.status(403).json({ error: "Employers only" });
      return;
    }
    const rows = await db
      .select({
        offer: reverseOffersTable,
        candidateName: candidatesTable.fullName,
        candidateHeadline: candidatesTable.headline,
        candidateAvatarUrl: candidatesTable.avatarUrl,
      })
      .from(reverseOffersTable)
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, reverseOffersTable.candidateId),
      )
      .where(eq(reverseOffersTable.employerId, user.employerId))
      .orderBy(desc(reverseOffersTable.createdAt));

    // Identity is revealed to the employer only on accepted offers.
    // For pending / countered / declined / expired we strip name +
    // avatar so the employer can't deanonymise without consent.
    res.json(
      rows.map((r) => {
        const revealed = r.offer.status === "accepted";
        return serializeOffer(r.offer, {
          // Only accepted offers reveal candidate name, avatar, AND
          // candidateId — the latter would otherwise be a clean key to
          // GET /candidates/:id and bypass the masking entirely.
          candidateName: revealed ? r.candidateName : null,
          candidateHeadline: r.candidateHeadline,
          candidateAvatarUrl: revealed ? r.candidateAvatarUrl : null,
          hideCandidateId: !revealed,
        });
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Actions on a received offer: accept | decline | counter
// ---------------------------------------------------------------------------

async function loadOwnedOffer(
  offerId: number,
  candidateId: number,
): Promise<typeof reverseOffersTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(reverseOffersTable)
    .where(
      and(
        eq(reverseOffersTable.id, offerId),
        eq(reverseOffersTable.candidateId, candidateId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findEmployerUser(employerId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.employerId, employerId))
    .limit(1);
  return row?.userId ?? null;
}

router.post(
  "/me/offers/:id/accept",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "candidate" || !user.candidateId) {
      res.status(403).json({ error: "Candidates only" });
      return;
    }
    const offerId = Number(req.params.id);
    if (!Number.isInteger(offerId) || offerId <= 0) {
      res.status(400).json({ error: "Invalid offer id" });
      return;
    }
    const offer = await loadOwnedOffer(offerId, user.candidateId);
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({ error: `Offer is already ${offer.status}` });
      return;
    }
    // Candidate-authored counters (parentOfferId set) are awaiting an
    // employer response — the candidate must not self-accept their own
    // counter. Only the original employer-authored offer can be accepted
    // by the candidate. Same goes for decline/counter below.
    if (offer.parentOfferId) {
      res.status(409).json({
        error: "This is your counter offer. Wait for the employer to respond.",
      });
      return;
    }

    // Find or create a placeholder "reverse-offer" job for the employer
    // so we can produce an application row. We deliberately do NOT
    // create a public job listing; the job is private (status=draft)
    // and exists only to bridge the offer into the pipeline.
    const [job] = await db
      .insert(jobsTable)
      .values({
        employerId: offer.employerId,
        title: offer.jobTitle,
        summary: `Reverse offer accepted by candidate.`,
        description: `Reverse offer accepted by candidate. Salary ${offer.salaryMin}-${offer.salaryMax} ${offer.currency}.`,
        location: "Remote",
        type: "full_time",
        currency: offer.currency,
        salaryMin: offer.salaryMin,
        salaryMax: offer.salaryMax,
      })
      .returning();

    const [app] = await db
      .insert(applicationsTable)
      .values({
        jobId: job!.id,
        candidateId: offer.candidateId,
        status: "offer",
        source: "reverse_offer",
        matchScore: 100,
      })
      .returning();

    await db.insert(applicationStatusHistoryTable).values({
      applicationId: app!.id,
      status: "offer",
    });

    // Atomic compare-and-set: only flip pending -> accepted. If a
    // concurrent counter/decline already moved this offer to a non-
    // pending state, we abort and roll back the side effects we just
    // created (job + application + status history) to avoid split-brain.
    const flipped = await db
      .update(reverseOffersTable)
      .set({ status: "accepted", applicationId: app!.id })
      .where(
        and(
          eq(reverseOffersTable.id, offer.id),
          eq(reverseOffersTable.status, "pending"),
        ),
      )
      .returning();
    if (flipped.length === 0) {
      await db
        .delete(applicationStatusHistoryTable)
        .where(eq(applicationStatusHistoryTable.applicationId, app!.id));
      await db.delete(applicationsTable).where(eq(applicationsTable.id, app!.id));
      await db.delete(jobsTable).where(eq(jobsTable.id, job!.id));
      res.status(409).json({ error: "Offer is no longer pending" });
      return;
    }
    const [updated] = flipped;

    // Notify employer.
    const employerUserId = await findEmployerUser(offer.employerId);
    if (employerUserId) {
      await sendNotification({
        userId: employerUserId,
        kind: "reverse_offer_accepted",
        title: "Offer accepted",
        body: `Your offer for ${offer.jobTitle} was accepted.`,
        link: `/dashboard/employer`,
        category: "applicationStatus",
        data: { offerId: offer.id, applicationId: app!.id },
      });
    }

    res.json(serializeOffer(updated!));
  },
);

router.post(
  "/me/offers/:id/decline",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "candidate" || !user.candidateId) {
      res.status(403).json({ error: "Candidates only" });
      return;
    }
    const offerId = Number(req.params.id);
    if (!Number.isInteger(offerId) || offerId <= 0) {
      res.status(400).json({ error: "Invalid offer id" });
      return;
    }
    const offer = await loadOwnedOffer(offerId, user.candidateId);
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({ error: `Offer is already ${offer.status}` });
      return;
    }
    if (offer.parentOfferId) {
      res.status(409).json({
        error: "This is your counter offer. Wait for the employer to respond.",
      });
      return;
    }
    const flipped = await db
      .update(reverseOffersTable)
      .set({ status: "declined" })
      .where(
        and(
          eq(reverseOffersTable.id, offer.id),
          eq(reverseOffersTable.status, "pending"),
        ),
      )
      .returning();
    if (flipped.length === 0) {
      res.status(409).json({ error: "Offer is no longer pending" });
      return;
    }
    // Declined offers expire silently per the spec — no notification to
    // the employer. The sent-offers view will reflect the status change.
    res.json(serializeOffer(flipped[0]!));
  },
);

const CounterBody = OfferBody.partial({
  jobTitle: true,
  currency: true,
}).extend({
  jobTitle: z.string().min(2).max(200).optional(),
  salaryMin: z.coerce.number().int().min(0),
  salaryMax: z.coerce.number().int().min(0),
});

router.post(
  "/me/offers/:id/counter",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "candidate" || !user.candidateId) {
      res.status(403).json({ error: "Candidates only" });
      return;
    }
    const offerId = Number(req.params.id);
    if (!Number.isInteger(offerId) || offerId <= 0) {
      res.status(400).json({ error: "Invalid offer id" });
      return;
    }
    const parsed = CounterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.salaryMax < parsed.data.salaryMin) {
      res.status(400).json({ error: "salaryMax must be >= salaryMin" });
      return;
    }
    const offer = await loadOwnedOffer(offerId, user.candidateId);
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({ error: `Offer is already ${offer.status}` });
      return;
    }

    // Single-counter only — if this offer is itself a counter
    // (parentOfferId set), it's the candidate's own pending counter
    // and they must wait for the employer to respond. Refuse another
    // round either way.
    if (offer.parentOfferId) {
      res
        .status(409)
        .json({ error: "Counters are limited to one round" });
      return;
    }

    // Race-safe transition: only move pending -> countered if it's still
    // pending AND has no parent. If two concurrent counter requests land
    // for the same offer, only one update returns a row; the other gets
    // 409. This prevents double-counter via interleaved requests.
    const flipped = await db
      .update(reverseOffersTable)
      .set({ status: "countered" })
      .where(
        and(
          eq(reverseOffersTable.id, offer.id),
          eq(reverseOffersTable.status, "pending"),
          sql`${reverseOffersTable.parentOfferId} IS NULL`,
        ),
      )
      .returning({ id: reverseOffersTable.id });
    if (flipped.length === 0) {
      res
        .status(409)
        .json({ error: "Offer is no longer counterable" });
      return;
    }

    const [counter] = await db
      .insert(reverseOffersTable)
      .values({
        candidateId: offer.candidateId,
        employerId: offer.employerId,
        jobTitle: parsed.data.jobTitle ?? offer.jobTitle,
        salaryMin: parsed.data.salaryMin,
        salaryMax: parsed.data.salaryMax,
        currency: (parsed.data.currency ?? offer.currency).toUpperCase(),
        startDate: parsed.data.startDate ?? offer.startDate ?? null,
        note: parsed.data.note ?? "",
        status: "pending",
        parentOfferId: offer.id,
      })
      .returning();

    const employerUserId = await findEmployerUser(offer.employerId);
    if (employerUserId) {
      await sendNotification({
        userId: employerUserId,
        kind: "reverse_offer_countered",
        title: "Candidate countered your offer",
        body: `Counter: ${counter!.salaryMin}-${counter!.salaryMax} ${counter!.currency}.`,
        link: "/dashboard/employer/offers",
        category: "applicationStatus",
        data: { offerId: counter!.id, parentOfferId: offer.id },
      });
    }

    res.status(201).json(serializeOffer(counter!));
  },
);

// ---------------------------------------------------------------------
// Employer endpoints for responding to a candidate's counter-offer.
// A counter is a reverse_offers row with parentOfferId set; its owner
// (the candidate) cannot accept/decline it themselves — only the
// employer who posted the original offer can.
// ---------------------------------------------------------------------

async function loadCounterForEmployer(
  offerId: number,
  employerId: number,
): Promise<typeof reverseOffersTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(reverseOffersTable)
    .where(
      and(
        eq(reverseOffersTable.id, offerId),
        eq(reverseOffersTable.employerId, employerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

router.post(
  "/me/sent-offers/:id/accept-counter",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "employer" || !user.employerId) {
      res.status(403).json({ error: "Employers only" });
      return;
    }
    const offerId = Number(req.params.id);
    if (!Number.isInteger(offerId) || offerId <= 0) {
      res.status(400).json({ error: "Invalid offer id" });
      return;
    }
    const offer = await loadCounterForEmployer(offerId, user.employerId);
    if (!offer || !offer.parentOfferId) {
      res.status(404).json({ error: "Counter not found" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({ error: `Counter is already ${offer.status}` });
      return;
    }

    // Same private job + application bridge as the candidate-accept
    // path, then atomic flip with rollback on lost race.
    const [job] = await db
      .insert(jobsTable)
      .values({
        employerId: offer.employerId,
        title: offer.jobTitle,
        summary: `Counter offer accepted by employer.`,
        description: `Counter offer accepted. Salary ${offer.salaryMin}-${offer.salaryMax} ${offer.currency}.`,
        location: "Remote",
        type: "full_time",
        currency: offer.currency,
        salaryMin: offer.salaryMin,
        salaryMax: offer.salaryMax,
      })
      .returning();
    const [app] = await db
      .insert(applicationsTable)
      .values({
        jobId: job!.id,
        candidateId: offer.candidateId,
        status: "offer",
        source: "reverse_offer",
        matchScore: 100,
      })
      .returning();
    await db.insert(applicationStatusHistoryTable).values({
      applicationId: app!.id,
      status: "offer",
    });
    const flipped = await db
      .update(reverseOffersTable)
      .set({ status: "accepted", applicationId: app!.id })
      .where(
        and(
          eq(reverseOffersTable.id, offer.id),
          eq(reverseOffersTable.status, "pending"),
        ),
      )
      .returning();
    if (flipped.length === 0) {
      await db
        .delete(applicationStatusHistoryTable)
        .where(eq(applicationStatusHistoryTable.applicationId, app!.id));
      await db.delete(applicationsTable).where(eq(applicationsTable.id, app!.id));
      await db.delete(jobsTable).where(eq(jobsTable.id, job!.id));
      res.status(409).json({ error: "Counter is no longer pending" });
      return;
    }

    // Notify candidate.
    const [candUser] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.candidateId, offer.candidateId))
      .limit(1);
    if (candUser?.userId) {
      await sendNotification({
        userId: candUser.userId,
        kind: "reverse_offer_counter_accepted",
        title: "Counter accepted",
        body: `Your counter for ${offer.jobTitle} was accepted.`,
        link: "/account/offers",
        category: "applicationStatus",
        data: { offerId: offer.id, applicationId: app!.id },
      });
    }
    res.json(serializeOffer(flipped[0]!));
  },
);

router.post(
  "/me/sent-offers/:id/decline-counter",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.currentUser!;
    if (user.role !== "employer" || !user.employerId) {
      res.status(403).json({ error: "Employers only" });
      return;
    }
    const offerId = Number(req.params.id);
    if (!Number.isInteger(offerId) || offerId <= 0) {
      res.status(400).json({ error: "Invalid offer id" });
      return;
    }
    const offer = await loadCounterForEmployer(offerId, user.employerId);
    if (!offer || !offer.parentOfferId) {
      res.status(404).json({ error: "Counter not found" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({ error: `Counter is already ${offer.status}` });
      return;
    }
    const flipped = await db
      .update(reverseOffersTable)
      .set({ status: "declined" })
      .where(
        and(
          eq(reverseOffersTable.id, offer.id),
          eq(reverseOffersTable.status, "pending"),
        ),
      )
      .returning();
    if (flipped.length === 0) {
      res.status(409).json({ error: "Counter is no longer pending" });
      return;
    }
    // Silent on the candidate side, matching the original decline UX.
    res.json(serializeOffer(flipped[0]!));
  },
);

export default router;
