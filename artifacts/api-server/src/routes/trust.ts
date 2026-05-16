import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  candidateSkillVerificationsTable,
  candidateReferencesTable,
  institutionsTable,
  candidateInstitutionsTable,
  institutionDepartmentsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  IssueSkillVerificationBody,
  RequestReferenceBody,
  SubmitRefereeFormBody,
  AdminSetBackgroundCheckBody,
} from "@workspace/api-zod";
import {
  requireAdmin,
  requireAuth,
  isOrgOwnerOrRegistrar,
} from "../middleware/require-auth";
import { requirePermission, getUserPermissions, isImplicitAllUser } from "../lib/permissions";

const router: IRouter = Router();

const VALID_BACKGROUND_STATUSES = new Set([
  "not_started",
  "in_progress",
  "passed",
  "failed",
]);
const VALID_RELATIONSHIPS = new Set([
  "lecturer",
  "past_employer",
  "colleague",
  "other",
]);

/**
 * Same per-faculty / per-department scoping rule used for affiliation
 * verify/unverify (kept locally to avoid a circular import with
 * routes/institutions.ts). A scoped staffer (dean/HoD) can only act on
 * candidates whose affiliation row falls inside their assignment;
 * owner/registrar/coordinator/viewer get org-wide.
 */
async function canActOnInstitutionCandidate(
  user: typeof usersTable.$inferSelect,
  institutionId: number,
  candidateId: number,
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role !== "institution") return false;
  if (user.institutionId !== institutionId) return false;
  if (isOrgOwnerOrRegistrar(user)) return true;
  // Dean / HoD must have a scope row; a SET NULL clear denies access.
  if (user.orgRole === "dean" && user.assignedFacultyId == null) return false;
  if (user.orgRole === "hod" && user.assignedDepartmentId == null) return false;
  // Coordinator / viewer / etc. without any scope are org-wide.
  if (user.assignedDepartmentId == null && user.assignedFacultyId == null) {
    return true;
  }
  const [link] = await db
    .select({
      departmentId: candidateInstitutionsTable.departmentId,
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
        eq(candidateInstitutionsTable.candidateId, candidateId),
      ),
    )
    .limit(1);
  if (!link) return false;
  if (
    user.assignedDepartmentId != null &&
    link.departmentId === user.assignedDepartmentId
  ) {
    return true;
  }
  if (
    user.assignedFacultyId != null &&
    link.facultyId === user.assignedFacultyId
  ) {
    return true;
  }
  return false;
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(2, local.length - 1))}${domain}`;
}

function serializeOwnReference(
  r: typeof candidateReferencesTable.$inferSelect,
  shareUrl: string | null = null,
) {
  return {
    id: r.id,
    relationship: r.relationship,
    refereeEmailMasked: maskEmail(r.refereeEmail),
    requestedAt: r.requestedAt.toISOString(),
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    submittedRefereeName: r.submittedRefereeName,
    hiddenAt: r.hiddenAt ? r.hiddenAt.toISOString() : null,
    shareUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Skill verifications (institution-issued)
// ─────────────────────────────────────────────────────────────────────

router.post(
  "/institutions/:id/students/:candidateId/skill-verifications",
  requireAuth,
  requirePermission("students:verify"),
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    const candidateId = Number(req.params["candidateId"]);
    if (!Number.isInteger(institutionId) || !Number.isInteger(candidateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (!(await canActOnInstitutionCandidate(me, institutionId, candidateId))) {
      res
        .status(403)
        .json({ error: "Outside your scope or not your institution" });
      return;
    }
    const parsed = IssueSkillVerificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const skill = parsed.data.skill.trim();
    if (skill.length === 0) {
      res.status(400).json({ error: "Skill is required" });
      return;
    }

    // One active verification per (candidate, institution, skill).
    const [existing] = await db
      .select({ id: candidateSkillVerificationsTable.id })
      .from(candidateSkillVerificationsTable)
      .where(
        and(
          eq(candidateSkillVerificationsTable.candidateId, candidateId),
          eq(candidateSkillVerificationsTable.institutionId, institutionId),
          eq(candidateSkillVerificationsTable.skill, skill),
          isNull(candidateSkillVerificationsTable.revokedAt),
        ),
      )
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ error: "This skill is already verified for this student." });
      return;
    }

    const [created] = await db
      .insert(candidateSkillVerificationsTable)
      .values({
        candidateId,
        institutionId,
        skill,
        issuedBy: me.id,
        note: parsed.data.note ?? null,
      })
      .returning();

    const [inst] = await db
      .select({
        name: institutionsTable.name,
        logoUrl: institutionsTable.logoUrl,
      })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);

    // Best-effort notification for the candidate.
    try {
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.candidateId, candidateId))
        .limit(1);
      if (u) {
        await db.insert(notificationsTable).values({
          userId: u.id,
          kind: "skill_verified",
          title: `${inst?.name ?? "Your institution"} verified "${skill}"`,
          body: "This skill is now shown as verified on your profile.",
          link: "/account/profile",
        });
      }
    } catch (err) {
      req.log.error({ err }, "skill_verified notification failed");
    }

    res.status(201).json({
      id: created.id,
      skill: created.skill,
      institutionId: created.institutionId,
      institutionName: inst?.name ?? "",
      institutionLogoUrl: inst?.logoUrl ?? null,
      issuedAt: created.issuedAt.toISOString(),
      issuedByName: me.fullName,
      note: created.note,
    });
  },
);

router.delete(
  "/institutions/:id/students/:candidateId/skill-verifications/:verificationId",
  requireAuth,
  requirePermission("students:verify"),
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    const candidateId = Number(req.params["candidateId"]);
    const verificationId = Number(req.params["verificationId"]);
    if (
      !Number.isInteger(institutionId) ||
      !Number.isInteger(candidateId) ||
      !Number.isInteger(verificationId)
    ) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (!(await canActOnInstitutionCandidate(me, institutionId, candidateId))) {
      res
        .status(403)
        .json({ error: "Outside your scope or not your institution" });
      return;
    }
    const result = await db
      .update(candidateSkillVerificationsTable)
      .set({ revokedAt: new Date(), revokedBy: me.id })
      .where(
        and(
          eq(candidateSkillVerificationsTable.id, verificationId),
          eq(candidateSkillVerificationsTable.candidateId, candidateId),
          eq(candidateSkillVerificationsTable.institutionId, institutionId),
          isNull(candidateSkillVerificationsTable.revokedAt),
        ),
      )
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Verification not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// ─────────────────────────────────────────────────────────────────────
// Reference requests (candidate-initiated, referee-submitted)
// ─────────────────────────────────────────────────────────────────────

function ensureCandidateOwnsOrAdmin(
  user: typeof usersTable.$inferSelect | undefined,
  candidateId: number,
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.candidateId === candidateId;
}

router.post(
  "/candidates/:id/references",
  requireAuth,
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params["id"]);
    if (!Number.isInteger(candidateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!ensureCandidateOwnsOrAdmin(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const parsed = RequestReferenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!VALID_RELATIONSHIPS.has(parsed.data.relationship)) {
      res.status(400).json({ error: "Invalid relationship" });
      return;
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const [created] = await db
      .insert(candidateReferencesTable)
      .values({
        candidateId,
        refereeEmail: parsed.data.refereeEmail.toLowerCase().trim(),
        relationship: parsed.data.relationship,
        token,
      })
      .returning();

    // Build an absolute share URL (the candidate forwards this if email
    // delivery fails). Email integration is stubbed elsewhere.
    const proto =
      req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.protocol;
    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
    const shareUrl = `${proto}://${host}/references/${token}`;
    req.log.info(
      { candidateId, refId: created.id, refereeEmail: created.refereeEmail },
      "reference request created (email stub)",
    );
    res.status(201).json(serializeOwnReference(created, shareUrl));
  },
);

router.get(
  "/candidates/:id/references",
  requireAuth,
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params["id"]);
    if (!Number.isInteger(candidateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!ensureCandidateOwnsOrAdmin(req.currentUser, candidateId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const rows = await db
      .select()
      .from(candidateReferencesTable)
      .where(eq(candidateReferencesTable.candidateId, candidateId))
      .orderBy(desc(candidateReferencesTable.requestedAt));
    res.json(rows.map((r) => serializeOwnReference(r)));
  },
);

router.patch(
  "/candidates/:id/references/:refId/hide",
  requireAuth,
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params["id"]);
    const refId = Number(req.params["refId"]);
    if (!Number.isInteger(candidateId) || !Number.isInteger(refId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    let allowed = ensureCandidateOwnsOrAdmin(me, candidateId);
    // Institution staff may also hide a reference for a candidate
    // affiliated with their institution, subject to the same
    // faculty/department scope that gates verify/unverify. They must
    // additionally hold the `students:verify` permission, since the
    // moderation surface is the same as skill-verification.
    if (!allowed && me.role === "institution" && me.institutionId != null) {
      const canModerate =
        isImplicitAllUser(me) ||
        (await getUserPermissions(me)).has("students:verify");
      const inScope = await canActOnInstitutionCandidate(
        me,
        me.institutionId,
        candidateId,
      );
      allowed = canModerate && inScope;
    }
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await db
      .update(candidateReferencesTable)
      .set({ hiddenAt: new Date(), hiddenBy: me.id })
      .where(
        and(
          eq(candidateReferencesTable.id, refId),
          eq(candidateReferencesTable.candidateId, candidateId),
        ),
      )
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Reference not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// ── Public, token-gated referee endpoints ──
//
// These endpoints are intentionally unauthenticated — the token IS the
// authentication. To resist token-fishing we apply a small in-memory
// rate limit per IP. Single-use is enforced by checking `submittedAt`.

const REFEREE_IP_WINDOW_MS = 60_000;
const REFEREE_IP_MAX = 30;
const refereeIpHits = new Map<string, number[]>();

function checkRefereeRateLimit(ip: string): boolean {
  const now = Date.now();
  const arr = refereeIpHits.get(ip) ?? [];
  const recent = arr.filter((t) => now - t < REFEREE_IP_WINDOW_MS);
  if (recent.length >= REFEREE_IP_MAX) {
    refereeIpHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  refereeIpHits.set(ip, recent);
  return true;
}

router.get("/references/:token", async (req, res): Promise<void> => {
  const token = String(req.params["token"] ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  if (!checkRefereeRateLimit(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  const [row] = await db
    .select({
      ref: candidateReferencesTable,
      candidateName: candidatesTable.fullName,
      candidateHeadline: candidatesTable.headline,
    })
    .from(candidateReferencesTable)
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, candidateReferencesTable.candidateId),
    )
    .where(eq(candidateReferencesTable.token, token))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.json({
    candidateName: row.candidateName,
    candidateHeadline: row.candidateHeadline,
    relationship: row.ref.relationship,
    alreadySubmitted: row.ref.submittedAt != null,
  });
});

router.post("/references/:token", async (req, res): Promise<void> => {
  const token = String(req.params["token"] ?? "");
  if (!token || token.length < 16) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  if (!checkRefereeRateLimit(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  const parsed = SubmitRefereeFormBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Atomic single-use enforcement: the conditional UPDATE only succeeds
  // when submittedAt IS NULL, so racing submitters cannot both claim the
  // token. The non-update path distinguishes "no such token" from
  // "already submitted" with a follow-up read.
  const updated = await db
    .update(candidateReferencesTable)
    .set({
      submittedAt: new Date(),
      submittedRefereeName: parsed.data.refereeName.trim(),
      submittedRefereeRole: parsed.data.refereeRole?.trim() ?? null,
      wouldRehire: parsed.data.wouldRehire ?? null,
      strengths: parsed.data.strengths.trim(),
    })
    .where(
      and(
        eq(candidateReferencesTable.token, token),
        isNull(candidateReferencesTable.submittedAt),
      ),
    )
    .returning();
  if (updated.length === 0) {
    const [existing] = await db
      .select({ id: candidateReferencesTable.id })
      .from(candidateReferencesTable)
      .where(eq(candidateReferencesTable.token, token))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Token not found" });
    } else {
      res.status(409).json({ error: "Already submitted" });
    }
    return;
  }
  const row = updated[0]!;

  // Notify the candidate that their reference came in.
  try {
    const [u] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.candidateId, row.candidateId))
      .limit(1);
    if (u) {
      await db.insert(notificationsTable).values({
        userId: u.id,
        kind: "reference_submitted",
        title: "A reference was submitted for you",
        body: `${parsed.data.refereeName.trim()} has submitted a reference.`,
        link: "/account/profile",
      });
    }
  } catch (err) {
    req.log.error({ err }, "reference_submitted notification failed");
  }

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────
// Admin: background-check status
// ─────────────────────────────────────────────────────────────────────

router.patch(
  "/admin/candidates/:id/background-check",
  requireAdmin,
  requirePermission("candidates:manage"),
  async (req, res): Promise<void> => {
    const candidateId = Number(req.params["id"]);
    if (!Number.isInteger(candidateId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = AdminSetBackgroundCheckBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (!VALID_BACKGROUND_STATUSES.has(parsed.data.status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const me = req.currentUser!;
    const [updated] = await db
      .update(candidatesTable)
      .set({
        backgroundCheckStatus: parsed.data.status,
        backgroundCheckUpdatedAt: new Date(),
        backgroundCheckUpdatedBy: me.id,
      })
      .where(eq(candidatesTable.id, candidateId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({
      status: updated.backgroundCheckStatus,
      updatedAt: updated.backgroundCheckUpdatedAt
        ? updated.backgroundCheckUpdatedAt.toISOString()
        : null,
      updatedByName: me.fullName,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────
// Helpers exported for use by candidate serialization.
// ─────────────────────────────────────────────────────────────────────

export type VerifiedSkillRow = {
  id: number;
  candidateId: number;
  skill: string;
  institutionId: number;
  institutionName: string;
  institutionLogoUrl: string | null;
  issuedAt: string;
  issuedByName: string | null;
  note: string | null;
};

export async function getVerifiedSkillsByCandidate(
  candidateIds: number[],
): Promise<Map<number, VerifiedSkillRow[]>> {
  const map = new Map<number, VerifiedSkillRow[]>();
  if (candidateIds.length === 0) return map;
  const rows = await db
    .select({
      v: candidateSkillVerificationsTable,
      institutionName: institutionsTable.name,
      institutionLogoUrl: institutionsTable.logoUrl,
      issuedByName: usersTable.fullName,
    })
    .from(candidateSkillVerificationsTable)
    .innerJoin(
      institutionsTable,
      eq(institutionsTable.id, candidateSkillVerificationsTable.institutionId),
    )
    .leftJoin(
      usersTable,
      eq(usersTable.id, candidateSkillVerificationsTable.issuedBy),
    )
    .where(
      and(
        inArray(
          candidateSkillVerificationsTable.candidateId,
          candidateIds,
        ),
        isNull(candidateSkillVerificationsTable.revokedAt),
      ),
    );
  for (const r of rows) {
    const list = map.get(r.v.candidateId) ?? [];
    list.push({
      id: r.v.id,
      candidateId: r.v.candidateId,
      skill: r.v.skill,
      institutionId: r.v.institutionId,
      institutionName: r.institutionName,
      institutionLogoUrl: r.institutionLogoUrl,
      issuedAt: r.v.issuedAt.toISOString(),
      issuedByName: r.issuedByName,
      note: r.v.note,
    });
    map.set(r.v.candidateId, list);
  }
  return map;
}

export async function getCandidateIdsWithVerifiedSkill(
  skill: string,
): Promise<number[]> {
  const lower = skill.toLowerCase();
  const rows = await db
    .select({
      candidateId: candidateSkillVerificationsTable.candidateId,
      skill: candidateSkillVerificationsTable.skill,
    })
    .from(candidateSkillVerificationsTable)
    .where(isNull(candidateSkillVerificationsTable.revokedAt));
  const ids = new Set<number>();
  for (const r of rows) {
    if (r.skill.toLowerCase() === lower) ids.add(r.candidateId);
  }
  return Array.from(ids);
}

export async function getPublicReferencesByCandidate(
  candidateId: number,
): Promise<
  Array<{
    id: number;
    relationship: string;
    submittedRefereeName: string;
    submittedRefereeRole: string | null;
    wouldRehire: boolean | null;
    strengths: string;
    submittedAt: string;
  }>
> {
  const rows = await db
    .select()
    .from(candidateReferencesTable)
    .where(eq(candidateReferencesTable.candidateId, candidateId))
    .orderBy(desc(candidateReferencesTable.submittedAt));
  return rows
    .filter((r) => r.submittedAt != null && r.hiddenAt == null)
    .map((r) => ({
      id: r.id,
      relationship: r.relationship,
      submittedRefereeName: r.submittedRefereeName ?? "",
      submittedRefereeRole: r.submittedRefereeRole,
      wouldRehire: r.wouldRehire,
      strengths: r.strengths ?? "",
      submittedAt: r.submittedAt!.toISOString(),
    }));
}

export async function getBackgroundCheckUpdaterName(
  userId: number | null,
): Promise<string | null> {
  if (userId == null) return null;
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.fullName ?? null;
}

export default router;
