import { Router, type IRouter } from "express";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  interviewInvitesTable,
  interviewTimeSlotsTable,
  applicationsTable,
  jobsTable,
  candidatesTable,
  employersTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

type SerializedInvite = {
  id: number;
  applicationId: number;
  jobId: number;
  jobTitle: string;
  employerId: number;
  employerName: string;
  candidateId: number;
  candidateName: string;
  status: string;
  location: string;
  meetingLink: string;
  notes: string;
  declineReason: string;
  selectedSlotId: number | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  timeSlots: {
    id: number;
    inviteId: number;
    startsAt: string;
    endsAt: string;
  }[];
};

/**
 * Load one invite plus all the join data needed to serialize it +
 * authorize the request. Returns null when the invite does not exist.
 */
async function loadInviteContext(inviteId: number) {
  const rows = await db
    .select({
      invite: interviewInvitesTable,
      application: applicationsTable,
      job: jobsTable,
      employer: employersTable,
      candidate: candidatesTable,
    })
    .from(interviewInvitesTable)
    .innerJoin(
      applicationsTable,
      eq(applicationsTable.id, interviewInvitesTable.applicationId),
    )
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(
      employersTable,
      eq(employersTable.id, interviewInvitesTable.employerId),
    )
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, applicationsTable.candidateId),
    )
    .where(eq(interviewInvitesTable.id, inviteId))
    .limit(1);
  return rows[0] ?? null;
}

async function serializeInviteById(
  inviteId: number,
): Promise<SerializedInvite | null> {
  const ctx = await loadInviteContext(inviteId);
  if (!ctx) return null;
  const slots = await db
    .select()
    .from(interviewTimeSlotsTable)
    .where(eq(interviewTimeSlotsTable.inviteId, inviteId))
    .orderBy(asc(interviewTimeSlotsTable.startsAt));
  return {
    id: ctx.invite.id,
    applicationId: ctx.invite.applicationId,
    jobId: ctx.job.id,
    jobTitle: ctx.job.title,
    employerId: ctx.employer.id,
    employerName: ctx.employer.name,
    candidateId: ctx.candidate.id,
    candidateName: ctx.candidate.fullName,
    status: ctx.invite.status,
    location: ctx.invite.location,
    meetingLink: ctx.invite.meetingLink,
    notes: ctx.invite.notes,
    declineReason: ctx.invite.declineReason,
    selectedSlotId: ctx.invite.selectedSlotId,
    respondedAt: ctx.invite.respondedAt
      ? ctx.invite.respondedAt.toISOString()
      : null,
    createdAt: ctx.invite.createdAt.toISOString(),
    updatedAt: ctx.invite.updatedAt.toISOString(),
    timeSlots: slots.map((s) => ({
      id: s.id,
      inviteId: s.inviteId,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  };
}

async function serializeManyInvites(
  inviteIds: number[],
): Promise<SerializedInvite[]> {
  if (inviteIds.length === 0) return [];
  // Hydrate in parallel; volume is small (per-application or per-candidate).
  return (await Promise.all(inviteIds.map((id) => serializeInviteById(id))))
    .filter((x): x is SerializedInvite => x !== null);
}

function isEmployerForApplication(
  user: { role: string; employerId: number | null },
  ctxEmployerId: number,
): boolean {
  return user.role === "employer" && user.employerId === ctxEmployerId;
}

/**
 * Accept only http(s) URLs for the meeting link. This guards against
 * `javascript:` / custom-scheme payloads that could fire when the
 * candidate clicks the link in the UI.
 */
function isSafeMeetingLink(value: string): boolean {
  if (value.length === 0) return true; // empty is allowed (means "no link")
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function isCandidateForApplication(
  user: { role: string; candidateId: number | null },
  ctxCandidateId: number,
): boolean {
  return user.role === "candidate" && user.candidateId === ctxCandidateId;
}

/**
 * POST /api/applications/:id/interview-invites
 * Employer (owner of the job) schedules an interview by proposing 1..5 slots.
 * Candidate is notified; the application is moved to status='interview' so
 * the existing pipeline counters stay in sync.
 */
router.post(
  "/applications/:id/interview-invites",
  requireAuth,
  async (req, res) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        res.status(400).json({ error: "Invalid application id" });
        return;
      }
      const user = req.currentUser!;

      const body = (req.body ?? {}) as {
        location?: unknown;
        meetingLink?: unknown;
        notes?: unknown;
        slots?: unknown;
      };
      const location =
        typeof body.location === "string" ? body.location.trim() : "";
      const meetingLink =
        typeof body.meetingLink === "string" ? body.meetingLink.trim() : "";
      if (!isSafeMeetingLink(meetingLink)) {
        res
          .status(400)
          .json({ error: "Meeting link must be an http(s) URL" });
        return;
      }
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (!Array.isArray(body.slots) || body.slots.length === 0) {
        res.status(400).json({ error: "At least one time slot is required" });
        return;
      }
      if (body.slots.length > 5) {
        res.status(400).json({ error: "At most 5 time slots are allowed" });
        return;
      }

      type RawSlot = { startsAt?: unknown; endsAt?: unknown };
      const parsedSlots: { startsAt: Date; endsAt: Date }[] = [];
      for (const raw of body.slots as RawSlot[]) {
        if (
          !raw ||
          typeof raw.startsAt !== "string" ||
          typeof raw.endsAt !== "string"
        ) {
          res
            .status(400)
            .json({ error: "Each slot must have startsAt and endsAt strings" });
          return;
        }
        const startsAt = new Date(raw.startsAt);
        const endsAt = new Date(raw.endsAt);
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
          res.status(400).json({ error: "Invalid date in time slot" });
          return;
        }
        if (endsAt.getTime() <= startsAt.getTime()) {
          res
            .status(400)
            .json({ error: "Time slot endsAt must be after startsAt" });
          return;
        }
        parsedSlots.push({ startsAt, endsAt });
      }

      const [appRow] = await db
        .select({
          applicationId: applicationsTable.id,
          jobEmployerId: jobsTable.employerId,
          candidateId: applicationsTable.candidateId,
          jobTitle: jobsTable.title,
        })
        .from(applicationsTable)
        .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
        .where(eq(applicationsTable.id, applicationId));
      if (!appRow) {
        res.status(404).json({ error: "Application not found" });
        return;
      }

      const isEmployerOwner =
        user.role === "employer" && user.employerId === appRow.jobEmployerId;
      const isAdmin = user.role === "admin";
      if (!isEmployerOwner && !isAdmin) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      // Look up the candidate's user account so we can notify them.
      // The link is on usersTable.candidateId (a user "becomes" a
      // candidate by getting their candidateId column populated), so
      // we do the lookup the other direction.
      const candUserRows = await db
        .select({ userId: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.candidateId, appRow.candidateId))
        .limit(1);
      const candidateUserId = candUserRows[0]?.userId ?? null;

      const newInviteId = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(interviewInvitesTable)
          .values({
            applicationId,
            employerId: appRow.jobEmployerId,
            createdByUserId: user.id,
            status: "proposed",
            location,
            meetingLink,
            notes,
          })
          .returning({ id: interviewInvitesTable.id });
        const inviteId = inserted!.id;

        await tx.insert(interviewTimeSlotsTable).values(
          parsedSlots.map((s) => ({
            inviteId,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
          })),
        );

        // Auto-flip the application's pipeline status so the existing
        // employer dashboard counter ("Interviews scheduled") stays in
        // sync with the new scheduling flow.
        await tx
          .update(applicationsTable)
          .set({ status: "interview" })
          .where(eq(applicationsTable.id, applicationId));

        if (candidateUserId) {
          await tx.insert(notificationsTable).values({
            userId: candidateUserId,
            kind: "interview_invite",
            title: "Interview invitation",
            body: `You've been invited to interview for "${appRow.jobTitle}". Pick a time slot.`,
            link: `/interviews/${inviteId}`,
          });
        }
        return inviteId;
      });

      const serialized = await serializeInviteById(newInviteId);
      res.status(201).json(serialized);
    } catch (err) {
      req.log.error({ err }, "create interview invite failed");
      res.status(500).json({ error: "Failed to create interview invite" });
    }
  },
);

/**
 * GET /api/applications/:id/interview-invites
 * Lists every invite attached to one application. Visible to the
 * application's candidate, the job's employer, and admins.
 */
router.get(
  "/applications/:id/interview-invites",
  requireAuth,
  async (req, res) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId) || applicationId <= 0) {
        res.status(400).json({ error: "Invalid application id" });
        return;
      }
      const user = req.currentUser!;
      const [appRow] = await db
        .select({
          jobEmployerId: jobsTable.employerId,
          candidateId: applicationsTable.candidateId,
        })
        .from(applicationsTable)
        .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
        .where(eq(applicationsTable.id, applicationId));
      if (!appRow) {
        res.status(404).json({ error: "Application not found" });
        return;
      }
      const isEmployerOwner =
        user.role === "employer" && user.employerId === appRow.jobEmployerId;
      const isCandidateOwner =
        user.role === "candidate" && user.candidateId === appRow.candidateId;
      const isAdmin = user.role === "admin";
      if (!isEmployerOwner && !isCandidateOwner && !isAdmin) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      const ids = (
        await db
          .select({ id: interviewInvitesTable.id })
          .from(interviewInvitesTable)
          .where(eq(interviewInvitesTable.applicationId, applicationId))
          .orderBy(desc(interviewInvitesTable.createdAt))
      ).map((r) => r.id);
      res.json(await serializeManyInvites(ids));
    } catch (err) {
      req.log.error({ err }, "list invites for application failed");
      res.status(500).json({ error: "Failed to load invites" });
    }
  },
);

/**
 * GET /api/candidates/:id/interview-invites?status=...
 * The candidate's "my invites" feed. Optional status filter.
 */
router.get(
  "/candidates/:id/interview-invites",
  requireAuth,
  async (req, res) => {
    try {
      const candidateId = Number(req.params.id);
      if (!Number.isInteger(candidateId) || candidateId <= 0) {
        res.status(400).json({ error: "Invalid candidate id" });
        return;
      }
      const user = req.currentUser!;
      const isOwner =
        user.role === "candidate" && user.candidateId === candidateId;
      const isAdmin = user.role === "admin";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      const statusFilter =
        typeof req.query.status === "string"
          ? String(req.query.status)
          : undefined;
      const allowedStatuses = new Set([
        "proposed",
        "accepted",
        "declined",
        "cancelled",
      ]);
      if (statusFilter && !allowedStatuses.has(statusFilter)) {
        res.status(400).json({ error: "Invalid status filter" });
        return;
      }

      // Find all applications belonging to this candidate, then their
      // invites. We do this via a single join so we don't fan out
      // queries.
      const conds = [eq(applicationsTable.candidateId, candidateId)];
      if (statusFilter) conds.push(eq(interviewInvitesTable.status, statusFilter));
      const ids = (
        await db
          .select({ id: interviewInvitesTable.id })
          .from(interviewInvitesTable)
          .innerJoin(
            applicationsTable,
            eq(applicationsTable.id, interviewInvitesTable.applicationId),
          )
          .where(and(...conds))
          .orderBy(desc(interviewInvitesTable.createdAt))
      ).map((r) => r.id);
      res.json(await serializeManyInvites(ids));
    } catch (err) {
      req.log.error({ err }, "list invites for candidate failed");
      res.status(500).json({ error: "Failed to load invites" });
    }
  },
);

/**
 * GET /api/interview-invites/:id
 * Single-invite fetch. Used by both employer + candidate detail screens.
 */
router.get("/interview-invites/:id", requireAuth, async (req, res) => {
  try {
    const inviteId = Number(req.params.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      res.status(400).json({ error: "Invalid invite id" });
      return;
    }
    const ctx = await loadInviteContext(inviteId);
    if (!ctx) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const user = req.currentUser!;
    const isEmployerOwner = isEmployerForApplication(user, ctx.employer.id);
    const isCandidateOwner = isCandidateForApplication(user, ctx.candidate.id);
    const isAdmin = user.role === "admin";
    if (!isEmployerOwner && !isCandidateOwner && !isAdmin) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const serialized = await serializeInviteById(inviteId);
    res.json(serialized);
  } catch (err) {
    req.log.error({ err }, "get invite failed");
    res.status(500).json({ error: "Failed to load invite" });
  }
});

/**
 * POST /api/interview-invites/:id/accept
 * Candidate picks one of the proposed slots. The transaction is the
 * single source of truth for the pending->accepted flip; concurrent
 * accept calls cannot pick conflicting slots.
 */
router.post("/interview-invites/:id/accept", requireAuth, async (req, res) => {
  try {
    const inviteId = Number(req.params.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      res.status(400).json({ error: "Invalid invite id" });
      return;
    }
    const body = (req.body ?? {}) as { slotId?: unknown };
    const slotId = Number(body.slotId);
    if (!Number.isInteger(slotId) || slotId <= 0) {
      res.status(400).json({ error: "slotId required" });
      return;
    }

    const ctx = await loadInviteContext(inviteId);
    if (!ctx) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const user = req.currentUser!;
    if (!isCandidateForApplication(user, ctx.candidate.id)) {
      res.status(403).json({ error: "Only the invited candidate can accept" });
      return;
    }

    // Idempotency: re-accepting the same slot is a no-op success;
    // accepting a different slot or after a terminal change is 409.
    if (ctx.invite.status === "accepted") {
      if (ctx.invite.selectedSlotId === slotId) {
        const serialized = await serializeInviteById(inviteId);
        res.json(serialized);
        return;
      }
      res
        .status(409)
        .json({ error: "Invite is already accepted with a different slot" });
      return;
    }
    if (ctx.invite.status !== "proposed") {
      res
        .status(409)
        .json({ error: `Invite is already ${ctx.invite.status}` });
      return;
    }

    // Validate the slot belongs to this invite.
    const slotRows = await db
      .select()
      .from(interviewTimeSlotsTable)
      .where(
        and(
          eq(interviewTimeSlotsTable.id, slotId),
          eq(interviewTimeSlotsTable.inviteId, inviteId),
        ),
      )
      .limit(1);
    if (!slotRows[0]) {
      res.status(400).json({ error: "Slot does not belong to this invite" });
      return;
    }

    const flipResult = await db.transaction(async (tx) => {
      // Atomic: only the request that flips proposed->accepted gets to
      // record the chosen slot.
      const flipped = await tx
        .update(interviewInvitesTable)
        .set({
          status: "accepted",
          selectedSlotId: slotId,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(interviewInvitesTable.id, inviteId),
            eq(interviewInvitesTable.status, "proposed"),
          ),
        )
        .returning({ id: interviewInvitesTable.id });
      if (flipped.length === 0) return false;

      // Keep the application pipeline stage in sync.
      await tx
        .update(applicationsTable)
        .set({ status: "interview" })
        .where(eq(applicationsTable.id, ctx.invite.applicationId));

      // Notify the employer who created the invite (so they see
      // the response in their bell).
      if (ctx.invite.createdByUserId !== null) {
        await tx.insert(notificationsTable).values({
          userId: ctx.invite.createdByUserId,
          kind: "interview_accepted",
          title: "Interview accepted",
          body: `${ctx.candidate.fullName} accepted the interview for "${ctx.job.title}".`,
          link: `/interviews/${inviteId}`,
        });
      }
      return true;
    });

    if (!flipResult) {
      // Someone else changed the invite while our pre-check was
      // running. Re-resolve and surface a deterministic answer.
      const fresh = await loadInviteContext(inviteId);
      if (
        fresh?.invite.status === "accepted" &&
        fresh.invite.selectedSlotId === slotId
      ) {
        const serialized = await serializeInviteById(inviteId);
        res.json(serialized);
        return;
      }
      res.status(409).json({
        error: `Invite is already ${fresh?.invite.status ?? "changed"}`,
      });
      return;
    }

    const serialized = await serializeInviteById(inviteId);
    res.json(serialized);
  } catch (err) {
    req.log.error({ err }, "accept invite failed");
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

/**
 * POST /api/interview-invites/:id/decline
 * Candidate declines the whole invite (optional reason).
 */
router.post("/interview-invites/:id/decline", requireAuth, async (req, res) => {
  try {
    const inviteId = Number(req.params.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      res.status(400).json({ error: "Invalid invite id" });
      return;
    }
    const body = (req.body ?? {}) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    const ctx = await loadInviteContext(inviteId);
    if (!ctx) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const user = req.currentUser!;
    if (!isCandidateForApplication(user, ctx.candidate.id)) {
      res
        .status(403)
        .json({ error: "Only the invited candidate can decline" });
      return;
    }
    // Idempotency: already declined → return current state; other
    // terminal states are conflicts.
    if (ctx.invite.status === "declined") {
      const serialized = await serializeInviteById(inviteId);
      res.json(serialized);
      return;
    }
    if (ctx.invite.status !== "proposed") {
      res
        .status(409)
        .json({ error: `Invite is already ${ctx.invite.status}` });
      return;
    }

    const flipResult = await db.transaction(async (tx) => {
      const flipped = await tx
        .update(interviewInvitesTable)
        .set({
          status: "declined",
          declineReason: reason,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(interviewInvitesTable.id, inviteId),
            eq(interviewInvitesTable.status, "proposed"),
          ),
        )
        .returning({ id: interviewInvitesTable.id });
      if (flipped.length === 0) return false;

      if (ctx.invite.createdByUserId !== null) {
        await tx.insert(notificationsTable).values({
          userId: ctx.invite.createdByUserId,
          kind: "interview_declined",
          title: "Interview declined",
          body: reason
            ? `${ctx.candidate.fullName} declined the interview for "${ctx.job.title}": ${reason}`
            : `${ctx.candidate.fullName} declined the interview for "${ctx.job.title}".`,
          link: `/interviews/${inviteId}`,
        });
      }
      return true;
    });

    if (!flipResult) {
      const fresh = await loadInviteContext(inviteId);
      if (fresh?.invite.status === "declined") {
        const serialized = await serializeInviteById(inviteId);
        res.json(serialized);
        return;
      }
      res.status(409).json({
        error: `Invite is already ${fresh?.invite.status ?? "changed"}`,
      });
      return;
    }

    const serialized = await serializeInviteById(inviteId);
    res.json(serialized);
  } catch (err) {
    req.log.error({ err }, "decline invite failed");
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

/**
 * POST /api/interview-invites/:id/cancel
 * Employer pulls the invite back. Allowed while the invite is still
 * in the proposed state.
 */
router.post("/interview-invites/:id/cancel", requireAuth, async (req, res) => {
  try {
    const inviteId = Number(req.params.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      res.status(400).json({ error: "Invalid invite id" });
      return;
    }
    const ctx = await loadInviteContext(inviteId);
    if (!ctx) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const user = req.currentUser!;
    const isEmployerOwner = isEmployerForApplication(user, ctx.employer.id);
    const isAdmin = user.role === "admin";
    if (!isEmployerOwner && !isAdmin) {
      res
        .status(403)
        .json({ error: "Only the inviting employer can cancel" });
      return;
    }
    // Idempotency: already cancelled → return current state; other
    // terminal states (accepted/declined) are conflicts.
    if (ctx.invite.status === "cancelled") {
      const serialized = await serializeInviteById(inviteId);
      res.json(serialized);
      return;
    }
    if (ctx.invite.status !== "proposed") {
      res
        .status(409)
        .json({ error: `Cannot cancel a ${ctx.invite.status} invite` });
      return;
    }

    const flipResult = await db.transaction(async (tx) => {
      const flipped = await tx
        .update(interviewInvitesTable)
        .set({ status: "cancelled", respondedAt: new Date() })
        .where(
          and(
            eq(interviewInvitesTable.id, inviteId),
            eq(interviewInvitesTable.status, "proposed"),
          ),
        )
        .returning({ id: interviewInvitesTable.id });
      if (flipped.length === 0) return false;

      // Notify the candidate so the cancellation shows up in their bell.
      const candUserRows = await tx
        .select({ userId: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.candidateId, ctx.candidate.id))
        .limit(1);
      const candidateUserId = candUserRows[0]?.userId;
      if (candidateUserId) {
        await tx.insert(notificationsTable).values({
          userId: candidateUserId,
          kind: "interview_cancelled",
          title: "Interview cancelled",
          body: `The interview invitation for "${ctx.job.title}" was cancelled by the employer.`,
          link: `/interviews/${inviteId}`,
        });
      }
      return true;
    });

    if (!flipResult) {
      const fresh = await loadInviteContext(inviteId);
      if (fresh?.invite.status === "cancelled") {
        const serialized = await serializeInviteById(inviteId);
        res.json(serialized);
        return;
      }
      res.status(409).json({
        error: `Invite is already ${fresh?.invite.status ?? "changed"}`,
      });
      return;
    }

    const serialized = await serializeInviteById(inviteId);
    res.json(serialized);
  } catch (err) {
    req.log.error({ err }, "cancel invite failed");
    res.status(500).json({ error: "Failed to cancel invite" });
  }
});

// Suppress unused-import warning when only certain helpers are exercised.
void inArray;

export default router;
