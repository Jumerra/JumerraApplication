import { Router, type IRouter } from "express";
import { eq, inArray, sql, desc, and } from "drizzle-orm";
import {
  db,
  candidatesTable,
  employersTable,
  institutionsTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import {
  GetEmployerDashboardParams,
  GetInstitutionDashboardParams,
  GetCandidateDashboardParams,
} from "@workspace/api-zod";
import { calculateMatchScore } from "../lib/matching";
import { getCandidateIdsForInstitution } from "../lib/candidate-institutions";
import { isInstitutionPlacementUnlocked } from "./institution-subscription";

const router: IRouter = Router();

const STATUS_LIST = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];
const JOB_TYPES = ["internship", "part_time", "full_time", "contract", "remote"];

router.get("/dashboard/platform", async (_req, res): Promise<void> => {
  const [
    candidatesCount,
    employersCount,
    institutionsCount,
    jobsCount,
    applicationsCount,
    hiresCount,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(candidatesTable),
    db.select({ count: sql<number>`count(*)::int` }).from(employersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(institutionsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(jobsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(applicationsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(applicationsTable).where(eq(applicationsTable.status, "hired")),
  ]);

  const appsByStatusRaw = await db
    .select({
      status: applicationsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(applicationsTable)
    .groupBy(applicationsTable.status);

  const appsByStatusMap = new Map(appsByStatusRaw.map((r) => [r.status, Number(r.count)]));
  const applicationsByStatus = STATUS_LIST.map((s) => ({ status: s, count: appsByStatusMap.get(s) ?? 0 }));

  const jobsByTypeRaw = await db
    .select({
      type: jobsTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(jobsTable)
    .groupBy(jobsTable.type);
  const jobsByTypeMap = new Map(jobsByTypeRaw.map((r) => [r.type, Number(r.count)]));
  const jobsByType = JOB_TYPES.map((t) => ({ type: t, count: jobsByTypeMap.get(t) ?? 0 }));

  // Synthesize signups trend over 14 days
  const days = 14;
  const today = new Date();
  const signupsTrend: Array<{ date: string; candidates: number; employers: number }> = [];
  const totalCandidates = Number(candidatesCount[0]?.count ?? 0);
  const totalEmployers = Number(employersCount[0]?.count ?? 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const seed = (i * 31) % 7;
    signupsTrend.push({
      date: dateStr,
      candidates: Math.max(0, Math.round((totalCandidates / days) * (0.6 + (seed / 10)))),
      employers: Math.max(0, Math.round((totalEmployers / days) * (0.5 + (seed / 12)))),
    });
  }

  res.json({
    totalCandidates: Number(candidatesCount[0]?.count ?? 0),
    totalEmployers: Number(employersCount[0]?.count ?? 0),
    totalInstitutions: Number(institutionsCount[0]?.count ?? 0),
    totalJobs: Number(jobsCount[0]?.count ?? 0),
    totalApplications: Number(applicationsCount[0]?.count ?? 0),
    totalHires: Number(hiresCount[0]?.count ?? 0),
    applicationsByStatus,
    jobsByType,
    signupsTrend,
  });
});

router.get("/dashboard/employer/:id", async (req, res): Promise<void> => {
  const params = GetEmployerDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [employer] = await db.select().from(employersTable).where(eq(employersTable.id, params.data.id));
  if (!employer) {
    res.status(404).json({ error: "Employer not found" });
    return;
  }

  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.employerId, employer.id));
  const jobIds = jobs.map((j) => j.id);

  let appsByStatus: Array<{ status: string; count: number }> = STATUS_LIST.map((s) => ({ status: s, count: 0 }));
  let totalApplications = 0;
  let interviewsScheduled = 0;
  let hires = 0;
  let avgMatch = 0;
  let recentApplications: Array<typeof applicationsTable.$inferSelect> = [];

  if (jobIds.length > 0) {
    const apps = await db
      .select()
      .from(applicationsTable)
      .where(sql`${applicationsTable.jobId} IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`)
      .orderBy(desc(applicationsTable.appliedAt));

    totalApplications = apps.length;
    interviewsScheduled = apps.filter((a) => a.status === "interview").length;
    hires = apps.filter((a) => a.status === "hired").length;
    avgMatch = apps.length > 0 ? Math.round(apps.reduce((s, a) => s + a.matchScore, 0) / apps.length) : 0;

    const statusCounts = new Map<string, number>();
    for (const a of apps) {
      statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
    }
    appsByStatus = STATUS_LIST.map((s) => ({ status: s, count: statusCounts.get(s) ?? 0 }));
    recentApplications = apps.slice(0, 5);
  }

  // Hydrate recent applications
  const recentSerialized = await Promise.all(
    recentApplications.map(async (a) => {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, a.jobId));
      const [cand] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, a.candidateId));
      return {
        id: a.id,
        jobId: a.jobId,
        jobTitle: job?.title ?? "",
        candidateId: a.candidateId,
        candidateName: cand?.fullName ?? "",
        candidateAvatarUrl: cand?.avatarUrl ?? "",
        employerId: employer.id,
        employerName: employer.name,
        employerLogoUrl: employer.logoUrl,
        status: a.status,
        matchScore: a.matchScore,
        coverNote: a.coverNote,
        appliedAt: a.appliedAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    }),
  );

  // Top jobs by application count
  const jobAppCounts = new Map<number, number>();
  if (jobIds.length > 0) {
    const counts = await db
      .select({
        jobId: applicationsTable.jobId,
        count: sql<number>`count(*)::int`,
      })
      .from(applicationsTable)
      .where(sql`${applicationsTable.jobId} IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`)
      .groupBy(applicationsTable.jobId);
    for (const c of counts) {
      jobAppCounts.set(c.jobId, Number(c.count));
    }
  }
  const topJobs = jobs
    .map((j) => ({
      id: j.id,
      title: j.title,
      employerId: j.employerId,
      employerName: employer.name,
      employerLogoUrl: employer.logoUrl,
      type: j.type,
      location: j.location,
      remote: j.remote,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      currency: j.currency,
      summary: j.summary,
      skills: j.skills,
      featured: j.featured,
      applicationsCount: jobAppCounts.get(j.id) ?? 0,
      postedAt: j.postedAt.toISOString(),
      tier: (j.tier ?? "free") as "free" | "promoted" | "sponsored",
      tierExpiresAt: j.tierExpiresAt ? j.tierExpiresAt.toISOString() : null,
    }))
    .sort((a, b) => b.applicationsCount - a.applicationsCount)
    .slice(0, 5);

  res.json({
    employerId: employer.id,
    employerName: employer.name,
    openJobs: jobs.length,
    totalApplications,
    interviewsScheduled,
    hires,
    averageMatchScore: avgMatch,
    pipelineByStage: appsByStatus,
    topJobs,
    recentApplications: recentSerialized,
  });
});

router.get("/dashboard/institution/:id", async (req, res): Promise<void> => {
  const params = GetInstitutionDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [institution] = await db.select().from(institutionsTable).where(eq(institutionsTable.id, params.data.id));
  if (!institution) {
    res.status(404).json({ error: "Institution not found" });
    return;
  }

  // Tracking metrics use VERIFIED students only — the dashboard reflects
  // candidates the institution has explicitly approved as real students.
  // Unverified pending students are visible on the roster but excluded here.
  const studentIds = await getCandidateIdsForInstitution(institution.id, {
    verifiedOnly: true,
  });
  const students = studentIds.length === 0
    ? []
    : await db
        .select()
        .from(candidatesTable)
        .where(inArray(candidatesTable.id, studentIds));

  let placedStudents = 0;
  let avgSalary = 0;
  let topEmployers: Array<{ employerId: number; employerName: string; employerLogoUrl: string; hires: number }> = [];
  let statusBreakdown: Array<{ status: string; count: number }> = [];
  let recentHires: Array<{
    candidateId: number;
    fullName: string;
    avatarUrl: string;
    headline: string;
    talentScore: number;
    readinessScore: number;
    status: string;
    currentEmployerName: string | null;
    applicationsCount: number;
  }> = [];

  if (studentIds.length > 0) {
    const apps = await db
      .select({
        application: applicationsTable,
        job: jobsTable,
        employer: employersTable,
        candidate: candidatesTable,
      })
      .from(applicationsTable)
      .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
      .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
      .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
      .where(sql`${applicationsTable.candidateId} IN (${sql.join(studentIds.map((id) => sql`${id}`), sql`, `)})`)
      .orderBy(desc(applicationsTable.updatedAt));

    const placedSet = new Set<number>();
    const employerHires = new Map<number, { name: string; logoUrl: string; count: number }>();
    const statusCounts = new Map<string, number>();
    const candidateAppCounts = new Map<number, number>();
    const candidateLastStatus = new Map<number, { status: string; employerName: string | null }>();
    let salarySum = 0;
    let salaryCount = 0;

    for (const row of apps) {
      candidateAppCounts.set(row.application.candidateId, (candidateAppCounts.get(row.application.candidateId) ?? 0) + 1);
      statusCounts.set(row.application.status, (statusCounts.get(row.application.status) ?? 0) + 1);
      const existing = candidateLastStatus.get(row.application.candidateId);
      if (!existing || row.application.status === "hired") {
        candidateLastStatus.set(row.application.candidateId, {
          status: row.application.status,
          employerName: row.application.status === "hired" ? row.employer.name : existing?.employerName ?? null,
        });
      }
      if (row.application.status === "hired") {
        placedSet.add(row.application.candidateId);
        const e = employerHires.get(row.employer.id) ?? { name: row.employer.name, logoUrl: row.employer.logoUrl, count: 0 };
        e.count += 1;
        employerHires.set(row.employer.id, e);
        if (row.job.salaryMin !== null && row.job.salaryMax !== null) {
          salarySum += (row.job.salaryMin + row.job.salaryMax) / 2;
          salaryCount += 1;
        } else if (row.job.salaryMin !== null) {
          salarySum += row.job.salaryMin;
          salaryCount += 1;
        }
      }
    }

    placedStudents = placedSet.size;
    avgSalary = salaryCount > 0 ? Math.round(salarySum / salaryCount) : 0;

    topEmployers = Array.from(employerHires.entries())
      .map(([id, v]) => ({ employerId: id, employerName: v.name, employerLogoUrl: v.logoUrl, hires: v.count }))
      .sort((a, b) => b.hires - a.hires)
      .slice(0, 5);

    statusBreakdown = STATUS_LIST.map((s) => ({ status: s, count: statusCounts.get(s) ?? 0 }));

    const hiresApps = apps.filter((a) => a.application.status === "hired").slice(0, 5);
    recentHires = hiresApps.map((row) => {
      const last = candidateLastStatus.get(row.candidate.id);
      return {
        candidateId: row.candidate.id,
        fullName: row.candidate.fullName,
        avatarUrl: row.candidate.avatarUrl,
        headline: row.candidate.headline,
        talentScore: row.candidate.talentScore,
        readinessScore: Math.min(100, row.candidate.talentScore + row.candidate.skills.length * 2),
        status: "hired",
        currentEmployerName: last?.employerName ?? row.employer.name,
        applicationsCount: candidateAppCounts.get(row.candidate.id) ?? 0,
      };
    });
  } else {
    statusBreakdown = STATUS_LIST.map((s) => ({ status: s, count: 0 }));
  }

  const placementRate = students.length > 0 ? placedStudents / students.length : 0;
  const averageReadiness = students.length > 0
    ? Math.round(students.reduce((s, c) => s + Math.min(100, c.talentScore + c.skills.length * 2), 0) / students.length)
    : 0;

  // Premium yearly subscription gate. We only blank out *placement-
  // specific* signals (recent hires, top employers, status breakdown).
  // Roster size + readiness remain visible so the dashboard isn't a
  // dead empty shell — the locked card surfaces the upsell instead.
  const placementsUnlocked = await isInstitutionPlacementUnlocked(institution.id);
  const placementsLocked = !placementsUnlocked;

  res.json({
    institutionId: institution.id,
    institutionName: institution.name,
    totalStudents: students.length,
    placedStudents: placementsLocked ? 0 : placedStudents,
    placementRate: placementsLocked ? 0 : placementRate,
    averageReadiness,
    averageSalary: placementsLocked ? 0 : avgSalary,
    topEmployers: placementsLocked ? [] : topEmployers,
    statusBreakdown: placementsLocked
      ? STATUS_LIST.map((s) => ({ status: s, count: 0 }))
      : statusBreakdown,
    recentHires: placementsLocked ? [] : recentHires,
    placementsLocked,
  });
});

router.get("/dashboard/candidate/:id", async (req, res): Promise<void> => {
  const params = GetCandidateDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [candidate] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, params.data.id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const apps = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
      employer: employersTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(eq(applicationsTable.candidateId, candidate.id))
    .orderBy(desc(applicationsTable.appliedAt));

  const interviewsCount = apps.filter((a) => a.application.status === "interview").length;
  const offersCount = apps.filter((a) => a.application.status === "offer" || a.application.status === "hired").length;

  const statusCounts = new Map<string, number>();
  for (const a of apps) {
    statusCounts.set(a.application.status, (statusCounts.get(a.application.status) ?? 0) + 1);
  }
  const statusBreakdown = STATUS_LIST.map((s) => ({ status: s, count: statusCounts.get(s) ?? 0 }));

  const recentApplications = apps.slice(0, 5).map((row) => ({
    id: row.application.id,
    jobId: row.job.id,
    jobTitle: row.job.title,
    candidateId: candidate.id,
    candidateName: candidate.fullName,
    candidateAvatarUrl: candidate.avatarUrl,
    employerId: row.employer.id,
    employerName: row.employer.name,
    employerLogoUrl: row.employer.logoUrl,
    status: row.application.status,
    matchScore: row.application.matchScore,
    coverNote: row.application.coverNote,
    appliedAt: row.application.appliedAt.toISOString(),
    updatedAt: row.application.updatedAt.toISOString(),
  }));

  // Recommended jobs
  const allJobs = await db
    .select({
      job: jobsTable,
      employer: employersTable,
    })
    .from(jobsTable)
    .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id));

  const appliedJobIds = new Set(apps.map((a) => a.job.id));
  const recommendedJobs = allJobs
    .filter(({ job }) => !appliedJobIds.has(job.id))
    .map(({ job, employer }) => {
      const breakdown = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
      return {
        jobId: job.id,
        title: job.title,
        employerName: employer.name,
        employerLogoUrl: employer.logoUrl,
        location: job.location,
        type: job.type,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        matchScore: breakdown.score,
        matchedSkills: breakdown.matchedSkills,
        matchBreakdown: breakdown,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);

  // Profile completeness
  let completeness = 0;
  if (candidate.fullName) completeness += 10;
  if (candidate.headline) completeness += 10;
  if (candidate.bio && candidate.bio.length > 50) completeness += 15;
  if (candidate.avatarUrl) completeness += 10;
  if (candidate.skills.length >= 3) completeness += 15;
  if (candidate.yearsExperience > 0) completeness += 10;
  if (candidate.portfolioUrl) completeness += 10;
  if (candidate.videoIntroUrl) completeness += 10;
  if (candidate.location) completeness += 10;

  res.json({
    candidateId: candidate.id,
    fullName: candidate.fullName,
    talentScore: candidate.talentScore,
    profileCompleteness: completeness,
    applicationsCount: apps.length,
    interviewsCount,
    offersCount,
    statusBreakdown,
    recommendedJobs,
    recentApplications,
  });
});

// Reduce a candidate's full name to "First L." so anonymous viewers
// of the public landing-page activity feed do not see identifiable
// names tied to application/hire events.  Authenticated viewers
// still see the full name (and avatar) in the response.
function anonymizeName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "Someone";
  const first = parts[0];
  if (parts.length === 1) return first;
  const last = parts[parts.length - 1];
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const isAuthed = Boolean(req.session?.userId);
  const recentApps = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
      candidate: candidatesTable,
      employer: employersTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .orderBy(desc(applicationsTable.updatedAt))
    .limit(8);

  const recentJobs = await db
    .select({
      job: jobsTable,
      employer: employersTable,
    })
    .from(jobsTable)
    .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .orderBy(desc(jobsTable.postedAt))
    .limit(5);

  const recentCandidates = await db
    .select()
    .from(candidatesTable)
    .orderBy(desc(candidatesTable.createdAt))
    .limit(3);

  const items: Array<{
    id: string;
    type: string;
    title: string;
    subtitle: string;
    avatarUrl: string;
    timestamp: string;
  }> = [];

  for (const r of recentApps) {
    const candidateLabel = isAuthed
      ? r.candidate.fullName
      : anonymizeName(r.candidate.fullName);
    const candidateAvatar = isAuthed ? r.candidate.avatarUrl : "";
    if (r.application.status === "hired") {
      items.push({
        id: `hire-${r.application.id}`,
        type: "hire",
        title: `${candidateLabel} was hired at ${r.employer.name}`,
        subtitle: `For ${r.job.title}`,
        avatarUrl: candidateAvatar,
        timestamp: r.application.updatedAt.toISOString(),
      });
    } else {
      items.push({
        id: `app-${r.application.id}`,
        type: "application",
        title: `${candidateLabel} applied to ${r.job.title}`,
        subtitle: `at ${r.employer.name}`,
        avatarUrl: candidateAvatar,
        timestamp: r.application.appliedAt.toISOString(),
      });
    }
  }
  for (const r of recentJobs) {
    items.push({
      id: `job-${r.job.id}`,
      type: "job_posted",
      title: `${r.employer.name} posted ${r.job.title}`,
      subtitle: `${r.job.location} · ${r.job.type.replace("_", " ")}`,
      avatarUrl: r.employer.logoUrl,
      timestamp: r.job.postedAt.toISOString(),
    });
  }
  for (const c of recentCandidates) {
    items.push({
      id: `cand-${c.id}`,
      type: "candidate_joined",
      title: `${isAuthed ? c.fullName : anonymizeName(c.fullName)} joined the platform`,
      subtitle: isAuthed ? c.headline : "",
      avatarUrl: isAuthed ? c.avatarUrl : "",
      timestamp: c.createdAt.toISOString(),
    });
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json(items.slice(0, 12));
});

router.get("/dashboard/salary-insights", async (_req, res): Promise<void> => {
  const jobs = await db.select().from(jobsTable);

  const byRole = new Map<string, number[]>();
  for (const j of jobs) {
    if (j.salaryMin === null && j.salaryMax === null) continue;
    const mid = j.salaryMin !== null && j.salaryMax !== null
      ? (j.salaryMin + j.salaryMax) / 2
      : (j.salaryMin ?? j.salaryMax ?? 0);
    if (mid <= 0) continue;
    const list = byRole.get(j.title) ?? [];
    list.push(mid);
    byRole.set(j.title, list);
  }

  const insights = Array.from(byRole.entries())
    .map(([role, salaries]) => ({
      role,
      averageSalary: Math.round(salaries.reduce((s, x) => s + x, 0) / salaries.length),
      minSalary: Math.round(Math.min(...salaries)),
      maxSalary: Math.round(Math.max(...salaries)),
      currency: "USD",
      sampleSize: salaries.length,
    }))
    .sort((a, b) => b.averageSalary - a.averageSalary)
    .slice(0, 8);

  res.json(insights);
});

export default router;
