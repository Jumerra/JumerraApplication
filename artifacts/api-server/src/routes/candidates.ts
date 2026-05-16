import { Router, type IRouter } from "express";
import { eq, and, sql, desc, inArray, ilike, or, gte } from "drizzle-orm";
import {
  db,
  candidatesTable,
  educationTable,
  experienceTable,
  certificationsTable,
  badgesTable,
  jobsTable,
  employersTable,
  usersTable,
} from "@workspace/db";
import {
  ListCandidatesQueryParams,
  CreateCandidateBody,
  GetCandidateParams,
  UpdateCandidateParams,
  UpdateCandidateBody,
  GetCandidateRecommendationsParams,
} from "@workspace/api-zod";
import { calculateMatchScore } from "../lib/matching";
import {
  parseLimit,
  encodeCursor,
  decodeCursor,
  setNextCursor,
} from "../lib/pagination";
import { sweepExpiredJobTiers } from "./job-tier";
import { recordProfileView } from "./profile-views";
import {
  getCandidateIdsForInstitution,
  getInstitutionIdForDepartment,
  getInstitutionLinksByCandidate,
  setCandidateAffiliationDepartment,
  setCandidateInstitutionLinks,
  type InstitutionLink,
} from "../lib/candidate-institutions";
import { requireAdmin, requireAuth } from "../middleware/require-auth";
import {
  getVerifiedSkillsByCandidate,
  getCandidateIdsWithVerifiedSkill,
  getPublicReferencesByCandidate,
  getBackgroundCheckUpdaterName,
  type VerifiedSkillRow,
} from "./trust";

const router: IRouter = Router();

function serializeCandidate(
  c: typeof candidatesTable.$inferSelect,
  institutions: InstitutionLink[],
  verifiedSkills: VerifiedSkillRow[] = [],
  backgroundCheckUpdatedByName: string | null = null,
) {
  const primary = institutions.find((i) => i.isPrimary) ?? institutions[0] ?? null;
  return {
    id: c.id,
    fullName: c.fullName,
    headline: c.headline,
    bio: c.bio,
    location: c.location,
    avatarUrl: c.avatarUrl,
    email: c.email,
    phone: c.phone,
    portfolioUrl: c.portfolioUrl,
    videoIntroUrl: c.videoIntroUrl,
    availability: c.availability,
    yearsExperience: c.yearsExperience,
    talentScore: c.talentScore,
    isBoosted: c.isBoosted,
    boostExpiresAt: c.boostExpiresAt ? c.boostExpiresAt.toISOString() : null,
    openToOffers: c.openToOffers,
    openToOffersSince: c.openToOffersSince
      ? c.openToOffersSince.toISOString()
      : null,
    alumniMentorOptin: c.alumniMentorOptin ?? false,
    allowIntroRequests: c.allowIntroRequests ?? true,
    institutionId: primary?.id ?? c.institutionId ?? null,
    institutionName: primary?.name ?? null,
    institutions: institutions.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      logoUrl: i.logoUrl,
      isPrimary: i.isPrimary,
      isVerified: i.isVerified,
      verifiedByPremium: i.verifiedByPremium,
      verifiedAt: i.verifiedAt,
      verifiedByName: i.verifiedByName,
      departmentId: i.departmentId ?? null,
      departmentName: i.departmentName ?? null,
      facultyId: i.facultyId ?? null,
      facultyName: i.facultyName ?? null,
    })),
    // True when ANY institution has explicitly verified this candidate.
    isVerified: institutions.some((i) => i.isVerified),
    // T5: True when any verifying institution is on Institution Pro.
    // Drives the "Verified by Pro" ribbon on candidate cards and the
    // small tie-breaker bonus inside the matching algorithm.
    verifiedByPremium: institutions.some((i) => i.verifiedByPremium),
    skills: c.skills,
    verifiedSkills: verifiedSkills.map((v) => ({
      id: v.id,
      skill: v.skill,
      institutionId: v.institutionId,
      institutionName: v.institutionName,
      institutionLogoUrl: v.institutionLogoUrl,
      issuedAt: v.issuedAt,
      issuedByName: v.issuedByName,
      note: v.note,
    })),
    backgroundCheck: {
      status: c.backgroundCheckStatus,
      updatedAt: c.backgroundCheckUpdatedAt
        ? c.backgroundCheckUpdatedAt.toISOString()
        : null,
      updatedByName: backgroundCheckUpdatedByName,
    },
    createdAt: c.createdAt.toISOString(),
  };
}

// Resolve employer logo URLs in a single batched query for a list of
// experience rows. Returns a Map keyed by employerId. We do this once per
// response instead of N+1ing the employers table, then use it inside
// serializeExperience below to denormalize `employerLogoUrl` into the
// response.
async function loadEmployerLogos(
  rows: ReadonlyArray<{ employerId: number | null }>,
): Promise<Map<number, string>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.employerId).filter((v): v is number => v != null)),
  );
  if (ids.length === 0) return new Map();
  const employers = await db
    .select({ id: employersTable.id, logoUrl: employersTable.logoUrl })
    .from(employersTable)
    .where(inArray(employersTable.id, ids));
  const m = new Map<number, string>();
  for (const e of employers) m.set(e.id, e.logoUrl);
  return m;
}

function serializeExperience(
  e: typeof experienceTable.$inferSelect,
  logoMap: Map<number, string>,
) {
  return {
    id: e.id,
    employerId: e.employerId,
    employerLogoUrl:
      e.employerId != null ? logoMap.get(e.employerId) ?? null : null,
    company: e.company,
    title: e.title,
    employmentType: e.employmentType,
    location: e.location,
    locationType: e.locationType,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
  };
}

const EXPERIENCE_MAX_ENTRIES = 50;
const EXPERIENCE_TEXT_MAX = 200;
const EXPERIENCE_DESCRIPTION_MAX = 4000;
const EMPLOYMENT_TYPES = new Set([
  "full_time",
  "part_time",
  "self_employed",
  "freelance",
  "contract",
  "internship",
  "apprenticeship",
  "seasonal",
]);
const LOCATION_TYPES = new Set(["on_site", "hybrid", "remote"]);

// Cursor shape for the candidates list. Sort order is
// (isBoosted DESC, talentScore DESC, id DESC) so the cursor must
// encode the boundary on all three columns to ensure stable paging
// across ties.
type CandidatesCursor = {
  b: 0 | 1;
  s: number;
  i: number;
};

router.get("/candidates", async (req, res): Promise<void> => {
  const params = ListCandidatesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const filters = params.data;
  const limit = parseLimit((req.query as { limit?: unknown }).limit);
  const cursor = decodeCursor<CandidatesCursor>(
    (req.query as { cursor?: unknown }).cursor,
  );

  // If filtering by institution, scope candidates to those linked to that
  // institution (primary OR additional affiliation) via the junction table.
  // The two helpers below already issue narrow indexed queries; we keep
  // the intersection in TS but constrain it to the id-set before paging.
  let allowedIds: Set<number> | null = null;
  if (filters.institutionId) {
    const ids = await getCandidateIdsForInstitution(filters.institutionId);
    allowedIds = new Set(ids);
  }
  if (filters.verifiedSkill) {
    const verifiedIds = new Set(
      await getCandidateIdsWithVerifiedSkill(filters.verifiedSkill),
    );
    if (allowedIds) {
      for (const id of allowedIds) if (!verifiedIds.has(id)) allowedIds.delete(id);
    } else {
      allowedIds = verifiedIds;
    }
  }
  // No candidates match the institution/verified-skill prefilter: skip
  // the heavy query entirely.
  if (allowedIds && allowedIds.size === 0) {
    setNextCursor(res, null);
    res.json([]);
    return;
  }

  // Compose all filters as SQL conditions (kills the previous
  // post-query .filter() pass that scanned every candidate row).
  const conditions: ReturnType<typeof eq>[] = [];

  if (allowedIds) {
    conditions.push(inArray(candidatesTable.id, Array.from(allowedIds)));
  }
  if (filters.search) {
    const q = `%${filters.search}%`;
    // skills is a text[]; cast via array_to_string so ILIKE works.
    const skillsBlob = sql<string>`array_to_string(${candidatesTable.skills}, ' ')`;
    const orClause = or(
      ilike(candidatesTable.fullName, q),
      ilike(candidatesTable.headline, q),
      ilike(candidatesTable.bio, q),
      sql`${skillsBlob} ILIKE ${q}`,
    );
    if (orClause) conditions.push(orClause);
  }
  if (filters.location) {
    conditions.push(ilike(candidatesTable.location, `%${filters.location}%`));
  }
  if (filters.skill) {
    // Case-insensitive membership against skills text[].
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM unnest(${candidatesTable.skills}) s
        WHERE lower(s) = lower(${filters.skill})
      )`,
    );
  }
  if (filters.minScore) {
    conditions.push(gte(candidatesTable.talentScore, filters.minScore));
  }
  if (filters.openToOffers === "1") {
    conditions.push(eq(candidatesTable.openToOffers, true));
  }

  // Cursor: keyset where (isBoosted, talentScore, id) is strictly
  // less than the last seen row, in lexicographic order matching the
  // ORDER BY. Postgres ROW comparisons give us exactly this.
  if (cursor) {
    conditions.push(
      sql`(
        (${candidatesTable.isBoosted})::int,
        ${candidatesTable.talentScore},
        ${candidatesTable.id}
      ) < (${cursor.b}, ${cursor.s}, ${cursor.i})`,
    );
  }

  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch limit+1 to detect whether another page exists without a
  // second COUNT query.
  const rows = await db
    .select()
    .from(candidatesTable)
    .where(whereExpr)
    .orderBy(
      desc(candidatesTable.isBoosted),
      desc(candidatesTable.talentScore),
      desc(candidatesTable.id),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const next = hasMore && last
    ? encodeCursor({ b: last.isBoosted ? 1 : 0, s: last.talentScore, i: last.id } satisfies CandidatesCursor)
    : null;
  setNextCursor(res, next);

  const pageIds = page.map((c) => c.id);
  const [linkMap, vMap] = await Promise.all([
    getInstitutionLinksByCandidate(pageIds),
    getVerifiedSkillsByCandidate(pageIds),
  ]);
  res.json(
    page.map((candidate) =>
      serializeCandidate(
        candidate,
        linkMap.get(candidate.id) ?? [],
        vMap.get(candidate.id) ?? [],
      ),
    ),
  );
});

router.post("/candidates", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [created] = await db
    .insert(candidatesTable)
    .values({
      fullName: parsed.data.fullName,
      headline: parsed.data.headline,
      bio: parsed.data.bio,
      location: parsed.data.location,
      email: parsed.data.email,
      phone: parsed.data.phone,
      avatarUrl: parsed.data.avatarUrl ?? `https://i.pravatar.cc/300?u=${encodeURIComponent(parsed.data.email)}`,
      yearsExperience: parsed.data.yearsExperience,
      institutionId: parsed.data.institutionId ?? null,
      skills: parsed.data.skills,
      availability: parsed.data.availability,
      talentScore: 50 + Math.min(parsed.data.yearsExperience * 5, 40),
    })
    .returning();

  // Mirror the primary institution into the junction table.
  await setCandidateInstitutionLinks(created.id, created.institutionId, []);

  const linkMap = await getInstitutionLinksByCandidate([created.id]);
  res.status(201).json(serializeCandidate(created, linkMap.get(created.id) ?? []));
});

router.get("/candidates/:id", async (req, res): Promise<void> => {
  const params = GetCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, params.data.id));

  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Record profile view when an employer user opens a candidate page.
  // Skip when the viewer is the candidate themselves (no spam in their
  // own feed) or an admin (platform-internal review, not recruiter
  // interest). Best-effort: errors are swallowed inside the helper.
  const viewer = req.currentUser;
  if (
    viewer &&
    viewer.role === "employer" &&
    viewer.employerId != null &&
    viewer.candidateId !== candidate.id
  ) {
    void recordProfileView({
      candidateId: candidate.id,
      viewerUserId: viewer.id,
      employerId: viewer.employerId,
      candidateIsBoosted: candidate.isBoosted,
      candidateBoostExpiresAt: candidate.boostExpiresAt,
    });
  }

  const [education, experience, certifications, badges, linkMap] =
    await Promise.all([
      db.select().from(educationTable).where(eq(educationTable.candidateId, params.data.id)),
      db.select().from(experienceTable).where(eq(experienceTable.candidateId, params.data.id)),
      db.select().from(certificationsTable).where(eq(certificationsTable.candidateId, params.data.id)),
      db.select().from(badgesTable).where(eq(badgesTable.candidateId, params.data.id)),
      getInstitutionLinksByCandidate([params.data.id]),
    ]);

  const [expLogoMap, vMap, references, bgUpdaterName] = await Promise.all([
    loadEmployerLogos(experience),
    getVerifiedSkillsByCandidate([candidate.id]),
    getPublicReferencesByCandidate(candidate.id),
    getBackgroundCheckUpdaterName(candidate.backgroundCheckUpdatedBy),
  ]);
  res.json({
    ...serializeCandidate(
      candidate,
      linkMap.get(candidate.id) ?? [],
      vMap.get(candidate.id) ?? [],
      bgUpdaterName,
    ),
    references,
    education: education.map((e) => ({
      id: e.id,
      institution: e.institution,
      degree: e.degree,
      fieldOfStudy: e.fieldOfStudy,
      startYear: e.startYear,
      endYear: e.endYear,
    })),
    experience: experience.map((e) => serializeExperience(e, expLogoMap)),
    certifications: certifications.map((c) => ({
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      issuedAt: c.issuedAt,
    })),
    badges: badges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      tier: b.tier,
    })),
  });
});

router.patch("/candidates/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = req.currentUser!;
  const isAdmin = user.role === "admin";
  const isOwner = user.candidateId === params.data.id;

  if (!isAdmin && !isOwner) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = UpdateCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (!isAdmin) {
    delete updateData.isBoosted;
  }
  // When the candidate flips Open to Offers from off → on we stamp
  // `openToOffersSince` so the UI can show "Open to offers since …"
  // and so we can later surface freshly-open candidates first.
  // Setting it to false leaves the timestamp as a record of when they
  // were last open.
  if (parsed.data.openToOffers === true) {
    const [existing] = await db
      .select({ openToOffers: candidatesTable.openToOffers })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, params.data.id));
    if (existing && !existing.openToOffers) {
      updateData.openToOffersSince = new Date();
    }
  }
  // `affiliations` lives in the junction table; strip it before the
  // candidates UPDATE so drizzle doesn't see an unknown column.
  const affiliationsInput = parsed.data.affiliations;
  delete (updateData as Record<string, unknown>).affiliations;
  // `education` lives in education_entries; strip it before the candidates
  // UPDATE for the same reason. `undefined` means "leave entries alone";
  // an empty array means "clear all entries".
  const educationInput = parsed.data.education;
  delete (updateData as Record<string, unknown>).education;
  // Same pattern for `experience` (lives in experience_entries).
  const experienceInput = parsed.data.experience;
  delete (updateData as Record<string, unknown>).experience;

  // Cross-field validation for education:
  //   - Cap entry count to keep payloads bounded (must mirror the mobile cap).
  //   - Reject text fields that are whitespace-only (Zod's minLength alone
  //     can't see post-trim emptiness).
  //   - endYear (when present) must be >= startYear. Per-year bounds
  //     [1900, 2100] are already enforced by the Zod schema.
  const EDUCATION_MAX_ENTRIES = 50;
  if (educationInput) {
    if (educationInput.length > EDUCATION_MAX_ENTRIES) {
      res.status(400).json({
        error: `Too many education entries (max ${EDUCATION_MAX_ENTRIES}).`,
      });
      return;
    }
    for (const e of educationInput) {
      if (
        e.institution.trim().length === 0 ||
        e.degree.trim().length === 0 ||
        e.fieldOfStudy.trim().length === 0
      ) {
        res.status(400).json({
          error:
            "Education entries require non-empty institution, degree, and field of study.",
        });
        return;
      }
      if (e.endYear != null && e.endYear < e.startYear) {
        res.status(400).json({
          error: `End year (${e.endYear}) cannot be earlier than start year (${e.startYear}) for "${e.institution}".`,
        });
        return;
      }
    }
  }

  // Cross-field validation for work experience:
  //   - Cap entry count to keep payloads bounded (mirrors the mobile cap).
  //   - Reject whitespace-only `title`/`company` (Zod's minLength alone
  //     can't catch post-trim emptiness).
  //   - endDate (when present) must be on or after startDate. A null
  //     endDate means "currently working here" and is allowed.
  //   - employmentType / locationType must be one of the supported enum
  //     values when present.
  //   - When `employerId` is set, the employer must exist; the server
  //     snapshots the employer's current name into `company` (so the
  //     entry stays accurate even if the employer renames later).
  let employerNamesById = new Map<number, string>();
  if (experienceInput) {
    if (experienceInput.length > EXPERIENCE_MAX_ENTRIES) {
      res.status(400).json({
        error: `Too many experience entries (max ${EXPERIENCE_MAX_ENTRIES}).`,
      });
      return;
    }
    for (const e of experienceInput) {
      if (e.title.trim().length === 0) {
        res.status(400).json({
          error: "Experience entries require a non-empty title.",
        });
        return;
      }
      if (e.employerId == null && (e.company == null || e.company.trim().length === 0)) {
        res.status(400).json({
          error:
            "Experience entries require either a company name or an employerId.",
        });
        return;
      }
      if (e.endDate != null && e.endDate < e.startDate) {
        res.status(400).json({
          error: `End date (${e.endDate}) cannot be earlier than start date (${e.startDate}) for "${e.title}".`,
        });
        return;
      }
      if (e.employmentType != null && !EMPLOYMENT_TYPES.has(e.employmentType)) {
        res.status(400).json({
          error: `Invalid employmentType "${e.employmentType}".`,
        });
        return;
      }
      if (e.locationType != null && !LOCATION_TYPES.has(e.locationType)) {
        res.status(400).json({
          error: `Invalid locationType "${e.locationType}".`,
        });
        return;
      }
      if (e.title.length > EXPERIENCE_TEXT_MAX) {
        res.status(400).json({ error: "Title is too long." });
        return;
      }
      if ((e.description ?? "").length > EXPERIENCE_DESCRIPTION_MAX) {
        res.status(400).json({ error: "Description is too long." });
        return;
      }
    }
    // Resolve referenced employerIds in one batch so we can both verify
    // they exist and snapshot the canonical name.
    const employerIds = Array.from(
      new Set(
        experienceInput
          .map((e) => e.employerId)
          .filter((v): v is number => v != null),
      ),
    );
    if (employerIds.length > 0) {
      const rows = await db
        .select({ id: employersTable.id, name: employersTable.name })
        .from(employersTable)
        .where(inArray(employersTable.id, employerIds));
      for (const row of rows) employerNamesById.set(row.id, row.name);
      const missing = employerIds.filter((id) => !employerNamesById.has(id));
      if (missing.length > 0) {
        res.status(400).json({
          error: `Unknown employerId(s): ${missing.join(", ")}.`,
        });
        return;
      }
    }
  }

  // If the request only updates per-affiliation departments (no top-level
  // candidate fields), skip the candidates UPDATE — drizzle would otherwise
  // throw "No values to set". We still need the candidate row to validate
  // existence and to feed the response.
  let updated;
  if (Object.keys(updateData).length > 0) {
    [updated] = await db
      .update(candidatesTable)
      .set(updateData)
      .where(eq(candidatesTable.id, params.data.id))
      .returning();
  } else {
    [updated] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, params.data.id));
  }

  if (!updated) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Mirror avatarUrl to the linked user account so the web profile (which
  // reads users.avatar_url via /auth/me) and the candidate detail page
  // (which reads candidates.avatar_url) stay in lockstep regardless of
  // which surface saved the change.
  if ("avatarUrl" in updateData) {
    await db
      .update(usersTable)
      .set({ avatarUrl: updated.avatarUrl })
      .where(eq(usersTable.candidateId, updated.id));
  }

  // Keep the junction table in sync with the new primary affiliation.
  // Existing additional affiliations are preserved.
  if ("institutionId" in parsed.data) {
    const existing = await getInstitutionLinksByCandidate([updated.id]);
    const additional = (existing.get(updated.id) ?? [])
      .filter((l) => l.id !== updated.institutionId)
      .map((l) => l.id);
    await setCandidateInstitutionLinks(
      updated.id,
      updated.institutionId,
      additional,
    );
  }

  // Per-affiliation department updates. Each entry is upserted; an
  // entry whose institutionId doesn't match an existing affiliation
  // is skipped (the candidate must affiliate first via institutionId).
  if (affiliationsInput && affiliationsInput.length > 0) {
    const linkMap = await getInstitutionLinksByCandidate([updated.id]);
    const linkedIds = new Set(
      (linkMap.get(updated.id) ?? []).map((l) => l.id),
    );
    for (const aff of affiliationsInput) {
      if (!linkedIds.has(aff.institutionId)) continue;
      // Validate dept belongs to that institution if present.
      if (aff.departmentId != null) {
        const owner = await getInstitutionIdForDepartment(aff.departmentId);
        if (owner !== aff.institutionId) {
          res.status(400).json({
            error: `Department ${aff.departmentId} does not belong to institution ${aff.institutionId}`,
          });
          return;
        }
      }
      await setCandidateAffiliationDepartment(
        updated.id,
        aff.institutionId,
        aff.departmentId ?? null,
      );
    }
  }

  // Self-reported education entries: full replacement when the field is
  // present. We delete-then-insert atomically so a partial failure can't
  // leave the candidate with a half-rewritten history.
  if (educationInput) {
    await db.transaction(async (tx) => {
      await tx
        .delete(educationTable)
        .where(eq(educationTable.candidateId, updated.id));
      if (educationInput.length > 0) {
        await tx.insert(educationTable).values(
          educationInput.map((e) => ({
            candidateId: updated.id,
            institution: e.institution.trim(),
            degree: e.degree.trim(),
            fieldOfStudy: e.fieldOfStudy.trim(),
            startYear: e.startYear,
            endYear: e.endYear ?? null,
          })),
        );
      }
    });
  }

  // Self-reported work experience entries: same atomic full-replacement
  // pattern as education. When an entry is linked to an on-platform
  // employer (employerId), we snapshot the canonical employer name into
  // `company` so the entry stays accurate after employer renames.
  if (experienceInput) {
    await db.transaction(async (tx) => {
      await tx
        .delete(experienceTable)
        .where(eq(experienceTable.candidateId, updated.id));
      if (experienceInput.length > 0) {
        await tx.insert(experienceTable).values(
          experienceInput.map((e) => {
            const linkedName =
              e.employerId != null ? employerNamesById.get(e.employerId) : null;
            return {
              candidateId: updated.id,
              employerId: e.employerId ?? null,
              // Prefer the canonical employer name when linked, fall back
              // to whatever the candidate typed for off-platform roles.
              company: (linkedName ?? e.company ?? "").trim(),
              title: e.title.trim(),
              employmentType: e.employmentType ?? null,
              location: e.location?.trim() || null,
              locationType: e.locationType ?? null,
              description: (e.description ?? "").trim(),
              // Drizzle's pg `date` column wants YYYY-MM-DD strings.
              // The Zod schema coerces incoming values to Date, so we
              // convert back here. .toISOString() returns the UTC date,
              // which is fine since we only care about the date portion.
              startDate:
                e.startDate instanceof Date
                  ? e.startDate.toISOString().slice(0, 10)
                  : (e.startDate as unknown as string),
              endDate:
                e.endDate == null
                  ? null
                  : e.endDate instanceof Date
                    ? e.endDate.toISOString().slice(0, 10)
                    : (e.endDate as unknown as string),
            };
          }),
        );
      }
    });
  }

  // Re-read the full detail so clients seeding the cache from this
  // response see the updated education/affiliations without an extra
  // round-trip. Mirrors the GET /candidates/:id serializer above.
  const [education, experience, certifications, badges, linkMap] =
    await Promise.all([
      db
        .select()
        .from(educationTable)
        .where(eq(educationTable.candidateId, updated.id)),
      db
        .select()
        .from(experienceTable)
        .where(eq(experienceTable.candidateId, updated.id)),
      db
        .select()
        .from(certificationsTable)
        .where(eq(certificationsTable.candidateId, updated.id)),
      db
        .select()
        .from(badgesTable)
        .where(eq(badgesTable.candidateId, updated.id)),
      getInstitutionLinksByCandidate([updated.id]),
    ]);

  const expLogoMap2 = await loadEmployerLogos(experience);
  res.json({
    ...serializeCandidate(updated, linkMap.get(updated.id) ?? []),
    education: education.map((e) => ({
      id: e.id,
      institution: e.institution,
      degree: e.degree,
      fieldOfStudy: e.fieldOfStudy,
      startYear: e.startYear,
      endYear: e.endYear,
    })),
    experience: experience.map((e) => serializeExperience(e, expLogoMap2)),
    certifications: certifications.map((c) => ({
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      issuedAt: c.issuedAt,
    })),
    badges: badges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      tier: b.tier,
    })),
  });
});

router.get("/candidates/:id/recommendations", async (req, res): Promise<void> => {
  const params = GetCandidateRecommendationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, params.data.id));

  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Demote any jobs whose paid tier has expired before we read+rank,
  // so a recommendations call never surfaces a stale "sponsored" boost.
  await sweepExpiredJobTiers();

  const jobs = await db
    .select({
      job: jobsTable,
      employer: employersTable,
    })
    .from(jobsTable)
    .leftJoin(employersTable, eq(jobsTable.employerId, employersTable.id));

  const ranked = jobs
    .map(({ job, employer }) => {
      const breakdown = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
      // Paid-tier injection: sponsored gets a strong push to the top of
      // the candidate's feed, promoted gets a meaningful but smaller
      // boost. matchScore is what the UI shows, so we apply the bias
      // additively here so users still see a sensible relevance signal.
      const tier = (job.tier ?? "free") as "free" | "promoted" | "sponsored";
      const tierBias = tier === "sponsored" ? 25 : tier === "promoted" ? 10 : 0;
      return {
        jobId: job.id,
        title: job.title,
        employerName: employer?.name ?? "",
        employerLogoUrl: employer?.logoUrl ?? "",
        location: job.location,
        type: job.type,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        matchScore: Math.min(100, breakdown.score + tierBias),
        matchedSkills: breakdown.matchedSkills,
        matchBreakdown: breakdown,
        tier,
        tierExpiresAt: job.tierExpiresAt
          ? job.tierExpiresAt.toISOString()
          : null,
        fastTrack: Boolean(employer?.fastTrackEnabled),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);

  res.json(ranked);
});

export default router;
