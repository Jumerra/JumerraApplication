/**
 * Career constellation aggregation. Task #78.
 *
 * Groups active marketplace jobs by normalized title, derives each role's
 * required-skill set (the most-frequent skills across jobs with that
 * title), then computes the candidate's "distance" — the number of role
 * skills they're still missing.
 *
 * Pure logic (`computeConstellation`) is exported for unit testing; the
 * data-fetching wrapper `buildCareerConstellation` plus a tiny per-
 * candidate in-process cache live below it.
 */

import { and, eq, gte, isNull, or } from "drizzle-orm";
import { candidatesTable, db, jobsTable, employersTable } from "@workspace/db";

export type ConstellationJobSample = {
  jobId: number;
  title: string;
  employerName: string;
  missingSkills: string[];
};

export type ConstellationRole = {
  /** Canonical (Title Case) job title, e.g. "Software Engineer". */
  title: string;
  /** How many published jobs were aggregated under this title. */
  jobCount: number;
  /** The role's required-skill set (top frequent across these jobs). */
  requiredSkills: string[];
  /** Subset of requiredSkills the candidate already has. */
  matchedSkills: string[];
  /** Subset of requiredSkills the candidate is missing. */
  missingSkills: string[];
  /** missingSkills.length — 0 means they fully qualify. */
  distance: number;
  /** Up to 3 example jobs for this role, used by the role-detail panel. */
  sampleJobs: ConstellationJobSample[];
};

export type CareerConstellation = {
  candidateSkills: string[];
  roles: ConstellationRole[];
  generatedAt: string;
};

type JobRow = {
  id: number;
  title: string;
  skills: string[];
  employerName: string;
};

const MAX_DISTANCE = 2;
const MAX_ROLES = 24;
const MAX_REQUIRED_PER_ROLE = 8;
const MAX_SAMPLES_PER_ROLE = 3;

function normalizeTitle(raw: string): string {
  // Lowercase, collapse whitespace, strip seniority suffixes so
  // "Senior Software Engineer" and "Software Engineer II" land in the
  // same role bucket. Conservative — only trims the obvious noise.
  let t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  t = t.replace(
    /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|intern|trainee|entry[- ]level|mid[- ]level|i{1,3}|iv)\b/g,
    " ",
  );
  t = t.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  return t || raw.trim().toLowerCase();
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pure distance-computation core. Exposed for unit testing.
 *
 * @param jobs       Active marketplace jobs.
 * @param candidateSkills The candidate's current skills array.
 */
export function computeConstellation(
  jobs: readonly JobRow[],
  candidateSkills: readonly string[],
): CareerConstellation {
  const candidateSet = new Set(
    candidateSkills.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );

  // Group jobs by normalized title.
  const buckets = new Map<
    string,
    {
      titleOriginal: string;
      jobs: JobRow[];
      skillCounts: Map<string, { display: string; count: number }>;
    }
  >();

  for (const job of jobs) {
    const key = normalizeTitle(job.title);
    if (!key) continue;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        titleOriginal: titleCase(key),
        jobs: [],
        skillCounts: new Map(),
      };
      buckets.set(key, bucket);
    }
    bucket.jobs.push(job);
    for (const raw of job.skills) {
      const skill = raw.trim();
      if (!skill) continue;
      const lower = skill.toLowerCase();
      const existing = bucket.skillCounts.get(lower);
      if (existing) {
        existing.count += 1;
      } else {
        bucket.skillCounts.set(lower, { display: skill, count: 1 });
      }
    }
  }

  const roles: ConstellationRole[] = [];
  for (const [, bucket] of buckets) {
    // A role's required-skill set = top-N most frequent skills across
    // the jobs grouped under that title. Tie-break alphabetically for
    // deterministic output (helps tests + caching).
    const ranked = [...bucket.skillCounts.entries()]
      .sort((a, b) => {
        if (b[1].count !== a[1].count) return b[1].count - a[1].count;
        return a[0].localeCompare(b[0]);
      })
      .slice(0, MAX_REQUIRED_PER_ROLE);

    if (ranked.length === 0) continue;

    const requiredSkills = ranked.map(([, v]) => v.display);
    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];
    for (const skill of requiredSkills) {
      if (candidateSet.has(skill.toLowerCase())) matchedSkills.push(skill);
      else missingSkills.push(skill);
    }

    const distance = missingSkills.length;
    if (distance > MAX_DISTANCE) continue;

    // Pick up to N sample jobs that best fit this role, preferring jobs
    // whose own skill list covers the most of the role's missing skills
    // so the click-through "examples" feel concrete.
    const sampleJobs: ConstellationJobSample[] = bucket.jobs
      .map((j) => {
        const jobSet = new Set(j.skills.map((s) => s.toLowerCase()));
        const jobMissing = missingSkills.filter((s) =>
          jobSet.has(s.toLowerCase()),
        );
        return {
          jobId: j.id,
          title: j.title,
          employerName: j.employerName,
          missingSkills: jobMissing,
        };
      })
      .sort((a, b) => b.missingSkills.length - a.missingSkills.length)
      .slice(0, MAX_SAMPLES_PER_ROLE);

    roles.push({
      title: bucket.titleOriginal,
      jobCount: bucket.jobs.length,
      requiredSkills,
      matchedSkills,
      missingSkills,
      distance,
      sampleJobs,
    });
  }

  // Sort by distance asc, then by job count desc (more popular roles
  // first within the same distance bucket).
  roles.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (b.jobCount !== a.jobCount) return b.jobCount - a.jobCount;
    return a.title.localeCompare(b.title);
  });

  return {
    candidateSkills: [...candidateSet],
    roles: roles.slice(0, MAX_ROLES),
    generatedAt: new Date().toISOString(),
  };
}

// Per-candidate cache keyed by a hash of the candidate's skills set so
// it invalidates automatically whenever the candidate edits their
// profile skills. TTL bounds staleness when jobs change.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<
  number,
  { hash: string; expiresAt: number; value: CareerConstellation }
>();

function skillsHash(skills: readonly string[]): string {
  return [...skills].map((s) => s.trim().toLowerCase()).sort().join("|");
}

/** Drop the cached constellation for a candidate (e.g. on skills edit). */
export function invalidateConstellationCache(candidateId: number): void {
  cache.delete(candidateId);
}

export async function buildCareerConstellation(
  candidateId: number,
): Promise<CareerConstellation> {
  const [candidate] = await db
    .select({ id: candidatesTable.id, skills: candidatesTable.skills })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId));

  const skills = candidate?.skills ?? [];
  const hash = skillsHash(skills);
  const now = Date.now();
  const hit = cache.get(candidateId);
  if (hit && hit.hash === hash && hit.expiresAt > now) {
    return hit.value;
  }

  const rows = await db
    .select({
      id: jobsTable.id,
      title: jobsTable.title,
      skills: jobsTable.skills,
      employerName: employersTable.name,
      tier: jobsTable.tier,
      tierExpiresAt: jobsTable.tierExpiresAt,
    })
    .from(jobsTable)
    .leftJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(
      and(
        eq(jobsTable.visibility, "public"),
        // Treat a job as "active" if it's free OR its paid tier has
        // not yet expired. Matches what /jobs lists publicly.
        or(
          eq(jobsTable.tier, "free"),
          isNull(jobsTable.tierExpiresAt),
          gte(jobsTable.tierExpiresAt, new Date()),
        ),
      ),
    );

  const jobs: JobRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    skills: r.skills,
    employerName: r.employerName ?? "",
  }));

  const value = computeConstellation(jobs, skills);
  cache.set(candidateId, { hash, expiresAt: now + CACHE_TTL_MS, value });
  return value;
}
