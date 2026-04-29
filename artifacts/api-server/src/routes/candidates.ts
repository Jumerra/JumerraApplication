import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  db,
  candidatesTable,
  educationTable,
  experienceTable,
  certificationsTable,
  badgesTable,
  jobsTable,
  employersTable,
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
  getCandidateIdsForInstitution,
  getInstitutionIdForDepartment,
  getInstitutionLinksByCandidate,
  setCandidateAffiliationDepartment,
  setCandidateInstitutionLinks,
  type InstitutionLink,
} from "../lib/candidate-institutions";
import { requireAdmin, requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

function serializeCandidate(
  c: typeof candidatesTable.$inferSelect,
  institutions: InstitutionLink[],
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
    institutionId: primary?.id ?? c.institutionId ?? null,
    institutionName: primary?.name ?? null,
    institutions: institutions.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      logoUrl: i.logoUrl,
      isPrimary: i.isPrimary,
      isVerified: i.isVerified,
      verifiedAt: i.verifiedAt,
      verifiedByName: i.verifiedByName,
      departmentId: i.departmentId ?? null,
      departmentName: i.departmentName ?? null,
    })),
    // True when ANY institution has explicitly verified this candidate.
    isVerified: institutions.some((i) => i.isVerified),
    skills: c.skills,
    createdAt: c.createdAt.toISOString(),
  };
}

router.get("/candidates", async (req, res): Promise<void> => {
  const params = ListCandidatesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const filters = params.data;

  // If filtering by institution, scope candidates to those linked to that
  // institution (primary OR additional affiliation) via the junction table.
  let allowedIds: Set<number> | null = null;
  if (filters.institutionId) {
    const ids = await getCandidateIdsForInstitution(filters.institutionId);
    allowedIds = new Set(ids);
  }

  const rows = await db
    .select()
    .from(candidatesTable)
    .orderBy(desc(candidatesTable.isBoosted), desc(candidatesTable.talentScore));

  const filtered = rows.filter((candidate) => {
    if (allowedIds && !allowedIds.has(candidate.id)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const blob = `${candidate.fullName} ${candidate.headline} ${candidate.bio} ${candidate.skills.join(" ")}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (filters.location && !candidate.location.toLowerCase().includes(filters.location.toLowerCase())) {
      return false;
    }
    if (filters.skill) {
      const skillLower = filters.skill.toLowerCase();
      if (!candidate.skills.some((s) => s.toLowerCase() === skillLower)) {
        return false;
      }
    }
    if (filters.minScore && candidate.talentScore < filters.minScore) {
      return false;
    }
    return true;
  });

  const linkMap = await getInstitutionLinksByCandidate(filtered.map((c) => c.id));
  res.json(
    filtered.map((candidate) =>
      serializeCandidate(candidate, linkMap.get(candidate.id) ?? []),
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

  const [education, experience, certifications, badges, linkMap] =
    await Promise.all([
      db.select().from(educationTable).where(eq(educationTable.candidateId, params.data.id)),
      db.select().from(experienceTable).where(eq(experienceTable.candidateId, params.data.id)),
      db.select().from(certificationsTable).where(eq(certificationsTable.candidateId, params.data.id)),
      db.select().from(badgesTable).where(eq(badgesTable.candidateId, params.data.id)),
      getInstitutionLinksByCandidate([params.data.id]),
    ]);

  res.json({
    ...serializeCandidate(candidate, linkMap.get(candidate.id) ?? []),
    education: education.map((e) => ({
      id: e.id,
      institution: e.institution,
      degree: e.degree,
      fieldOfStudy: e.fieldOfStudy,
      startYear: e.startYear,
      endYear: e.endYear,
    })),
    experience: experience.map((e) => ({
      id: e.id,
      company: e.company,
      title: e.title,
      description: e.description,
      startDate: e.startDate,
      endDate: e.endDate,
    })),
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

  const updateData = { ...parsed.data };
  if (!isAdmin) {
    delete (updateData as Record<string, unknown>).isBoosted;
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
    experience: experience.map((e) => ({
      id: e.id,
      company: e.company,
      title: e.title,
      description: e.description,
      startDate: e.startDate,
      endDate: e.endDate,
    })),
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

  const jobs = await db
    .select({
      job: jobsTable,
      employer: employersTable,
    })
    .from(jobsTable)
    .leftJoin(employersTable, eq(jobsTable.employerId, employersTable.id));

  const ranked = jobs
    .map(({ job, employer }) => {
      const { score, matchedSkills } = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
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
        matchScore: score,
        matchedSkills,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);

  res.json(ranked);
});

export default router;
