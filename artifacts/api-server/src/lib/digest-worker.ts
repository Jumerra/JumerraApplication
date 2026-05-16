/**
 * Weekly digest worker.
 *
 * Computes a per-candidate engagement summary for the most recent
 * Monday-anchored week and (1) persists it in `candidate_weekly_digests`,
 * (2) inserts an in-app notification, and (3) calls the email stub.
 *
 * Runs lazily on server boot (one immediate sweep) and then every 6h
 * via setInterval. The digest table has a unique (candidateId, weekStart)
 * index so re-runs in the same week are no-ops.
 *
 * Replit doesn't expose cron, so this is a best-effort in-process
 * scheduler — fine for a single server instance, which is our current
 * deployment shape.
 */

import { and, desc, eq, gt, gte, ilike, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  candidatesTable,
  candidateSavedSearchesTable,
  candidateWeeklyDigestsTable,
  jobsTable,
  employersTable,
  notificationsTable,
  profileViewsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { calculateMatchScore } from "./matching";

function weekStartUTC(d = new Date()): Date {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  // 0=Sun..6=Sat — anchor to Monday
  const dow = out.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function runDigestForCandidate(
  candidateId: number,
  weekStart: Date,
): Promise<void> {
  // Idempotency check via unique index — skip if already generated.
  const [existing] = await db
    .select({ id: candidateWeeklyDigestsTable.id })
    .from(candidateWeeklyDigestsTable)
    .where(
      and(
        eq(candidateWeeklyDigestsTable.candidateId, candidateId),
        eq(candidateWeeklyDigestsTable.weekStart, fmtDate(weekStart)),
      ),
    );
  if (existing) return;

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId));
  if (!candidate) return;

  // -- Profile views during the week -------------------------------------
  const viewsRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(profileViewsTable)
    .where(
      and(
        eq(profileViewsTable.candidateId, candidateId),
        gte(profileViewsTable.viewedAt, weekStart),
      ),
    );
  const profileViews = Number(viewsRow[0]?.count ?? 0);

  // -- Applications sent + interviews scheduled --------------------------
  const apps = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.candidateId, candidateId),
        gte(applicationsTable.appliedAt, weekStart),
      ),
    );
  const applicationsSent = apps.length;
  const interviewsScheduled = apps.filter(
    (a) => a.status === "interview",
  ).length;

  // -- New top job matches -----------------------------------------------
  const allJobs = await db
    .select({ job: jobsTable, employer: employersTable })
    .from(jobsTable)
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(gte(jobsTable.postedAt, weekStart))
    .limit(50);

  const newMatches = allJobs
    .map(({ job, employer }) => {
      const { score } = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
      return {
        jobId: job.id,
        title: job.title,
        employerName: employer.name,
        matchScore: score,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);

  await db.insert(candidateWeeklyDigestsTable).values({
    candidateId,
    weekStart: fmtDate(weekStart),
    profileViews,
    applicationsSent,
    interviewsScheduled,
    newMatchesJson: JSON.stringify(newMatches),
  });

  // In-app notification (best effort)
  try {
    const [candUser] = await db
      .select({ userId: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.candidateId, candidateId));
    if (candUser) {
      await db.insert(notificationsTable).values({
        userId: candUser.userId,
        kind: "weekly_digest",
        title: `Your week on Jumerra`,
        body: `${profileViews} profile views · ${applicationsSent} applications · ${newMatches.length} new matches`,
        link: "/account/dashboard",
      });
      // Email stub — see lib/email.ts; intentionally a no-op until a
      // provider is configured. We log only the candidate id, never the
      // address, mirroring the policy in lib/email.ts.
      logger.info(
        { candidateId },
        "Weekly digest email pending (provider not configured)",
      );
    }
  } catch (err) {
    logger.warn({ err, candidateId }, "Failed to enqueue weekly digest notification");
  }
}

export async function runWeeklyDigestSweep(): Promise<void> {
  const weekStart = weekStartUTC();
  const candidates = await db
    .select({ id: candidatesTable.id })
    .from(candidatesTable);
  let generated = 0;
  for (const { id } of candidates) {
    try {
      const before = await db
        .select({ id: candidateWeeklyDigestsTable.id })
        .from(candidateWeeklyDigestsTable)
        .where(
          and(
            eq(candidateWeeklyDigestsTable.candidateId, id),
            eq(candidateWeeklyDigestsTable.weekStart, fmtDate(weekStart)),
          ),
        );
      if (before.length > 0) continue;
      await runDigestForCandidate(id, weekStart);
      generated += 1;
    } catch (err) {
      logger.warn({ err, candidateId: id }, "Digest sweep failed for candidate");
    }
  }
  logger.info({ generated, total: candidates.length }, "Weekly digest sweep complete");
}

// ---------------------------------------------------------------------------
// Saved-search alert sweep (daily-cadence)
// ---------------------------------------------------------------------------

async function runSavedSearchAlertsForOne(
  search: typeof candidateSavedSearchesTable.$inferSelect,
): Promise<void> {
  const conds = [gt(jobsTable.id, search.lastSeenJobId)];
  if (search.jobType) conds.push(eq(jobsTable.type, search.jobType));
  if (search.searchText && search.searchText.trim()) {
    conds.push(ilike(jobsTable.title, `%${search.searchText.trim()}%`));
  }
  const matches = await db
    .select({ id: jobsTable.id, title: jobsTable.title })
    .from(jobsTable)
    .where(and(...conds))
    .orderBy(desc(jobsTable.id))
    .limit(10);
  if (matches.length === 0) return;

  // Push lastSeenJobId forward so we don't re-notify on the next sweep.
  const newMaxId = Math.max(...matches.map((m) => m.id));
  await db
    .update(candidateSavedSearchesTable)
    .set({ lastSeenJobId: newMaxId })
    .where(eq(candidateSavedSearchesTable.id, search.id));

  try {
    const [candUser] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.candidateId, search.candidateId));
    if (candUser) {
      const sample = matches.slice(0, 2).map((m) => m.title).join(", ");
      await db.insert(notificationsTable).values({
        userId: candUser.userId,
        kind: "saved_search_alert",
        title: `${matches.length} new job${matches.length === 1 ? "" : "s"} match "${search.name}"`,
        body: sample,
        link: "/jobs",
      });
    }
  } catch (err) {
    logger.warn(
      { err, savedSearchId: search.id },
      "Failed to enqueue saved-search alert",
    );
  }
}

export async function runSavedSearchAlertSweep(): Promise<void> {
  const searches = await db
    .select()
    .from(candidateSavedSearchesTable)
    .where(eq(candidateSavedSearchesTable.alertsEnabled, true));
  let alerted = 0;
  for (const s of searches) {
    try {
      const before = await db
        .select({ id: candidateSavedSearchesTable.id })
        .from(candidateSavedSearchesTable)
        .where(eq(candidateSavedSearchesTable.id, s.id));
      if (before.length === 0) continue;
      await runSavedSearchAlertsForOne(s);
      alerted += 1;
    } catch (err) {
      logger.warn({ err, savedSearchId: s.id }, "Alert sweep failed");
    }
  }
  logger.info({ alerted, total: searches.length }, "Saved-search alert sweep complete");
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let started = false;

export function startEngagementScheduler(): void {
  if (started) return;
  started = true;

  const sweep = async () => {
    try {
      await runWeeklyDigestSweep();
    } catch (err) {
      logger.error({ err }, "Weekly digest sweep crashed");
    }
    try {
      await runSavedSearchAlertSweep();
    } catch (err) {
      logger.error({ err }, "Saved-search alert sweep crashed");
    }
  };

  // Defer initial sweep so it doesn't block boot.
  setTimeout(() => {
    void sweep();
  }, 30_000);
  setInterval(() => {
    void sweep();
  }, SIX_HOURS_MS).unref();
}
