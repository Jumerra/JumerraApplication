import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  applicationEndorsementsTable,
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
import { gte, lt } from "drizzle-orm";
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
      endorsementsThisYear: 0,
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

    // Endorsements issued by this institution against in-scope
    // students within the current academic year. Counted regardless
    // of hire outcome so coordinators can see how active the team is.
    const endorseRows = await db
      .select({
        applicationId: applicationEndorsementsTable.applicationId,
      })
      .from(applicationEndorsementsTable)
      .innerJoin(
        applicationsTable,
        eq(applicationsTable.id, applicationEndorsementsTable.applicationId),
      )
      .where(
        and(
          eq(applicationEndorsementsTable.institutionId, institutionId),
          inArray(applicationsTable.candidateId, studentIds),
          gte(applicationEndorsementsTable.createdAt, ayStart),
          lt(applicationEndorsementsTable.createdAt, ayEnd),
        ),
      );

    res.json({
      institutionId,
      totalStudents: studentIds.length,
      placedStudents,
      placementRate,
      medianTimeToFirstJobDays,
      topEmployers,
      salaryMediansByDepartment,
      placementsLocked: false,
      endorsementsThisYear: endorseRows.length,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /institutions/:id/analytics/employers-leaderboard
//   PUBLIC. Returns the top 10 employers that hired this institution's
//   students during the current academic year (Aug 1 of prior calendar
//   year through Jul 31 of the named year). Counts only verified
//   affiliations and `hired` applications. Subscription-gated like the
//   dashboard: if placements are locked, returns an empty list.
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
// GET /institutions/:id/leaderboard
//   PUBLIC. Cohort placement leaderboard for an institution. Returns
//   aggregate placement stats, top 5 employers, salary bands per role
//   family (job title) with a 3-hire anti-deanonymisation floor, and
//   per-cohort drill-down rows. Honors optional ?year= and
//   ?departmentId= filters.
//
//   Returns 404 when the institution does not exist OR when
//   `publicLeaderboardEnabled` is false, so opt-out behaves like
//   "doesn't exist" for SEO + linking purposes.
// ---------------------------------------------------------------------------
function leaderboardMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function leaderboardPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac);
}

const SALARY_BAND_MIN_HIRES = 3;

router.get(
  "/institutions/:id/leaderboard",
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    if (!Number.isInteger(institutionId) || institutionId <= 0) {
      res.status(400).json({ error: "Invalid institution id" });
      return;
    }
    const yearRaw = req.query.year;
    const departmentIdRaw = req.query.departmentId;
    const year =
      typeof yearRaw === "string" && yearRaw.length > 0
        ? Number(yearRaw)
        : undefined;
    const departmentId =
      typeof departmentIdRaw === "string" && departmentIdRaw.length > 0
        ? Number(departmentIdRaw)
        : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
      res.status(400).json({ error: "Invalid year" });
      return;
    }
    if (departmentId !== undefined && !Number.isInteger(departmentId)) {
      res.status(400).json({ error: "Invalid departmentId" });
      return;
    }

    const [institution] = await db
      .select()
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);
    if (!institution || !institution.publicLeaderboardEnabled) {
      res.status(404).json({ error: "Leaderboard not available" });
      return;
    }

    // Available cohorts for the drill-down picker (always returned).
    const cohortRows = await db
      .select({
        id: candidateCohortsTable.id,
        year: candidateCohortsTable.year,
      })
      .from(candidateCohortsTable)
      .where(eq(candidateCohortsTable.institutionId, institutionId))
      .orderBy(asc(candidateCohortsTable.year));
    const availableYears = cohortRows.map((c) => c.year);

    // Available departments for the drill-down picker.
    const deptRows = await db
      .select({
        id: institutionDepartmentsTable.id,
        name: institutionDepartmentsTable.name,
      })
      .from(institutionDepartmentsTable)
      .where(eq(institutionDepartmentsTable.institutionId, institutionId))
      .orderBy(asc(institutionDepartmentsTable.name));
    const availableDepartments = deptRows.map((d) => ({
      id: d.id,
      name: d.name,
    }));

    // Build the verified-student scope; honor department filter if given.
    const verifiedLinks = await db
      .select({
        candidateId: candidateInstitutionsTable.candidateId,
        departmentId: candidateInstitutionsTable.departmentId,
      })
      .from(candidateInstitutionsTable)
      .where(
        and(
          eq(candidateInstitutionsTable.institutionId, institutionId),
          // verifiedAt IS NOT NULL — placement metrics use verified
          // students only (same rule as analytics/dashboard).
          sql`${candidateInstitutionsTable.verifiedAt} IS NOT NULL`,
        ),
      );

    let scopedCandidateIds = verifiedLinks
      .filter((l) =>
        departmentId === undefined ? true : l.departmentId === departmentId,
      )
      .map((l) => l.candidateId);

    // Cohort-year filter: intersect with cohort membership for that year.
    if (year !== undefined) {
      const [cohort] = cohortRows.filter((c) => c.year === year);
      if (!cohort) {
        scopedCandidateIds = [];
      } else {
        const members = await db
          .select({ candidateId: candidateCohortMembersTable.candidateId })
          .from(candidateCohortMembersTable)
          .where(eq(candidateCohortMembersTable.cohortId, cohort.id));
        const memberSet = new Set(members.map((m) => m.candidateId));
        scopedCandidateIds = scopedCandidateIds.filter((id) =>
          memberSet.has(id),
        );
      }
    }

    const baseResponse = {
      institutionId: institution.id,
      institutionName: institution.name,
      institutionLogoUrl: institution.logoUrl,
      institutionLocation: institution.location,
      institutionType: institution.type,
      totalPlaced: 0,
      totalTracked: scopedCandidateIds.length,
      medianTimeToPlacementDays: 0,
      year: year ?? null,
      departmentId: departmentId ?? null,
      cohorts: [] as Array<{
        year: number;
        totalStudents: number;
        placedStudents: number;
        medianTimeToPlacementDays: number;
      }>,
      topEmployers: [] as Array<{
        employerId: number;
        employerName: string;
        employerLogoUrl: string;
        hires: number;
      }>,
      salaryBandsByRoleFamily: [] as Array<{
        roleFamily: string;
        hires: number;
        currency: string;
        p25: number;
        p50: number;
        p75: number;
      }>,
      availableYears,
      availableDepartments,
    };

    if (scopedCandidateIds.length === 0) {
      res.json(baseResponse);
      return;
    }

    // First-hire row per candidate (across all time for the scope; the
    // year filter has already narrowed candidates by cohort).
    const hireRows = await db
      .select({
        candidateId: applicationsTable.candidateId,
        hiredAt: applicationsTable.updatedAt,
        candidateCreatedAt: candidatesTable.createdAt,
        jobTitle: jobsTable.title,
        salaryMin: jobsTable.salaryMin,
        salaryMax: jobsTable.salaryMax,
        currency: jobsTable.currency,
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
          inArray(applicationsTable.candidateId, scopedCandidateIds),
        ),
      );

    type FirstHire = {
      candidateId: number;
      hiredAt: Date;
      candidateCreatedAt: Date;
      jobTitle: string;
      salary: number | null;
      currency: string;
      employerId: number;
      employerName: string;
      employerLogoUrl: string;
    };
    const firstHire = new Map<number, FirstHire>();
    for (const h of hireRows) {
      const cur = firstHire.get(h.candidateId);
      if (cur && cur.hiredAt <= h.hiredAt) continue;
      const salary = jobMidpointSalary({
        salaryMin: h.salaryMin,
        salaryMax: h.salaryMax,
      });
      firstHire.set(h.candidateId, {
        candidateId: h.candidateId,
        hiredAt: h.hiredAt,
        candidateCreatedAt: h.candidateCreatedAt,
        jobTitle: h.jobTitle,
        salary,
        currency: h.currency,
        employerId: h.employerId,
        employerName: h.employerName,
        employerLogoUrl: h.employerLogoUrl,
      });
    }

    const totalPlaced = firstHire.size;

    // Median time-to-placement (days) across all first hires.
    const ttpDays: number[] = [];
    for (const f of firstHire.values()) {
      const ms = f.hiredAt.getTime() - f.candidateCreatedAt.getTime();
      if (ms > 0) ttpDays.push(Math.round(ms / (1000 * 60 * 60 * 24)));
    }
    const medianTimeToPlacementDays = leaderboardMedian(ttpDays);

    // Top 5 employers.
    const employerCounts = new Map<
      number,
      { name: string; logoUrl: string; hires: number }
    >();
    for (const f of firstHire.values()) {
      const e = employerCounts.get(f.employerId) ?? {
        name: f.employerName,
        logoUrl: f.employerLogoUrl,
        hires: 0,
      };
      e.hires += 1;
      employerCounts.set(f.employerId, e);
    }
    const topEmployers = Array.from(employerCounts.entries())
      .map(([id, v]) => ({
        employerId: id,
        employerName: v.name,
        employerLogoUrl: v.logoUrl,
        hires: v.hires,
      }))
      .sort((a, b) => b.hires - a.hires)
      .slice(0, 5);

    // Salary bands per role family (job title, case-insensitive), with
    // 3-hire anti-deanonymisation floor. Bucket per (family, currency)
    // so we never mix currencies in one band.
    const familyBuckets = new Map<string, number[]>();
    const familyDisplay = new Map<string, { title: string; currency: string }>();
    for (const f of firstHire.values()) {
      if (f.salary == null || f.salary <= 0) continue;
      const cur = (f.currency ?? "USD").toUpperCase();
      const norm = f.jobTitle.trim().toLowerCase();
      if (norm.length === 0) continue;
      const key = `${norm}::${cur}`;
      const list = familyBuckets.get(key) ?? [];
      list.push(f.salary);
      familyBuckets.set(key, list);
      if (!familyDisplay.has(key)) {
        familyDisplay.set(key, { title: f.jobTitle.trim(), currency: cur });
      }
    }
    const salaryBandsByRoleFamily = Array.from(familyBuckets.entries())
      .filter(([, vals]) => vals.length >= SALARY_BAND_MIN_HIRES)
      .map(([key, vals]) => {
        const sorted = vals.slice().sort((a, b) => a - b);
        const meta = familyDisplay.get(key)!;
        return {
          roleFamily: meta.title,
          hires: sorted.length,
          currency: meta.currency,
          p25: leaderboardPercentile(sorted, 0.25),
          p50: leaderboardPercentile(sorted, 0.5),
          p75: leaderboardPercentile(sorted, 0.75),
        };
      })
      .sort((a, b) => b.hires - a.hires);

    // Per-cohort drill-down rows. For each cohort year we compute totals
    // across that cohort's verified members (ignoring the department
    // filter so the cohort summary reflects the whole class).
    const cohorts: Array<{
      year: number;
      totalStudents: number;
      placedStudents: number;
      medianTimeToPlacementDays: number;
    }> = [];
    if (cohortRows.length > 0) {
      const cohortMembers = await db
        .select({
          cohortId: candidateCohortMembersTable.cohortId,
          candidateId: candidateCohortMembersTable.candidateId,
        })
        .from(candidateCohortMembersTable)
        .where(
          inArray(
            candidateCohortMembersTable.cohortId,
            cohortRows.map((c) => c.id),
          ),
        );
      // Cohort drill-down rows must use the SAME scoped candidate set as
      // the top-level KPIs, otherwise a department filter would show a
      // full cohort total against a department-filtered placed count
      // (architect-flagged inconsistency). Build a per-cohort set of
      // verified members that are also in `scopedCandidateIds`.
      const scopedSet = new Set(scopedCandidateIds);
      const membersByCohort = new Map<number, Set<number>>();
      for (const m of cohortMembers) {
        if (!scopedSet.has(m.candidateId)) continue;
        const s = membersByCohort.get(m.cohortId) ?? new Set<number>();
        s.add(m.candidateId);
        membersByCohort.set(m.cohortId, s);
      }
      for (const c of cohortRows) {
        const members = membersByCohort.get(c.id) ?? new Set<number>();
        let placed = 0;
        const days: number[] = [];
        for (const cid of members) {
          const fh = firstHire.get(cid);
          if (fh) {
            placed += 1;
            const ms = fh.hiredAt.getTime() - fh.candidateCreatedAt.getTime();
            if (ms > 0) days.push(Math.round(ms / (1000 * 60 * 60 * 24)));
          }
        }
        cohorts.push({
          year: c.year,
          totalStudents: members.size,
          placedStudents: placed,
          medianTimeToPlacementDays: leaderboardMedian(days),
        });
      }
      cohorts.sort((a, b) => b.year - a.year);
    }

    res.json({
      ...baseResponse,
      totalPlaced,
      medianTimeToPlacementDays,
      cohorts,
      topEmployers,
      salaryBandsByRoleFamily,
    });
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

// GET /institutions/:id/leaderboard.png
//   PUBLIC. Auto-generated 1200x630 share card (Open Graph spec). Used
//   as og:image so social-media unfurlers (LinkedIn, Twitter/X,
//   Facebook, Slack) show a real preview card with the institution's
//   headline placement stat — not just the logo.
//
//   Generated lazily from the same data the JSON endpoint serves and
//   sent as a PNG with a 1-hour public cache (cheap to regen, ok if
//   slightly stale).
function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildShareCardSvg(opts: {
  institutionName: string;
  totalPlaced: number;
  medianDays: number;
  topEmployer: string | null;
}): string {
  const name = escapeSvgText(opts.institutionName);
  const emp = opts.topEmployer
    ? `Top hiring partner: ${escapeSvgText(opts.topEmployer)}`
    : "";
  // Two-line wrap for long institution names. Cheap heuristic: split
  // at the last space before column 28.
  let line1 = name;
  let line2 = "";
  if (name.length > 28) {
    const cut = name.lastIndexOf(" ", 28);
    if (cut > 0) {
      line1 = name.slice(0, cut);
      line2 = name.slice(cut + 1);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#064e3b"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="64" y="64" width="1072" height="502" rx="32" fill="#022c22" fill-opacity="0.35"/>
  <text x="112" y="160" fill="#a7f3d0" font-family="sans-serif" font-size="32" font-weight="600">JUMERRA · PLACEMENT LEADERBOARD</text>
  <text x="112" y="240" fill="#ffffff" font-family="sans-serif" font-size="64" font-weight="700">${line1}</text>
  ${line2 ? `<text x="112" y="320" fill="#ffffff" font-family="sans-serif" font-size="64" font-weight="700">${escapeSvgText(line2)}</text>` : ""}
  <text x="112" y="${line2 ? 420 : 360}" fill="#5eead4" font-family="sans-serif" font-size="180" font-weight="800">${opts.totalPlaced}</text>
  <text x="112" y="${line2 ? 470 : 410}" fill="#a7f3d0" font-family="sans-serif" font-size="36" font-weight="500">students placed</text>
  <text x="112" y="${line2 ? 530 : 480}" fill="#d1fae5" font-family="sans-serif" font-size="30">Median time to placement: ${opts.medianDays} days</text>
  ${emp ? `<text x="112" y="${line2 ? 575 : 525}" fill="#d1fae5" font-family="sans-serif" font-size="28">${emp}</text>` : ""}
</svg>`;
}

router.get(
  "/institutions/:id/leaderboard.png",
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params.id);
    if (!Number.isInteger(institutionId) || institutionId <= 0) {
      res.status(400).json({ error: "Invalid institution id" });
      return;
    }
    const [institution] = await db
      .select()
      .from(institutionsTable)
      .where(eq(institutionsTable.id, institutionId))
      .limit(1);
    if (!institution || !institution.publicLeaderboardEnabled) {
      res.status(404).json({ error: "Leaderboard not available" });
      return;
    }

    // Count placed students (status = "hired") scoped to this institution.
    const candidateIds = await getCandidateIdsForInstitution(institutionId);
    let totalPlaced = 0;
    let medianDays = 0;
    let topEmployer: string | null = null;
    if (candidateIds.length > 0) {
      const placed = await db
        .select({
          appliedAt: applicationsTable.appliedAt,
          updatedAt: applicationsTable.updatedAt,
          employerName: employersTable.name,
        })
        .from(applicationsTable)
        .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
        .innerJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
        .where(
          and(
            eq(applicationsTable.status, "hired"),
            inArray(applicationsTable.candidateId, candidateIds),
          ),
        );
      totalPlaced = placed.length;
      const ttp: number[] = [];
      const empCount = new Map<string, number>();
      for (const p of placed) {
        if (p.appliedAt && p.updatedAt) {
          const days = Math.max(
            0,
            Math.round(
              (p.updatedAt.getTime() - p.appliedAt.getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          );
          ttp.push(days);
        }
        empCount.set(p.employerName, (empCount.get(p.employerName) ?? 0) + 1);
      }
      medianDays = leaderboardMedian(ttp);
      let bestCount = 0;
      for (const [name, c] of empCount) {
        if (c > bestCount) {
          bestCount = c;
          topEmployer = name;
        }
      }
    }

    const svg = buildShareCardSvg({
      institutionName: institution.name,
      totalPlaced,
      medianDays,
      topEmployer,
    });

    try {
      // Lazy-import @resvg/resvg-js so a missing native binary at boot
      // doesn't kill the whole server — if it fails, fall back to the
      // SVG which most platforms (LinkedIn, Slack, Facebook) accept.
      const { Resvg } = await import("@resvg/resvg-js");
      const resvg = new Resvg(svg, {
        background: "#064e3b",
        fitTo: { mode: "width", value: 1200 },
        font: { loadSystemFonts: true },
      });
      const png = resvg.render().asPng();
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(png);
    } catch (err) {
      req.log.warn({ err }, "leaderboard PNG render failed, serving SVG");
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(svg);
    }
  },
);

export default router;
