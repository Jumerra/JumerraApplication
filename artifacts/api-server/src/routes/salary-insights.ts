import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  jobsTable,
  candidateInstitutionsTable,
} from "@workspace/db";
import { z } from "zod";
import { attachUser } from "../middleware/require-auth";

const router: IRouter = Router();

const Query = z
  .object({
    jobId: z.coerce.number().int().positive().optional(),
    title: z.string().min(2).max(200).optional(),
    currency: z.string().min(2).max(8).optional(),
    institutionId: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.jobId !== undefined || v.title !== undefined, {
    message: "Either jobId or title is required",
  });

const MIN_COHORT = 3;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac);
}

/**
 * Anonymised salary band derived from real hires for the SAME job
 * title as the anchor job, optionally filtered to candidates affiliated
 * with a specific institution. The MIN_COHORT floor (3) prevents
 * deanonymisation; below the floor the endpoint returns 200 with
 * `insufficient: true` (and no percentile data) so the client can show
 * a "Not enough data yet" notice without a magic 204.
 *
 * Public on purpose — appears on the public job-detail page.
 * No PII is ever returned (no candidate or employer identifiers).
 */
router.get("/salary-insights", attachUser, async (req, res): Promise<void> => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { jobId, title, currency, institutionId } = parsed.data;

  // Access controls: only the `jobId`-anchored, no-institutionId variant
  // is fully public (it just mirrors data already advertised on the
  // public job detail page). Any expansion — pre-post `title` probing or
  // institution scoping — requires an authenticated session, which gives
  // us a real principal to rate-limit and audit against.
  const user = req.currentUser;
  if (title !== undefined && jobId === undefined) {
    // Pre-post calibration is an employer/admin workflow.
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (user.role !== "employer" && user.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  if (institutionId !== undefined) {
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    // Restrict institution-scoped aggregates to principals with a
    // legitimate relationship to that institution: admins, employers
    // (legitimate hiring intelligence), institution staff of THAT org,
    // or candidates affiliated with THAT institution. This prevents an
    // arbitrary authenticated candidate from sweeping bands across
    // every school in the platform.
    let allowed =
      user.role === "admin" ||
      user.role === "employer" ||
      (user.role === "institution" && user.institutionId === institutionId);
    if (!allowed && user.role === "candidate") {
      const [aff] = await db
        .select({ id: candidateInstitutionsTable.id })
        .from(candidateInstitutionsTable)
        .where(
          and(
            eq(candidateInstitutionsTable.candidateId, user.id),
            eq(candidateInstitutionsTable.institutionId, institutionId),
          ),
        )
        .limit(1);
      allowed = !!aff;
    }
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  let anchorTitle: string;
  let anchorCurrency: string;
  if (jobId !== undefined) {
    const [anchor] = await db
      .select({ title: jobsTable.title, currency: jobsTable.currency })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
    if (!anchor) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    anchorTitle = anchor.title;
    anchorCurrency = anchor.currency;
  } else {
    anchorTitle = title!;
    anchorCurrency = (currency ?? "USD").toUpperCase();
  }

  // Candidates the institution filter (optional) applies to.
  let cohortCandidateIds: number[] | null = null;
  if (institutionId !== undefined) {
    const rows = await db
      .select({ candidateId: candidateInstitutionsTable.candidateId })
      .from(candidateInstitutionsTable)
      .where(eq(candidateInstitutionsTable.institutionId, institutionId));
    cohortCandidateIds = rows.map((r) => r.candidateId);
    if (cohortCandidateIds.length === 0) {
      res.status(200).json({
        count: 0,
        currency: anchorCurrency,
        scope: "institution",
        insufficient: true,
      });
      return;
    }
  }

  // "Similar role" = same job title (case-insensitive). Pulls only
  // hired apps with a self-reported salary so the band reflects real
  // outcomes, not job-post asking ranges.
  const conditions = [
    eq(applicationsTable.status, "hired"),
    sql`${applicationsTable.reportedSalary} IS NOT NULL`,
    sql`LOWER(${jobsTable.title}) = LOWER(${anchorTitle})`,
  ];
  if (cohortCandidateIds) {
    conditions.push(
      inArray(applicationsTable.candidateId, cohortCandidateIds),
    );
  }

  const rows = await db
    .select({
      salary: applicationsTable.reportedSalary,
      currency: applicationsTable.reportedCurrency,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(and(...conditions));

  // Bucket by currency so we never mix GHS and USD into a single
  // band. Pick the bucket matching the anchor job's currency when
  // present, otherwise the largest bucket.
  const byCurrency = new Map<string, number[]>();
  for (const r of rows) {
    const cur = (r.currency ?? anchorCurrency).toUpperCase();
    const list = byCurrency.get(cur) ?? [];
    if (typeof r.salary === "number" && r.salary > 0) list.push(r.salary);
    byCurrency.set(cur, list);
  }
  let pickedCurrency = anchorCurrency.toUpperCase();
  let salaries: number[] =
    byCurrency.get(pickedCurrency) ?? [];
  if (salaries.length < MIN_COHORT) {
    // Try the dominant bucket as a fallback.
    let best: [string, number[]] | null = null;
    for (const entry of byCurrency.entries()) {
      if (!best || entry[1].length > best[1].length) best = entry;
    }
    if (best && best[1].length > salaries.length) {
      pickedCurrency = best[0];
      salaries = best[1];
    }
  }

  const scope = institutionId !== undefined ? "institution" : "platform";

  if (salaries.length < MIN_COHORT) {
    // Privacy: do NOT disclose sub-threshold counts (1 or 2 hires)
    // because they could be cross-referenced to deanonymise. Always
    // report 0 below the floor.
    res.status(200).json({
      count: 0,
      currency: pickedCurrency,
      scope,
      insufficient: true,
    });
    return;
  }

  salaries.sort((a, b) => a - b);
  res.status(200).json({
    count: salaries.length,
    currency: pickedCurrency,
    scope,
    p25: percentile(salaries, 0.25),
    p50: percentile(salaries, 0.5),
    p75: percentile(salaries, 0.75),
    insufficient: false,
  });
});

export default router;
