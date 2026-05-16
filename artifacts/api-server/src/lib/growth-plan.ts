/**
 * Candidate growth-plan analyser + re-ping helpers. Task #75.
 *
 * The analyser scans a single candidate's rejected applications in the
 * last 90 days, counts how often each missing skill appeared (using
 * the same matching logic as everywhere else — `calculateMatchScore`),
 * and upserts the top-3 missing skills into `candidate_growth_skills`
 * as "active" rows. Skills the candidate has already dismissed or
 * completed are left alone.
 *
 * The re-ping helper runs after a candidate marks a skill complete:
 * it finds every rejected application in the last 90 days whose job
 * required that skill, then sends one in-app notification per
 * employer-staff user — rate-limited to once per (candidate, employer)
 * per quarter via the `candidate_growth_repings` audit table.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  applicationsTable,
  candidateGrowthRepingsTable,
  candidateGrowthSkillsTable,
  candidatesTable,
  db,
  jobsTable,
  usersTable,
} from "@workspace/db";
import { calculateMatchScore } from "./matching";
import { getGrowthResources } from "./growth-resources";
import { sendNotification } from "./notifier";
import { logger } from "./logger";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SKILLS = 3;

/**
 * Calendar-quarter bucket key, e.g. "2026-Q2".  The DB unique index on
 * (candidate_id, employer_id, quarter_key) uses this as the rate-limit
 * key so an `INSERT … ON CONFLICT DO NOTHING` atomically enforces the
 * "≤1 reping per (candidate,employer) per quarter" rule even under
 * concurrent /complete calls.
 */
function quarterKey(d = new Date()): string {
  const m = d.getUTCMonth();
  return `${d.getUTCFullYear()}-Q${Math.floor(m / 3) + 1}`;
}

/**
 * Sweep one candidate's last-90-days rejections, count missing
 * skills, and upsert top-N actives. Returns the upserted skill list
 * (lowercased) so callers can chain UI refreshes.
 *
 * Cheap enough to call inline on `GET /me/growth-plan` (one indexed
 * read on applications + jobs + an upsert per skill). The route layer
 * gates re-runs to once-per-7-days via the `addedAt` of the newest
 * active row.
 */
export async function refreshGrowthPlan(
  candidateId: number,
): Promise<string[]> {
  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId));
  if (!candidate) return [];

  const since = new Date(Date.now() - NINETY_DAYS_MS);
  const rejectedRows = await db
    .select({
      jobSkills: jobsTable.skills,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(
      and(
        eq(applicationsTable.candidateId, candidateId),
        eq(applicationsTable.status, "rejected"),
        gte(applicationsTable.updatedAt, since),
      ),
    );

  // Count how many rejected jobs required each missing skill. We use
  // the same matching helper everywhere else so "missing" stays
  // consistent with the dashboards / Why-we-matched view.
  const counts = new Map<string, { skill: string; count: number }>();
  for (const row of rejectedRows) {
    const breakdown = calculateMatchScore(
      row.jobSkills,
      candidate.skills,
      candidate.yearsExperience,
      candidate.talentScore,
    );
    for (const missing of breakdown.missingSkills) {
      const key = missing.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { skill: missing, count: 1 });
      }
    }
  }

  if (counts.size === 0) return [];

  // Pull every existing row so we can skip ones the candidate
  // dismissed or already completed.
  const existing = await db
    .select()
    .from(candidateGrowthSkillsTable)
    .where(eq(candidateGrowthSkillsTable.candidateId, candidateId));
  const byKey = new Map(existing.map((r) => [r.skill.toLowerCase(), r]));

  // Rank by frequency desc, then alphabetically for stability. Skip
  // already-dismissed; bump rejectionCount on active rows; keep
  // completed rows untouched (their re-ping job is done).
  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.skill.localeCompare(b.skill),
  );

  const top: { skill: string; count: number }[] = [];
  for (const entry of ranked) {
    if (top.length >= MAX_ACTIVE_SKILLS) break;
    const prev = byKey.get(entry.skill.toLowerCase());
    if (prev && (prev.status === "dismissed" || prev.status === "completed")) {
      continue;
    }
    top.push(entry);
  }

  const upserted: string[] = [];
  for (const entry of top) {
    const pack = getGrowthResources(entry.skill);
    const days = Math.max(7, Math.ceil(pack.totalEstMinutes / 60));
    const targetDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const prev = byKey.get(entry.skill.toLowerCase());
    if (prev) {
      await db
        .update(candidateGrowthSkillsTable)
        .set({
          rejectionCount: entry.count,
          // Keep the existing targetDate if one was already set — the
          // candidate has been working against it. Otherwise set one.
          targetDate: prev.targetDate ?? targetDate,
          status: "active",
        })
        .where(eq(candidateGrowthSkillsTable.id, prev.id));
    } else {
      await db.insert(candidateGrowthSkillsTable).values({
        candidateId,
        skill: entry.skill.toLowerCase(),
        status: "active",
        rejectionCount: entry.count,
        targetDate,
      });
    }
    upserted.push(entry.skill.toLowerCase());
  }
  return upserted;
}

/**
 * After a candidate marks `skill` complete, find their rejected
 * applications in the last 90 days for jobs requiring that skill and
 * notify the employer's staff with a "Now skilled in X" nudge.
 *
 * Rate-limited per (candidate, employer) to one re-ping per quarter
 * (across all skills) via `candidate_growth_repings`.
 */
export async function repingEmployersForCompletedSkill(
  candidateId: number,
  skill: string,
): Promise<{ employersNotified: number }> {
  const skillKey = skill.toLowerCase();
  const since = new Date(Date.now() - NINETY_DAYS_MS);

  const [candidate] = await db
    .select({ id: candidatesTable.id, fullName: candidatesTable.fullName })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId));
  if (!candidate) return { employersNotified: 0 };

  const rows = await db
    .select({
      applicationId: applicationsTable.id,
      employerId: jobsTable.employerId,
      jobId: jobsTable.id,
      jobTitle: jobsTable.title,
      jobSkills: jobsTable.skills,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .where(
      and(
        eq(applicationsTable.candidateId, candidateId),
        eq(applicationsTable.status, "rejected"),
        gte(applicationsTable.updatedAt, since),
      ),
    );

  // Filter to jobs that actually required the skill (case-insensitive).
  const matching = rows.filter((r) =>
    r.jobSkills.some((s) => s.toLowerCase() === skillKey),
  );
  if (matching.length === 0) return { employersNotified: 0 };

  // Keep one application per employer — most recent first via insert
  // order from the select; we just keep the first occurrence of each
  // employerId. That's the application we'll attach the audit row to.
  const perEmployer = new Map<number, (typeof matching)[number]>();
  for (const r of matching) {
    if (!perEmployer.has(r.employerId)) perEmployer.set(r.employerId, r);
  }

  // Atomic claim of the per-quarter slot per employer. Insert-first
  // with ON CONFLICT DO NOTHING so two concurrent /complete calls can
  // never both win the slot. Only the request whose insert returned a
  // row actually sends notifications.
  const qk = quarterKey();
  let notified = 0;
  for (const [employerId, app] of perEmployer.entries()) {
    const claimed = await db
      .insert(candidateGrowthRepingsTable)
      .values({
        candidateId,
        employerId,
        applicationId: app.applicationId,
        skill: skillKey,
        quarterKey: qk,
      })
      .onConflictDoNothing({
        target: [
          candidateGrowthRepingsTable.candidateId,
          candidateGrowthRepingsTable.employerId,
          candidateGrowthRepingsTable.quarterKey,
        ],
      })
      .returning({ id: candidateGrowthRepingsTable.id });
    if (claimed.length === 0) continue; // already re-pinged this quarter

    const staff = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.employerId, employerId),
          eq(usersTable.status, "active"),
        ),
      );

    for (const u of staff) {
      try {
        await sendNotification({
          userId: u.id,
          kind: "growth_skill_reping",
          title: `${candidate.fullName} is now skilled in ${skill}`,
          body: `They previously applied to ${app.jobTitle} and have just completed a growth-plan skill you required. Worth a fresh look?`,
          link: `/applications/${app.applicationId}`,
          category: "applicationStatus",
          data: {
            kind: "growth_reping",
            candidateId,
            applicationId: app.applicationId,
            skill: skillKey,
          },
        });
      } catch (err) {
        logger.warn(
          { err, employerId, candidateId, skill: skillKey },
          "growth-plan: reping notification failed",
        );
      }
    }
    notified += 1;
  }
  return { employersNotified: notified };
}

/**
 * Serializer used by the API + the digest worker. Returns the active
 * growth-plan skills with attached resource packs, sorted by impact.
 */
export type GrowthPlanItem = {
  id: number;
  skill: string;
  status: "active" | "completed" | "dismissed";
  addedAt: string;
  completedAt: string | null;
  targetDate: string | null;
  rejectionCount: number;
  verificationUrl: string | null;
  resources: { title: string; url: string; estMinutes: number }[];
  estMinutes: number;
};

export async function listGrowthPlan(
  candidateId: number,
  opts: { includeCompleted?: boolean } = {},
): Promise<GrowthPlanItem[]> {
  const includeCompleted = opts.includeCompleted === true;
  const rows = await db
    .select()
    .from(candidateGrowthSkillsTable)
    .where(eq(candidateGrowthSkillsTable.candidateId, candidateId))
    .orderBy(desc(candidateGrowthSkillsTable.rejectionCount));
  return rows
    .filter((r) =>
      r.status === "dismissed"
        ? false
        : includeCompleted || r.status === "active",
    )
    .map((r) => {
      const pack = getGrowthResources(r.skill);
      return {
        id: r.id,
        skill: r.skill,
        status: r.status as "active" | "completed" | "dismissed",
        addedAt: r.addedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        targetDate: r.targetDate ? r.targetDate.toISOString() : null,
        rejectionCount: r.rejectionCount,
        verificationUrl: r.verificationUrl,
        resources: pack.resources.slice(0, 2),
        estMinutes: pack.totalEstMinutes,
      };
    });
}

void sql;
