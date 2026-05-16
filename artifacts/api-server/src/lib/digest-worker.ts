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

import { and, desc, eq, gt, gte, ilike, lt, sql } from "drizzle-orm";
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
import { sendEngagementEmail } from "./email";

/**
 * Returns the most-recently-completed Monday→Sunday window in UTC.
 *
 * `start` is inclusive (the previous Monday at 00:00:00 UTC); `end` is
 * exclusive (the *current* week's Monday at 00:00:00 UTC). Using a
 * complete, closed window means:
 *   - Every metric query is bounded on both sides (`>= start AND < end`)
 *     so a digest generated at any point during the current week
 *     covers exactly one full week of activity.
 *   - The (candidateId, weekStart) unique index can write the row once
 *     and never need an in-place update — the underlying data for that
 *     window is frozen by the time we run.
 */
function previousCompleteWeekUTC(d = new Date()): { start: Date; end: Date } {
  const today = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  // 0=Sun..6=Sat. Days since the Monday that *started* the current week.
  const dow = today.getUTCDay();
  const offsetToCurMonday = dow === 0 ? 6 : dow - 1;
  const end = new Date(today);
  end.setUTCDate(today.getUTCDate() - offsetToCurMonday); // current Monday
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 7); // previous Monday
  return { start, end };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function runDigestForCandidate(
  candidateId: number,
  weekStart: Date,
  weekEnd: Date,
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
        lt(profileViewsTable.viewedAt, weekEnd),
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
        lt(applicationsTable.appliedAt, weekEnd),
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
    .where(
      and(gte(jobsTable.postedAt, weekStart), lt(jobsTable.postedAt, weekEnd)),
    )
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
    // Spec: digest surfaces exactly 3 newly matched jobs. Web and
    // mobile both render the full list — no client-side trimming.
    .slice(0, 3);

  await db.insert(candidateWeeklyDigestsTable).values({
    candidateId,
    weekStart: fmtDate(weekStart),
    profileViews,
    applicationsSent,
    interviewsScheduled,
    newMatchesJson: JSON.stringify(newMatches),
  });

  // In-app notification + email handoff (both best effort).
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

      // Hand off to the engagement-email helper. Today this is a stub
      // that returns { sent: false, reason: "email-not-configured" }
      // — but routing through the helper means the day a provider is
      // wired up the worker starts sending automatically with no
      // changes here. We persist the outcome on the digest row so a
      // future replay job can pick up rows where sent_at is still
      // null but email_send_result is "email-not-configured".
      const emailLines = [
        `Hi,`,
        ``,
        `Here is your weekly engagement summary on Jumerra (week of ${fmtDate(weekStart)}):`,
        `  • ${profileViews} profile view${profileViews === 1 ? "" : "s"}`,
        `  • ${applicationsSent} application${applicationsSent === 1 ? "" : "s"} sent`,
        `  • ${interviewsScheduled} interview${interviewsScheduled === 1 ? "" : "s"} scheduled`,
        `  • ${newMatches.length} new job match${newMatches.length === 1 ? "" : "es"}`,
        ``,
        `Sign in to Jumerra to see the full breakdown.`,
      ];
      const result = await sendEngagementEmail({
        to: candUser.email,
        kind: "weekly_digest",
        subject: `Your week on Jumerra`,
        body: emailLines.join("\n"),
        candidateId,
        logger,
      });
      await db
        .update(candidateWeeklyDigestsTable)
        .set({
          emailSentAt: result.sent ? new Date() : null,
          emailSendResult: result.sent ? `sent:${result.provider}` : `pending:${result.reason}`,
        })
        .where(
          and(
            eq(candidateWeeklyDigestsTable.candidateId, candidateId),
            eq(candidateWeeklyDigestsTable.weekStart, fmtDate(weekStart)),
          ),
        );
    }
  } catch (err) {
    logger.warn({ err, candidateId }, "Failed to enqueue weekly digest notification");
  }
}

export async function runWeeklyDigestSweep(): Promise<void> {
  const { start: weekStart, end: weekEnd } = previousCompleteWeekUTC();
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
      await runDigestForCandidate(id, weekStart, weekEnd);
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
  // Skip immediately if both channels are off — nothing to do.
  if (!search.emailAlerts && !search.inAppAlerts) return;

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

  // Push lastSeenJobId forward so we don't re-notify on the next sweep,
  // and stamp lastAlertedAt so the UI can show "alerted X ago".
  const newMaxId = Math.max(...matches.map((m) => m.id));
  await db
    .update(candidateSavedSearchesTable)
    .set({ lastSeenJobId: newMaxId, lastAlertedAt: new Date() })
    .where(eq(candidateSavedSearchesTable.id, search.id));

  try {
    const [candUser] = await db
      .select({ userId: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.candidateId, search.candidateId));
    if (!candUser) return;

    const title = `${matches.length} new job${matches.length === 1 ? "" : "s"} match "${search.name}"`;
    const sample = matches.slice(0, 2).map((m) => m.title).join(", ");

    if (search.inAppAlerts) {
      await db.insert(notificationsTable).values({
        userId: candUser.userId,
        kind: "saved_search_alert",
        title,
        body: sample,
        link: "/jobs",
      });
    }

    if (search.emailAlerts) {
      const emailBody = [
        `Hi,`,
        ``,
        `${title}.`,
        ``,
        `Newest matches:`,
        ...matches.slice(0, 5).map((m) => `  • ${m.title}`),
        ``,
        `Sign in to Jumerra to see the full list.`,
      ].join("\n");
      await sendEngagementEmail({
        to: candUser.email,
        kind: "saved_search_alert",
        subject: title,
        body: emailBody,
        candidateId: search.candidateId,
        logger,
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
  // Sweep any saved search where at least one channel is enabled.
  // (`alertsEnabled` is the legacy "any-channel" mirror maintained by
  // the routes in routes/engagement.ts.)
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
