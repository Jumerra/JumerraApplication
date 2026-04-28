import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  db,
  candidatesTable,
  institutionsTable,
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

const router: IRouter = Router();

function serializeCandidate(c: typeof candidatesTable.$inferSelect, institutionName: string | null) {
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
    institutionId: c.institutionId,
    institutionName,
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

  const rows = await db
    .select({
      candidate: candidatesTable,
      institutionName: institutionsTable.name,
    })
    .from(candidatesTable)
    .leftJoin(
      institutionsTable,
      eq(candidatesTable.institutionId, institutionsTable.id),
    )
    .orderBy(desc(candidatesTable.isBoosted), desc(candidatesTable.talentScore));

  const filters = params.data;
  const filtered = rows.filter(({ candidate }) => {
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
    if (filters.institutionId && candidate.institutionId !== filters.institutionId) {
      return false;
    }
    if (filters.minScore && candidate.talentScore < filters.minScore) {
      return false;
    }
    return true;
  });

  res.json(filtered.map(({ candidate, institutionName }) => serializeCandidate(candidate, institutionName)));
});

router.post("/candidates", async (req, res): Promise<void> => {
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

  let institutionName: string | null = null;
  if (created.institutionId) {
    const [inst] = await db
      .select({ name: institutionsTable.name })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, created.institutionId));
    institutionName = inst?.name ?? null;
  }

  res.status(201).json(serializeCandidate(created, institutionName));
});

router.get("/candidates/:id", async (req, res): Promise<void> => {
  const params = GetCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({
      candidate: candidatesTable,
      institutionName: institutionsTable.name,
    })
    .from(candidatesTable)
    .leftJoin(institutionsTable, eq(candidatesTable.institutionId, institutionsTable.id))
    .where(eq(candidatesTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const [education, experience, certifications, badges] = await Promise.all([
    db.select().from(educationTable).where(eq(educationTable.candidateId, params.data.id)),
    db.select().from(experienceTable).where(eq(experienceTable.candidateId, params.data.id)),
    db.select().from(certificationsTable).where(eq(certificationsTable.candidateId, params.data.id)),
    db.select().from(badgesTable).where(eq(badgesTable.candidateId, params.data.id)),
  ]);

  res.json({
    ...serializeCandidate(row.candidate, row.institutionName),
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

router.patch("/candidates/:id", async (req, res): Promise<void> => {
  const params = UpdateCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(candidatesTable)
    .set(parsed.data)
    .where(eq(candidatesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  let institutionName: string | null = null;
  if (updated.institutionId) {
    const [inst] = await db
      .select({ name: institutionsTable.name })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, updated.institutionId));
    institutionName = inst?.name ?? null;
  }

  res.json(serializeCandidate(updated, institutionName));
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
