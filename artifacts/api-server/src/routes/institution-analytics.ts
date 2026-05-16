import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  applicationsTable,
  candidateCohortMembersTable,
  candidateCohortsTable,
  candidateInstitutionsTable,
  candidatesTable,
  db,
  employersTable,
  institutionDepartmentsTable,
  institutionsTable,
  jobsTable,
} from "@workspace/db";
import { isOrgOwnerOrRegistrar, requireAuth } from "../middleware/require-auth";
import {
  getScopedStudentIds,
  narrowDepartmentScope,
  resolveInstitutionScope,
} from "../lib/institution-scope";
import { isInstitutionPlacementUnlocked } from "./institution-subscription";
import { getCandidateIdsForInstitution } from "../lib/candidate-institutions";

const router: IRouter = Router();

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function jobMidpointSalary(
  job: { salaryMin: number | null; salaryMax: number | null },
): number | null {
  if (job.salaryMin != null && job.salaryMax != null) {
    return (job.salaryMin + job.salaryMax) / 2;
  }
  if (job.salaryMin != null) return job.salaryMin;
  if (job.salaryMax != null) return job.salaryMax;
  return null;
}

/**
 * Current academic year heuristic: northern-hemisphere academic year
 * starts in August. Before August we're still in the previous year's
 * cohort window (e.g. Class of 2026 graduates spring 2026, "current"
 * year from Sep-2025 onwards is 2026). Conservative + good enough for
 * an MVP; institutions can rename via the cohort API if needed.
 */
function currentAcademicYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  return month >= 7 ? year + 1 : year;
}

/**
 * Returns the [start, end) UTC bounds of the current academic year:
 * Aug 1 of (currentAcademicYear-1) through Aug 1 of currentAcademicYear.
 * Used to constrain placement metrics to "this year" as required by
 * the Institution Superpowers spec.
 */
function currentAcademicYearWindow(now: Date = new Date()): {
  start: Date;
  end: Date;
  year: number;
} {
  const year = currentAcademicYear(now);
  const start = new Date(Date.UTC(year - 1, 7, 1)); // Aug 1, prior calendar year
  const end = new Date(Date.UTC(year, 7, 1)); // Aug 1, graduation calendar year
  return { start, end, year };
}

// ---------------------------------------------------------------------------
// GET /institutions/:id/analytics/placement
//   Authenticated; same scope rules as /students. Returns placement
//   summary, top employers, salary medians by department, and median
//   time-to-first-job. Honors optional ?facultyId / ?departmentId
//   filters (only narrows the scope, never widens).
// ---------------------------------------------------------------------------
router.get(
  "/institutions/:id/analytics/placement",
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

    const facultyIdRaw = req.query.facultyId;
    const departmentIdRaw = req.query.departmentId;
    const facultyId =
      typeof facultyIdRaw === "string" && facultyIdRaw.length > 0
        ? Number(facultyIdRaw)
        : undefined;
    const departmentId =
      typeof departmentIdRaw === "string" && departmentIdRaw.length > 0
        ? Number(departmentIdRaw)
        : undefined;
    if (
      (facultyId !== undefined && !Number.isInteger(facultyId)) ||
      (departmentId !== undefined && !Number.isInteger(departmentId))
    ) {
      res.status(400).json({ error: "Invalid filter" });
      return;
    }

    const effectiveDeptIds = await narrowDepartmentScope(
      scope,
      institutionId,
      { facultyId, departmentId },
    );

    const studentIds = await getScopedStudentIds(
      institutionId,
      effectiveDeptIds,
    );

    const placementsUnlocked = await isInstitutionPlacementUnlocked(
      institutionId,
    );
    const placementsLocked = !placementsUnlocked;

    const empty = {
      institutionId,
      totalStudents: studentIds.length,
      placedStudents: 0,
      placementRate: 0,
      medianTimeToFirstJobDays: 0,
      topEmployers: [] as Array<{
        employerId: number;
        employerName: string;
        employerLogoUrl: string;
        hires: number;
      }>,
      salaryMediansByDepartment: [] as Array<{
        departmentId: number | null;
        departmentName: string;
        medianSalary: number;
        hires: number;
      }>,
      placementsLocked,
    };

    if (placementsLocked || studentIds.length === 0) {
      res.json(empty);
      return;
    }

    // Pull hires for our scoped students within the current academic
    // year window, joined to job + employer + the candidate's
    // department for this institution.
    const { start: ayStart, end: ayEnd } = currentAcademicYearWindow();
    const hires = await db
      .select({
        candidateId: applicationsTable.candidateId,
        firstHiredAt: applicationsTable.updatedAt,
        candidateCreatedAt: candidatesTable.createdAt,
        salaryMin: jobsTable.salaryMin,
        salaryMax: jobsTable.salaryMax,
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
      .where(
        and(
          eq(applicationsTable.status, "hired"),
          inArray(applicationsTable.candidateId, studentIds),
        ),
      );

    // Pull each scoped student's department-at-this-institution so we
    // can group salary medians by department.
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
          inArray(candidateInstitutionsTable.candidateId, studentIds),
        ),
      );
    const deptByCandidate = new Map<
      number,
      { id: number | null; name: string }
    >();
    for (const l of links) {
      deptByCandidate.set(l.candidateId, {
        id: l.departmentId,
        name: l.departmentName ?? "Unassigned",
      });
    }

    // Filter to hires in the current academic year window.
    const hiresThisYear = hires.filter(
      (h) => h.firstHiredAt >= ayStart && h.firstHiredAt < ayEnd,
    );

    // Collapse to the FIRST hire per candidate (earliest updatedAt) within
    // the current academic year.
    const firstHire = new Map<
      number,
      {
        firstHiredAt: Date;
        candidateCreatedAt: Date;
        salary: number | null;
        employerId: number;
        employerName: string;
        employerLogoUrl: string;
      }
    >();
    for (const h of hiresThisYear) {
      const cur = firstHire.get(h.candidateId);
      const salary = jobMidpointSalary({
        salaryMin: h.salaryMin,
        salaryMax: h.salaryMax,
      });
      if (!cur || h.firstHiredAt < cur.firstHiredAt) {
        firstHire.set(h.candidateId, {
          firstHiredAt: h.firstHiredAt,
          candidateCreatedAt: h.candidateCreatedAt,
          salary,
          employerId: h.employerId,
          employerName: h.employerName,
          employerLogoUrl: h.employerLogoUrl,
        });
      }
    }

    const placedStudents = firstHire.size;
    const placementRate = placedStudents / studentIds.length;

    // Top 10 employers among first hires (most representative of who
    // is actually hiring this institution's students for their FIRST job).
    const employerCounts = new Map<
      number,
      { name: string; logoUrl: string; hires: number }
    >();
    for (const f of firstHire.values()) {
      const entry = employerCounts.get(f.employerId) ?? {
        name: f.employerName,
        logoUrl: f.employerLogoUrl,
        hires: 0,
      };
      entry.hires += 1;
      employerCounts.set(f.employerId, entry);
    }
    const topEmployers = Array.from(employerCounts.entries())
      .map(([id, v]) => ({
        employerId: id,
        employerName: v.name,
        employerLogoUrl: v.logoUrl,
        hires: v.hires,
      }))
      .sort((a, b) => b.hires - a.hires)
      .slice(0, 10);

    // Salary medians per department.
    const salariesByDept = new Map<
      string,
      {
        deptId: number | null;
        deptName: string;
        salaries: number[];
      }
    >();
    for (const [candidateId, f] of firstHire.entries()) {
      if (f.salary == null) continue;
      const dept = deptByCandidate.get(candidateId) ?? {
        id: null,
        name: "Unassigned",
      };
      const key = dept.id == null ? "null" : String(dept.id);
      const entry = salariesByDept.get(key) ?? {
        deptId: dept.id,
        deptName: dept.name,
        salaries: [],
      };
      entry.salaries.push(f.salary);
      salariesByDept.set(key, entry);
    }
    const salaryMediansByDepartment = Array.from(salariesByDept.values())
      .map((d) => ({
        departmentId: d.deptId,
        departmentName: d.deptName,
        medianSalary: median(d.salaries),
        hires: d.salaries.length,
      }))
      .sort((a, b) => b.medianSalary - a.medianSalary);

    // Median time-to-first-job (days). Uses candidate.createdAt as the
    // proxy "started looking" timestamp — the earliest reliable signal
    // we have without a dedicated graduation date.
    const ttfjDays: number[] = [];
    for (const f of firstHire.values()) {
      const ms = f.firstHiredAt.getTime() - f.candidateCreatedAt.getTime();
      if (ms > 0) ttfjDays.push(Math.round(ms / (1000 * 60 * 60 * 24)));
    }
    const medianTimeToFirstJobDays = median(ttfjDays);

    res.json({
      institutionId,
      totalStudents: studentIds.length,
      placedStudents,
      placementRate,
      medianTimeToFirstJobDays,
      topEmployers,
      salaryMediansByDepartment,
      placementsLocked: false,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /institutions/:id/analytics/employers-leaderboard
//   PUBLIC. Returns the top 10 employers that hired this institution's
//   students this calendar year. Counts only verified affiliations and
//   `hired` applications. Subscription-gated like the dashboard: if
//   placements are locked, returns an empty list.
// ---------------------------------------------------------------------------
router.get(
  "/institutions/:id/analytics/employers-leaderboard",
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    if (!Number.isInteger(institutionId) || institutionId <= 0) {
      res.status(400).json({ error: "Invalid institution id" });
      return;
    }

    const [institution] = await db
      .select({ id: institutionsTable.id })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);
    if (!institution) {
      res.status(404).json({ error: "Institution not found" });
      return;
    }

    const placementsUnlocked = await isInstitutionPlacementUnlocked(
      institutionId,
    );
    if (!placementsUnlocked) {
      res.json({
        year: currentAcademicYearWindow().year,
        employers: [],
      });
      return;
    }

    const { start: ayStart, end: ayEnd, year: academicYear } =
      currentAcademicYearWindow();

    const studentIds = await getCandidateIdsForInstitution(institutionId, {
      verifiedOnly: true,
    });
    if (studentIds.length === 0) {
      res.json({ year: academicYear, employers: [] });
      return;
    }

    const hires = await db
      .select({
        candidateId: applicationsTable.candidateId,
        hiredAt: applicationsTable.updatedAt,
        employerId: employersTable.id,
        employerName: employersTable.name,
        employerLogoUrl: employersTable.logoUrl,
      })
      .from(applicationsTable)
      .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
      .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
      .where(
        and(
          eq(applicationsTable.status, "hired"),
          inArray(applicationsTable.candidateId, studentIds),
        ),
      );

    const counts = new Map<
      number,
      { name: string; logoUrl: string; hires: number }
    >();
    for (const h of hires) {
      if (h.hiredAt < ayStart || h.hiredAt >= ayEnd) continue;
      const entry = counts.get(h.employerId) ?? {
        name: h.employerName,
        logoUrl: h.employerLogoUrl,
        hires: 0,
      };
      entry.hires += 1;
      counts.set(h.employerId, entry);
    }

    const employers = Array.from(counts.entries())
      .map(([id, v]) => ({
        employerId: id,
        employerName: v.name,
        employerLogoUrl: v.logoUrl,
        hires: v.hires,
      }))
      .sort((a, b) => b.hires - a.hires)
      .slice(0, 10);

    res.json({ year: academicYear, employers });
  },
);

// ---------------------------------------------------------------------------
// GET /institutions/:id/cohorts
//   List cohorts for the institution. Auto-creates the current academic
//   year cohort the first time the endpoint is hit so staff always see
//   something to work with.
// ---------------------------------------------------------------------------
router.get(
  "/institutions/:id/cohorts",
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

    const year = currentAcademicYear();
    // Lazy-create the current academic year cohort. ON CONFLICT DO
    // NOTHING via the unique (institutionId, year) index avoids races.
    await db
      .insert(candidateCohortsTable)
      .values({
        institutionId,
        year,
        name: `Class of ${year}`,
      })
      .onConflictDoNothing();

    const cohorts = await db
      .select()
      .from(candidateCohortsTable)
      .where(eq(candidateCohortsTable.institutionId, institutionId))
      .orderBy(asc(candidateCohortsTable.year));

    // Member counts in one query.
    const cohortIds = cohorts.map((c) => c.id);
    const memberCounts = new Map<number, number>();
    if (cohortIds.length > 0) {
      const rows = await db
        .select({
          cohortId: candidateCohortMembersTable.cohortId,
          candidateId: candidateCohortMembersTable.candidateId,
        })
        .from(candidateCohortMembersTable)
        .where(inArray(candidateCohortMembersTable.cohortId, cohortIds));
      for (const r of rows) {
        memberCounts.set(r.cohortId, (memberCounts.get(r.cohortId) ?? 0) + 1);
      }
    }

    res.json(
      cohorts.map((c) => ({
        id: c.id,
        institutionId: c.institutionId,
        year: c.year,
        name: c.name,
        memberCount: memberCounts.get(c.id) ?? 0,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  },
);

// ---------------------------------------------------------------------------
// POST /institutions/:id/cohorts
//   Create a cohort. Owners/registrars/admins only.
// ---------------------------------------------------------------------------
router.post(
  "/institutions/:id/cohorts",
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
    if (!isOrgOwnerOrRegistrar(req.currentUser)) {
      res
        .status(403)
        .json({ error: "Only owners/registrars can create cohorts" });
      return;
    }

    const body = (req.body ?? {}) as { year?: unknown; name?: unknown };
    const year = Number(body.year);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      res.status(400).json({ error: "Invalid year" });
      return;
    }
    if (name.length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    try {
      const [created] = await db
        .insert(candidateCohortsTable)
        .values({ institutionId, year, name })
        .returning();
      res.status(201).json({
        id: created.id,
        institutionId: created.institutionId,
        year: created.year,
        name: created.name,
        memberCount: 0,
        createdAt: created.createdAt.toISOString(),
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res
          .status(409)
          .json({ error: "A cohort for that year already exists" });
        return;
      }
      throw err;
    }
  },
);

async function getCohortOr404(
  institutionId: number,
  cohortId: number,
): Promise<{ id: number; institutionId: number } | null> {
  const [row] = await db
    .select({
      id: candidateCohortsTable.id,
      institutionId: candidateCohortsTable.institutionId,
    })
    .from(candidateCohortsTable)
    .where(eq(candidateCohortsTable.id, cohortId))
    .limit(1);
  if (!row || row.institutionId !== institutionId) return null;
  return row;
}

// ---------------------------------------------------------------------------
// POST /institutions/:id/cohorts/:cohortId/members
//   Add candidates to the cohort. Any institution staff with students:view
//   may tag students (deans/HoDs are limited to candidates within their
//   faculty/department scope). Only verified students of THIS institution
//   can be added; ids outside scope or unverified are silently dropped.
// ---------------------------------------------------------------------------
router.post(
  "/institutions/:id/cohorts/:cohortId/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    const cohortId = Number(req.params.cohortId);
    if (!Number.isInteger(institutionId) || !Number.isInteger(cohortId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const scope = await resolveInstitutionScope(req.currentUser, institutionId);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }

    const cohort = await getCohortOr404(institutionId, cohortId);
    if (!cohort) {
      res.status(404).json({ error: "Cohort not found" });
      return;
    }

    const body = (req.body ?? {}) as { candidateIds?: unknown };
    const requestedIds = Array.isArray(body.candidateIds)
      ? body.candidateIds.filter(
          (v): v is number => typeof v === "number" && Number.isInteger(v),
        )
      : [];
    if (requestedIds.length === 0) {
      res.status(400).json({ error: "candidateIds is required" });
      return;
    }

    // Restrict the addable set to verified students of this institution
    // intersected with the caller's faculty/department scope.
    const effectiveDeptIds = await narrowDepartmentScope(scope, institutionId);
    const allowedIds = new Set(
      await getScopedStudentIds(institutionId, effectiveDeptIds),
    );
    const toInsert = requestedIds.filter((id) => allowedIds.has(id));

    if (toInsert.length === 0) {
      res.json({ added: 0, skipped: requestedIds.length });
      return;
    }

    const result = await db
      .insert(candidateCohortMembersTable)
      .values(toInsert.map((candidateId) => ({ cohortId, candidateId })))
      .onConflictDoNothing()
      .returning({ id: candidateCohortMembersTable.id });

    res.json({
      added: result.length,
      skipped: requestedIds.length - result.length,
    });
  },
);

// ---------------------------------------------------------------------------
// DELETE /institutions/:id/cohorts/:cohortId/members/:candidateId
// ---------------------------------------------------------------------------
router.delete(
  "/institutions/:id/cohorts/:cohortId/members/:candidateId",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    const cohortId = Number(req.params.cohortId);
    const candidateId = Number(req.params.candidateId);
    if (
      !Number.isInteger(institutionId) ||
      !Number.isInteger(cohortId) ||
      !Number.isInteger(candidateId)
    ) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const scope = await resolveInstitutionScope(req.currentUser, institutionId);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }
    const cohort = await getCohortOr404(institutionId, cohortId);
    if (!cohort) {
      res.status(404).json({ error: "Cohort not found" });
      return;
    }

    // Scoped staff can only remove candidates whose affiliation
    // department is within their scope. We check the affiliation
    // *regardless of verification status* so stale memberships (e.g.
    // a previously-verified student whose verification was revoked)
    // can still be cleaned up by staff. Owner-equivalent viewers
    // (orgWide=true) can always remove.
    if (!scope.orgWide) {
      const effectiveDeptIds = await narrowDepartmentScope(
        scope,
        institutionId,
      );
      const [link] = await db
        .select({ departmentId: candidateInstitutionsTable.departmentId })
        .from(candidateInstitutionsTable)
        .where(
          and(
            eq(candidateInstitutionsTable.institutionId, institutionId),
            eq(candidateInstitutionsTable.candidateId, candidateId),
          ),
        )
        .limit(1);
      const inScope =
        link != null &&
        link.departmentId != null &&
        (effectiveDeptIds === null ||
          effectiveDeptIds.includes(link.departmentId));
      if (!inScope) {
        res.status(403).json({ error: "Candidate is outside your scope" });
        return;
      }
    }

    await db
      .delete(candidateCohortMembersTable)
      .where(
        and(
          eq(candidateCohortMembersTable.cohortId, cohortId),
          eq(candidateCohortMembersTable.candidateId, candidateId),
        ),
      );
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// GET /institutions/:id/cohorts/:cohortId/curve
//   Returns a cumulative placement curve: month-by-month cumulative
//   number of cohort members with a `hired` application.
// ---------------------------------------------------------------------------
router.get(
  "/institutions/:id/cohorts/:cohortId/curve",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    const cohortId = Number(req.params.cohortId);
    if (!Number.isInteger(institutionId) || !Number.isInteger(cohortId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const scope = await resolveInstitutionScope(req.currentUser, institutionId);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }

    const [cohort] = await db
      .select()
      .from(candidateCohortsTable)
      .where(eq(candidateCohortsTable.id, cohortId))
      .limit(1);
    if (!cohort || cohort.institutionId !== institutionId) {
      res.status(404).json({ error: "Cohort not found" });
      return;
    }

    const placementsUnlocked = await isInstitutionPlacementUnlocked(
      institutionId,
    );

    const memberRows = await db
      .select({ candidateId: candidateCohortMembersTable.candidateId })
      .from(candidateCohortMembersTable)
      .where(eq(candidateCohortMembersTable.cohortId, cohortId));
    const allMemberIds = memberRows.map((r) => r.candidateId);

    // Apply per-faculty/per-department scope so deans/HoDs only see
    // cohort members within their assigned scope. Owner-equivalent
    // viewers see the full cohort.
    let memberIds = allMemberIds;
    if (!scope.orgWide && allMemberIds.length > 0) {
      const effectiveDeptIds = await narrowDepartmentScope(
        scope,
        institutionId,
      );
      const scopedIds = new Set(
        await getScopedStudentIds(institutionId, effectiveDeptIds),
      );
      memberIds = allMemberIds.filter((id) => scopedIds.has(id));
    }
    const totalMembers = memberIds.length;

    if (!placementsUnlocked || totalMembers === 0) {
      res.json({
        cohortId,
        cohortName: cohort.name,
        cohortYear: cohort.year,
        totalMembers,
        placedMembers: 0,
        points: [] as Array<{
          month: string;
          cumulativePlacements: number;
          cumulativeRate: number;
        }>,
        placementsLocked: !placementsUnlocked,
      });
      return;
    }

    const hires = await db
      .select({
        candidateId: applicationsTable.candidateId,
        hiredAt: applicationsTable.updatedAt,
      })
      .from(applicationsTable)
      .where(
        and(
          eq(applicationsTable.status, "hired"),
          inArray(applicationsTable.candidateId, memberIds),
        ),
      );

    // First hire per member.
    const firstHire = new Map<number, Date>();
    for (const h of hires) {
      const existing = firstHire.get(h.candidateId);
      if (!existing || h.hiredAt < existing) {
        firstHire.set(h.candidateId, h.hiredAt);
      }
    }

    // Bucket into year-months from the cohort's year start through
    // either today or one year past graduation, whichever is later.
    const yearStart = new Date(Date.UTC(cohort.year - 1, 7, 1)); // Aug 1 of prior calendar yr
    const now = new Date();
    const finalEnd = new Date(
      Math.max(
        now.getTime(),
        Date.UTC(cohort.year, 11, 31), // end of graduation calendar year
      ),
    );

    const monthKey = (d: Date): string =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

    const months: string[] = [];
    const cursor = new Date(yearStart);
    while (cursor <= finalEnd) {
      months.push(monthKey(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const placementsByMonth = new Map<string, number>();
    for (const date of firstHire.values()) {
      if (date < yearStart) {
        placementsByMonth.set(
          months[0],
          (placementsByMonth.get(months[0]) ?? 0) + 1,
        );
        continue;
      }
      const k = monthKey(date);
      placementsByMonth.set(k, (placementsByMonth.get(k) ?? 0) + 1);
    }

    const points: Array<{
      month: string;
      cumulativePlacements: number;
      cumulativeRate: number;
    }> = [];
    let cum = 0;
    for (const m of months) {
      cum += placementsByMonth.get(m) ?? 0;
      points.push({
        month: m,
        cumulativePlacements: cum,
        cumulativeRate: cum / totalMembers,
      });
    }

    res.json({
      cohortId,
      cohortName: cohort.name,
      cohortYear: cohort.year,
      totalMembers,
      placedMembers: firstHire.size,
      points,
      placementsLocked: false,
    });
  },
);

export default router;
