import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  requireMinistry,
  ministryHasScope,
  type MinistryType,
} from "../lib/ministry-scopes";
import type { Ministry } from "@workspace/db";

const router: Router = Router();

/**
 * Ministry oversight dashboard.
 *
 * Every figure returned here is an AGGREGATE — counts, rates, averages.
 * No individual candidate names, emails, phone numbers, or per-row
 * records are ever exposed to a ministry. Sections are gated by the
 * ministry's `dataAccess` allowlist (controlled by the super-admin), so
 * the payload only contains slices the ministry has been granted.
 */

// ---------------------------------------------------------------------------
// Education dashboard sections
// ---------------------------------------------------------------------------

async function eduOverview() {
  const inst = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM institutions WHERE deleted_at IS NULL`,
  );
  const tracked = await db.execute<{ tracked: string; placed: string }>(sql`
    WITH verified AS (
      SELECT DISTINCT ci.candidate_id,
        EXISTS (
          SELECT 1 FROM applications a
          WHERE a.candidate_id = ci.candidate_id AND a.status = 'hired'
        ) AS placed
      FROM candidate_institutions ci
      JOIN candidates c ON c.id = ci.candidate_id AND c.deleted_at IS NULL
      JOIN institutions i ON i.id = ci.institution_id AND i.deleted_at IS NULL
      WHERE ci.verified_at IS NOT NULL
    )
    SELECT COUNT(*)::text AS tracked,
           COUNT(*) FILTER (WHERE placed)::text AS placed
    FROM verified
  `);
  const totalInstitutions = Number(inst.rows[0]?.count ?? 0);
  const trackedStudents = Number(tracked.rows[0]?.tracked ?? 0);
  const placedStudents = Number(tracked.rows[0]?.placed ?? 0);
  return {
    totalInstitutions,
    trackedStudents,
    placedStudents,
    placementRate:
      trackedStudents > 0
        ? Math.round((placedStudents / trackedStudents) * 1000) / 10
        : 0,
  };
}

async function eduInstitutions() {
  const rows = await db.execute<{
    id: number;
    name: string;
    type: string;
    tracked: string;
    placed: string;
    avg_talent: string | null;
  }>(sql`
    WITH verified AS (
      SELECT DISTINCT ci.institution_id, ci.candidate_id, c.talent_score,
        EXISTS (
          SELECT 1 FROM applications a
          WHERE a.candidate_id = ci.candidate_id AND a.status = 'hired'
        ) AS placed
      FROM candidate_institutions ci
      JOIN candidates c ON c.id = ci.candidate_id AND c.deleted_at IS NULL
      WHERE ci.verified_at IS NOT NULL
    )
    SELECT i.id, i.name, i.type,
      COUNT(v.candidate_id)::text AS tracked,
      COUNT(*) FILTER (WHERE v.placed)::text AS placed,
      AVG(v.talent_score) AS avg_talent
    FROM institutions i
    JOIN verified v ON v.institution_id = i.id
    WHERE i.deleted_at IS NULL
    GROUP BY i.id, i.name, i.type
    ORDER BY placed DESC, tracked DESC
    LIMIT 50
  `);
  return rows.rows.map((r) => {
    const tracked = Number(r.tracked);
    const placed = Number(r.placed);
    return {
      institutionId: r.id,
      name: r.name,
      type: r.type,
      trackedStudents: tracked,
      placedStudents: placed,
      placementRate:
        tracked > 0 ? Math.round((placed / tracked) * 1000) / 10 : 0,
      avgTalentScore: r.avg_talent
        ? Math.round(Number(r.avg_talent))
        : null,
    };
  });
}

async function eduTrends() {
  const rows = await db.execute<{ period: Date; hires: string }>(sql`
    SELECT (date_trunc('month', a.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS period,
           COUNT(*)::text AS hires
    FROM applications a
    WHERE a.status = 'hired'
      AND a.updated_at >= now() - interval '12 months'
      AND EXISTS (
        SELECT 1 FROM candidate_institutions ci
        WHERE ci.candidate_id = a.candidate_id AND ci.verified_at IS NOT NULL
      )
    GROUP BY period
    ORDER BY period ASC
  `);
  return rows.rows.map((r) => {
    const d = new Date(r.period);
    return {
      periodStart: d.toISOString(),
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      hires: Number(r.hires),
    };
  });
}

async function eduSkills() {
  const rows = await db.execute<{ skill: string; count: string }>(sql`
    SELECT skill, COUNT(*)::text AS count FROM (
      SELECT DISTINCT ci.candidate_id, unnest(c.skills) AS skill
      FROM candidate_institutions ci
      JOIN candidates c ON c.id = ci.candidate_id AND c.deleted_at IS NULL
      WHERE ci.verified_at IS NOT NULL
    ) s
    WHERE skill <> ''
    GROUP BY skill
    ORDER BY count DESC, skill ASC
    LIMIT 15
  `);
  return rows.rows.map((r) => ({ skill: r.skill, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Labour dashboard sections
// ---------------------------------------------------------------------------

async function labOverview() {
  const r = await db.execute<{
    total_jobs: string;
    total_hires: string;
    active_employers: string;
    total_candidates: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*) FROM jobs WHERE deleted_at IS NULL AND visibility = 'public')::text AS total_jobs,
      (SELECT COUNT(*) FROM applications WHERE status = 'hired')::text AS total_hires,
      (SELECT COUNT(*) FROM employers WHERE deleted_at IS NULL)::text AS active_employers,
      (SELECT COUNT(*) FROM candidates WHERE deleted_at IS NULL)::text AS total_candidates
  `);
  const row = r.rows[0];
  return {
    totalJobs: Number(row?.total_jobs ?? 0),
    totalHires: Number(row?.total_hires ?? 0),
    activeEmployers: Number(row?.active_employers ?? 0),
    totalCandidates: Number(row?.total_candidates ?? 0),
  };
}

async function labJobs() {
  const byMonthRows = await db.execute<{ period: Date; count: string }>(sql`
    SELECT (date_trunc('month', posted_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS period,
           COUNT(*)::text AS count
    FROM jobs
    WHERE deleted_at IS NULL AND posted_at >= now() - interval '12 months'
    GROUP BY period
    ORDER BY period ASC
  `);
  const byTypeRows = await db.execute<{ type: string; count: string }>(sql`
    SELECT type, COUNT(*)::text AS count
    FROM jobs
    WHERE deleted_at IS NULL
    GROUP BY type
    ORDER BY count DESC, type ASC
  `);
  return {
    byMonth: byMonthRows.rows.map((r) => {
      const d = new Date(r.period);
      return {
        periodStart: d.toISOString(),
        label: d.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        count: Number(r.count),
      };
    }),
    byType: byTypeRows.rows.map((r) => ({
      type: r.type,
      count: Number(r.count),
    })),
  };
}

async function labSalary() {
  // Aggregated reported-salary bands. HAVING COUNT(*) >= 3 enforces
  // k-anonymity so no band can be traced to one or two individuals.
  const rows = await db.execute<{
    currency: string;
    employment_type: string;
    count: string;
    avg_salary: string;
    min_salary: string;
    max_salary: string;
  }>(sql`
    SELECT a.reported_currency AS currency,
           j.type AS employment_type,
           COUNT(*)::text AS count,
           AVG(a.reported_salary) AS avg_salary,
           MIN(a.reported_salary)::text AS min_salary,
           MAX(a.reported_salary)::text AS max_salary
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.reported_salary IS NOT NULL AND a.reported_currency IS NOT NULL
    GROUP BY currency, employment_type
    HAVING COUNT(*) >= 3
    ORDER BY count DESC
  `);
  return rows.rows.map((r) => ({
    currency: r.currency,
    employmentType: r.employment_type,
    count: Number(r.count),
    avgSalary: Math.round(Number(r.avg_salary)),
    minSalary: Number(r.min_salary),
    maxSalary: Number(r.max_salary),
  }));
}

async function labEmployers() {
  const byIndustry = await db.execute<{ industry: string; hires: string }>(sql`
    SELECT e.industry, COUNT(*)::text AS hires
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    JOIN employers e ON e.id = j.employer_id AND e.deleted_at IS NULL
    WHERE a.status = 'hired'
    GROUP BY e.industry
    ORDER BY hires DESC, e.industry ASC
    LIMIT 15
  `);
  const topEmployers = await db.execute<{ name: string; hires: string }>(sql`
    SELECT e.name, COUNT(*)::text AS hires
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    JOIN employers e ON e.id = j.employer_id AND e.deleted_at IS NULL
    WHERE a.status = 'hired'
    GROUP BY e.id, e.name
    ORDER BY hires DESC, e.name ASC
    LIMIT 10
  `);
  return {
    byIndustry: byIndustry.rows.map((r) => ({
      industry: r.industry,
      hires: Number(r.hires),
    })),
    topEmployers: topEmployers.rows.map((r) => ({
      name: r.name,
      hires: Number(r.hires),
    })),
  };
}

async function labSkills() {
  const rows = await db.execute<{ skill: string; count: string }>(sql`
    SELECT skill, COUNT(*)::text AS count FROM (
      SELECT unnest(skills) AS skill
      FROM jobs
      WHERE deleted_at IS NULL AND visibility = 'public'
    ) s
    WHERE skill <> ''
    GROUP BY skill
    ORDER BY count DESC, skill ASC
    LIMIT 15
  `);
  return rows.rows.map((r) => ({ skill: r.skill, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/ministry/me
 * The current ministry's profile + granted data-access scopes. Lets the
 * web app render the right sidebar without re-deriving from /auth/me.
 */
router.get("/ministry/me", requireMinistry, (req, res) => {
  const m = req.ministry as Ministry;
  res.json({
    ministry: {
      id: m.id,
      name: m.name,
      type: m.type,
      dataAccess: m.dataAccess,
    },
  });
});

/**
 * GET /api/ministry/dashboard
 * Returns only the sections the ministry's type supports AND has been
 * granted via dataAccess. All values are aggregates.
 */
router.get("/ministry/dashboard", requireMinistry, async (req, res) => {
  try {
    const m = req.ministry as Ministry;
    const type = m.type as MinistryType;
    const sections: Record<string, unknown> = {};

    if (type === "education") {
      if (ministryHasScope(m, "edu:overview"))
        sections["edu:overview"] = await eduOverview();
      if (ministryHasScope(m, "edu:institutions"))
        sections["edu:institutions"] = await eduInstitutions();
      if (ministryHasScope(m, "edu:trends"))
        sections["edu:trends"] = await eduTrends();
      if (ministryHasScope(m, "edu:skills"))
        sections["edu:skills"] = await eduSkills();
    } else if (type === "labour") {
      if (ministryHasScope(m, "lab:overview"))
        sections["lab:overview"] = await labOverview();
      if (ministryHasScope(m, "lab:jobs"))
        sections["lab:jobs"] = await labJobs();
      if (ministryHasScope(m, "lab:salary"))
        sections["lab:salary"] = await labSalary();
      if (ministryHasScope(m, "lab:employers"))
        sections["lab:employers"] = await labEmployers();
      if (ministryHasScope(m, "lab:skills"))
        sections["lab:skills"] = await labSkills();
    }

    res.json({
      ministry: {
        id: m.id,
        name: m.name,
        type: m.type,
        dataAccess: m.dataAccess,
      },
      sections,
    });
  } catch (err) {
    req.log.error({ err }, "ministry dashboard failed");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

export default router;
