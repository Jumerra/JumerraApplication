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

import { and, desc, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  applicationStatusHistoryTable,
  candidateDismissedJobsTable,
  candidatesTable,
  candidateSavedSearchesTable,
  candidateWeeklyDigestsTable,
  interviewInvitesTable,
  interviewTimeSlotsTable,
  jobsTable,
  employersTable,
  notificationPrefsTable,
  notificationsTable,
  profileViewsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { calculateMatchScore } from "./matching";
import { sendEngagementEmail } from "./email";
import { sendNotificationToCandidate } from "./notifier";
import { jobMatchesFilters, savedSearchToFilters } from "./job-filters";

/**
 * Resolve the actual UTC instant for a wall-clock local date in `tz`.
 *
 * We can't ask `Intl.DateTimeFormat` to *parse* a local-time string,
 * but we can ask it to format any UTC instant in `tz`. So we
 * pre-construct the date as if it were UTC, ask how `tz` would render
 * that instant, derive the offset from the delta, subtract it, and
 * refine once to absorb DST transitions that straddle midnight.
 */
function localToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (d: Date): number => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(d);
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0");
    let h = get("hour");
    // ICU sometimes formats midnight as 24 with hour12:false.
    if (h === 24) h = 0;
    const renderedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      h,
      get("minute"),
      get("second"),
    );
    return renderedAsUtc - d.getTime();
  };
  const guess = new Date(asUtcMs);
  const off1 = offsetAt(guess);
  const refined = new Date(asUtcMs - off1);
  const off2 = offsetAt(refined);
  return new Date(asUtcMs - off2);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Returns the most-recently-completed Monday→Monday window in the
 * *candidate's* local timezone, expressed in absolute UTC instants
 * suitable for `>=`/`<` predicates against `timestamptz` columns.
 *
 * `start` is inclusive (the previous local Monday at 00:00 local);
 * `end` is exclusive (the current local Monday at 00:00 local).
 *
 * `localWeekStartDate` is the wall-clock YYYY-MM-DD of `start` in the
 * candidate's timezone. We use it as the digest table's idempotency
 * key so that, e.g., the same candidate in Tokyo on local Mon Dec 4
 * and the same candidate in Honolulu on local Mon Dec 4 get distinct
 * rows when their local weeks don't line up to the same UTC date.
 *
 * Falls back to UTC when `tz` is null/empty/invalid.
 */
export function previousCompleteWeekLocal(
  tz: string | null | undefined,
  now: Date = new Date(),
): { start: Date; end: Date; localWeekStartDate: string } {
  // When tz is null/empty or fails IANA parsing, normalize to UTC for
  // *both* the formatToParts call below and the subsequent localToUtc
  // calls — otherwise the fallback `parts` would be UTC-derived but
  // `localToUtc(safeTz, …)` would still throw RangeError.
  let safeTz = tz && tz.length > 0 ? tz : "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTz,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    safeTz = "UTC";
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  }
  const get = (t: string) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = weekdayMap[weekday] ?? 1;
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;

  // Walk back to local Monday-of-this-week and previous-Monday using
  // calendar arithmetic on a *UTC-anchored* date that ignores the
  // tz — we only care about the Y/M/D components.
  const localToday = new Date(Date.UTC(year, month - 1, day));
  const curLocalMonday = new Date(
    localToday.getTime() - daysSinceMonday * 86_400_000,
  );
  const prevLocalMonday = new Date(curLocalMonday.getTime() - 7 * 86_400_000);

  const end = localToUtc(
    safeTz,
    curLocalMonday.getUTCFullYear(),
    curLocalMonday.getUTCMonth() + 1,
    curLocalMonday.getUTCDate(),
  );
  const start = localToUtc(
    safeTz,
    prevLocalMonday.getUTCFullYear(),
    prevLocalMonday.getUTCMonth() + 1,
    prevLocalMonday.getUTCDate(),
  );

  const localWeekStartDate = `${prevLocalMonday.getUTCFullYear()}-${pad2(prevLocalMonday.getUTCMonth() + 1)}-${pad2(prevLocalMonday.getUTCDate())}`;
  return { start, end, localWeekStartDate };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a candidate's local weekday + hour using their stored IANA
 * timezone. Falls back to UTC when the timezone is missing or invalid.
 * The weekly digest dispatch only runs when this returns
 * `{ weekday: "Mon", hour: 9 }` — i.e. the hourly sweep tick that
 * lands inside the candidate's local Monday-9-AM window.
 */
function localWeekdayAndHour(
  timezone: string | null | undefined,
  now: Date = new Date(),
): { weekday: string; hour: number } {
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
    // `hour12: false` can emit "24" at midnight in some ICU versions.
    const hourNum = Number(hourRaw) % 24;
    return { weekday, hour: hourNum };
  } catch {
    // Bad IANA id — pretend UTC. We tolerate this rather than throw so
    // a single bad row can't take down the whole sweep.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
    return { weekday, hour: Number(hourRaw) % 24 };
  }
}

/**
 * Returns true if `now` lands inside the candidate's local Monday
 * 09:00–09:59 window. The hourly sweep tick + the
 * (candidateId, weekStart) unique index together guarantee at most one
 * delivery per candidate per week.
 *
 * `WEEKLY_DIGEST_FORCE=true` short-circuits the gate so deploy-time
 * smoke tests and local development can fire on demand.
 */
export function isCandidateLocalMondayNineAM(
  timezone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (process.env.WEEKLY_DIGEST_FORCE === "true") return true;
  const { weekday, hour } = localWeekdayAndHour(timezone, now);
  return weekday === "Mon" && hour === 9;
}

export async function runDigestForCandidate(
  candidateId: number,
  weekStart: Date,
  weekEnd: Date,
  weekStartKey: string,
): Promise<void> {
  // Idempotency check via unique index — skip if already generated.
  // `weekStartKey` is the *local* week-start date in the candidate's
  // timezone; passing it in (rather than recomputing from `weekStart`
  // which is a UTC instant) keeps the idempotency key aligned with the
  // candidate's local week even when their local Monday 00:00 falls on
  // a different UTC calendar day than UTC Monday 00:00.
  const [existing] = await db
    .select({ id: candidateWeeklyDigestsTable.id })
    .from(candidateWeeklyDigestsTable)
    .where(
      and(
        eq(candidateWeeklyDigestsTable.candidateId, candidateId),
        eq(candidateWeeklyDigestsTable.weekStart, weekStartKey),
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

  // -- Applications sent (this week) ------------------------------------
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

  // -- Interviews scheduled (this week) ---------------------------------
  // Counts every transition into "interview" within the window, across
  // *all* of the candidate's applications — not just ones that were
  // also applied this week. Older applications that finally got an
  // interview this week are exactly the kind of progress a weekly
  // digest is supposed to celebrate. We dedupe by application_id so a
  // back-and-forth (e.g. interview → screening → interview) only
  // counts once per app per week.
  const interviewRows = await db
    .selectDistinct({ appId: applicationStatusHistoryTable.applicationId })
    .from(applicationStatusHistoryTable)
    .innerJoin(
      applicationsTable,
      eq(applicationsTable.id, applicationStatusHistoryTable.applicationId),
    )
    .where(
      and(
        eq(applicationsTable.candidateId, candidateId),
        eq(applicationStatusHistoryTable.status, "interview"),
        gte(applicationStatusHistoryTable.changedAt, weekStart),
        lt(applicationStatusHistoryTable.changedAt, weekEnd),
      ),
    );
  const interviewsScheduled = interviewRows.length;

  // -- Top unseen job matches --------------------------------------------
  // Mirror the /me/feed ranking: score every open job for this candidate
  // (not just the ones posted this week — a job posted three weeks ago
  // that the candidate has never seen is still a "strong new match" from
  // their perspective), then exclude jobs they have already applied to,
  // dismissed in For-You, or that we surfaced in a prior week's digest.
  // We keep the top 5 — the spec's "top 5 unseen matches".
  const allJobs = await db
    .select({ job: jobsTable, employer: employersTable })
    .from(jobsTable)
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .limit(500);

  const appliedRows = await db
    .select({ jobId: applicationsTable.jobId })
    .from(applicationsTable)
    .where(eq(applicationsTable.candidateId, candidateId));
  const dismissedRows = await db
    .select({ jobId: candidateDismissedJobsTable.jobId })
    .from(candidateDismissedJobsTable)
    .where(eq(candidateDismissedJobsTable.candidateId, candidateId));
  const priorDigests = await db
    .select({ json: candidateWeeklyDigestsTable.newMatchesJson })
    .from(candidateWeeklyDigestsTable)
    .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId));
  const seenJobIds = new Set<number>();
  for (const r of appliedRows) seenJobIds.add(r.jobId);
  for (const r of dismissedRows) seenJobIds.add(r.jobId);
  for (const d of priorDigests) {
    try {
      const list = JSON.parse(d.json) as { jobId: number }[];
      for (const m of list) seenJobIds.add(m.jobId);
    } catch {
      // ignore malformed legacy rows
    }
  }

  const newMatches = allJobs
    .filter(({ job }) => !seenJobIds.has(job.id))
    .map(({ job, employer }) => {
      const { score } = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
      const tier = (job.tier ?? "free") as "free" | "promoted" | "sponsored";
      const tierBias = tier === "sponsored" ? 25 : tier === "promoted" ? 10 : 0;
      return {
        jobId: job.id,
        title: job.title,
        employerName: employer.name,
        matchScore: Math.min(100, score + tierBias),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);

  await db.insert(candidateWeeklyDigestsTable).values({
    candidateId,
    weekStart: weekStartKey,
    profileViews,
    applicationsSent,
    interviewsScheduled,
    newMatchesJson: JSON.stringify(newMatches),
  });

  // In-app + push notification + email handoff (all best effort).
  // The `weeklyDigest` preference gates *delivery* (push + email), not
  // the digest row itself — the dashboard "Your week" card should keep
  // showing stats for opted-out candidates too. `sendNotificationToCandidate`
  // always writes the in-app row and only suppresses push when the
  // category pref is off, which matches the rest of the notifier.
  try {
    const [candUser] = await db
      .select({ userId: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.candidateId, candidateId));
    if (candUser) {
      const [prefRow] = await db
        .select({ weeklyDigest: notificationPrefsTable.weeklyDigest })
        .from(notificationPrefsTable)
        .where(eq(notificationPrefsTable.userId, candUser.userId))
        .limit(1);
      const wantsDigest = prefRow?.weeklyDigest ?? true;

      if (wantsDigest) {
        const topLine = newMatches[0]
          ? ` Top pick: ${newMatches[0].title} at ${newMatches[0].employerName} (${newMatches[0].matchScore}%).`
          : "";
        await sendNotificationToCandidate(candidateId, {
          kind: "weekly_digest",
          title: `Your week on Jumerra: ${newMatches.length} new match${newMatches.length === 1 ? "" : "es"}`,
          body: `${profileViews} profile views · ${applicationsSent} applications.${topLine}`,
          link: "/account/dashboard",
          category: "weeklyDigest",
          data: { weekStart: weekStartKey },
        });
      } else {
        // Pref off: still keep an in-app row so the inbox + dashboard
        // card reflect the week, just without push/email.
        await db.insert(notificationsTable).values({
          userId: candUser.userId,
          kind: "weekly_digest",
          title: `Your week on Jumerra`,
          body: `${profileViews} profile views · ${applicationsSent} applications · ${newMatches.length} new matches`,
          link: "/account/dashboard",
        });
      }

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
        `Here is your weekly engagement summary on Jumerra (week of ${weekStartKey}):`,
        `  • ${profileViews} profile view${profileViews === 1 ? "" : "s"}`,
        `  • ${applicationsSent} application${applicationsSent === 1 ? "" : "s"} sent`,
        `  • ${interviewsScheduled} interview${interviewsScheduled === 1 ? "" : "s"} scheduled`,
        `  • ${newMatches.length} new job match${newMatches.length === 1 ? "" : "es"}`,
      ];
      if (newMatches.length > 0) {
        emailLines.push(``, `Your strongest new matches:`);
        for (const m of newMatches) {
          emailLines.push(
            `  • ${m.title} at ${m.employerName} — ${m.matchScore}% match`,
          );
        }
      }
      emailLines.push(``, `Sign in to Jumerra to see the full breakdown.`);
      const result = wantsDigest
        ? await sendEngagementEmail({
            to: candUser.email,
            kind: "weekly_digest",
            subject: `Your week on Jumerra`,
            body: emailLines.join("\n"),
            candidateId,
            logger,
          })
        : { sent: false as const, reason: "user-opted-out" as const };
      await db
        .update(candidateWeeklyDigestsTable)
        .set({
          emailSentAt: result.sent ? new Date() : null,
          emailSendResult: result.sent ? `sent:${result.provider}` : `pending:${result.reason}`,
        })
        .where(
          and(
            eq(candidateWeeklyDigestsTable.candidateId, candidateId),
            eq(candidateWeeklyDigestsTable.weekStart, weekStartKey),
          ),
        );
    }
  } catch (err) {
    logger.warn({ err, candidateId }, "Failed to enqueue weekly digest notification");
  }
}

export async function runWeeklyDigestSweep(): Promise<void> {
  const candidates = await db
    .select({
      id: candidatesTable.id,
      timezone: candidatesTable.timezone,
    })
    .from(candidatesTable);
  let generated = 0;
  let skippedByTimeWindow = 0;
  const now = new Date();
  for (const { id, timezone } of candidates) {
    try {
      // Local-time gate: only deliver during the candidate's local
      // Monday 09:00 hour. Without a timezone we treat the candidate
      // as UTC, which still lands on a real Mon 09:00. The hourly
      // sweep + the (candidateId, weekStart) unique index together
      // give us at-most-once delivery per candidate per week.
      if (!isCandidateLocalMondayNineAM(timezone, now)) {
        skippedByTimeWindow += 1;
        continue;
      }
      // Compute the digest window in the *candidate's* local
      // timezone so a Tokyo candidate's week and a Honolulu
      // candidate's week each cover Mon→Mon in their own wall
      // clock, not in UTC.
      const { start, end, localWeekStartDate } = previousCompleteWeekLocal(
        timezone,
        now,
      );
      const before = await db
        .select({ id: candidateWeeklyDigestsTable.id })
        .from(candidateWeeklyDigestsTable)
        .where(
          and(
            eq(candidateWeeklyDigestsTable.candidateId, id),
            eq(candidateWeeklyDigestsTable.weekStart, localWeekStartDate),
          ),
        );
      if (before.length > 0) continue;
      await runDigestForCandidate(id, start, end, localWeekStartDate);
      generated += 1;
    } catch (err) {
      logger.warn({ err, candidateId: id }, "Digest sweep failed for candidate");
    }
  }
  logger.info(
    { generated, skippedByTimeWindow, total: candidates.length },
    "Weekly digest sweep complete",
  );
}

// ---------------------------------------------------------------------------
// Saved-search alert sweep (daily-cadence)
// ---------------------------------------------------------------------------

async function runSavedSearchAlertsForOne(
  search: typeof candidateSavedSearchesTable.$inferSelect,
): Promise<void> {
  // Skip immediately if both channels are off — nothing to do.
  if (!search.emailAlerts && !search.inAppAlerts) return;

  // Pull every job posted since the last alert (`id > lastSeenJobId`)
  // and apply the shared `/jobs` filter predicate in memory. This is
  // the same matching contract candidates see when they browse, so an
  // alert can never fire for a job that wouldn't have appeared in the
  // saved search's underlying query (and vice versa).
  //
  // We cap at 200 to bound work per sweep — saved searches with very
  // wide filters in a busy install would otherwise scan unbounded
  // history. Practically, lastSeenJobId is moved forward on every run,
  // so the steady-state set is small.
  const candidateJobs = await db
    .select()
    .from(jobsTable)
    .where(gt(jobsTable.id, search.lastSeenJobId))
    .orderBy(desc(jobsTable.id))
    .limit(200);

  const filters = savedSearchToFilters(search);
  const matched = candidateJobs.filter((j) => jobMatchesFilters(j, filters));
  const matches = matched.map((j) => ({ id: j.id, title: j.title }));
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
// Interview reminder sweep (T-24h and T-1h)
// ---------------------------------------------------------------------------

/**
 * Runs every 5 minutes. For each accepted interview whose chosen slot
 * starts in the next 24h or 1h, sends a candidate reminder push +
 * in-app notification, then stamps `reminded24At` / `reminded1At` so
 * we don't re-send.
 *
 * The lookahead window is ±5 minutes around the scheduler tick to
 * cover small drift, since the cron runs at 5-minute intervals.
 */
export async function runInterviewReminderSweep(): Promise<void> {
  const now = new Date();
  const T24_LOWER = new Date(now.getTime() + 24 * 60 * 60 * 1000 - 5 * 60 * 1000);
  const T24_UPPER = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000);
  const T1_LOWER = new Date(now.getTime() + 60 * 60 * 1000 - 5 * 60 * 1000);
  const T1_UPPER = new Date(now.getTime() + 60 * 60 * 1000 + 5 * 60 * 1000);

  // Pull accepted invites with their selected slot's startsAt.
  const rows = await db
    .select({
      inviteId: interviewInvitesTable.id,
      candidateId: applicationsTable.candidateId,
      jobTitle: jobsTable.title,
      employerName: employersTable.name,
      startsAt: interviewTimeSlotsTable.startsAt,
      reminded24At: interviewInvitesTable.reminded24At,
      reminded1At: interviewInvitesTable.reminded1At,
    })
    .from(interviewInvitesTable)
    .innerJoin(
      interviewTimeSlotsTable,
      eq(interviewTimeSlotsTable.id, interviewInvitesTable.selectedSlotId),
    )
    .innerJoin(
      applicationsTable,
      eq(applicationsTable.id, interviewInvitesTable.applicationId),
    )
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
    .where(
      and(
        eq(interviewInvitesTable.status, "accepted"),
        or(
          // Slot starts in the T-24h window AND we haven't sent the
          // 24h reminder yet.
          and(
            gte(interviewTimeSlotsTable.startsAt, T24_LOWER),
            lte(interviewTimeSlotsTable.startsAt, T24_UPPER),
            sql`${interviewInvitesTable.reminded24At} IS NULL`,
          ),
          // Slot starts in the T-1h window AND we haven't sent the
          // 1h reminder yet.
          and(
            gte(interviewTimeSlotsTable.startsAt, T1_LOWER),
            lte(interviewTimeSlotsTable.startsAt, T1_UPPER),
            sql`${interviewInvitesTable.reminded1At} IS NULL`,
          ),
        ),
      ),
    );

  let fired = 0;
  for (const r of rows) {
    const startMs = r.startsAt.getTime();
    const due24 =
      !r.reminded24At &&
      startMs >= T24_LOWER.getTime() &&
      startMs <= T24_UPPER.getTime();
    const due1 =
      !r.reminded1At &&
      startMs >= T1_LOWER.getTime() &&
      startMs <= T1_UPPER.getTime();

    if (!due24 && !due1) continue;

    const when = due24 ? "tomorrow" : "in 1 hour";
    try {
      await sendNotificationToCandidate(r.candidateId, {
        kind: "interview_reminder",
        title: `Interview ${when}`,
        body: `Your interview with ${r.employerName} for "${r.jobTitle}" starts ${when}.`,
        link: `/interviews/${r.inviteId}`,
        category: "interviewReminder",
        data: { inviteId: r.inviteId, when: due24 ? "T-24h" : "T-1h" },
      });

      // Mark dedup. Use a single update so both flags can flip in the
      // same write if both windows happen to be due (unlikely but safe).
      await db
        .update(interviewInvitesTable)
        .set({
          ...(due24 ? { reminded24At: new Date() } : {}),
          ...(due1 ? { reminded1At: new Date() } : {}),
        })
        .where(eq(interviewInvitesTable.id, r.inviteId));
      fired += 1;
    } catch (err) {
      logger.warn(
        { err, inviteId: r.inviteId },
        "interview reminder dispatch failed",
      );
    }
  }
  if (fired > 0) {
    logger.info({ fired }, "Interview reminder sweep dispatched");
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
let started = false;

export function startEngagementScheduler(): void {
  if (started) return;
  started = true;

  // Weekly digest sweep runs hourly so the candidate-local Monday-9-AM
  // gate (`isCandidateLocalMondayNineAM`) can fire within a one-hour
  // window of the candidate's local 09:00 in any timezone. The
  // (candidateId, weekStart) unique index keeps it at-most-once per
  // candidate per week even if the tick drifts.
  const digestTick = async () => {
    try {
      await runWeeklyDigestSweep();
    } catch (err) {
      logger.error({ err }, "Weekly digest sweep crashed");
    }
  };

  // Saved-search alerts stay on the slower 6-hour cadence — they aren't
  // time-of-day gated.
  const savedSearchTick = async () => {
    try {
      await runSavedSearchAlertSweep();
    } catch (err) {
      logger.error({ err }, "Saved-search alert sweep crashed");
    }
  };

  const reminderTick = async () => {
    try {
      await runInterviewReminderSweep();
    } catch (err) {
      logger.error({ err }, "Interview reminder sweep crashed");
    }
  };

  // Defer initial sweeps so they don't block boot.
  setTimeout(() => {
    void digestTick();
  }, 30_000);
  setInterval(() => {
    void digestTick();
  }, ONE_HOUR_MS).unref();

  setTimeout(() => {
    void savedSearchTick();
  }, 45_000);
  setInterval(() => {
    void savedSearchTick();
  }, SIX_HOURS_MS).unref();

  // Interview reminders run on a tighter cadence so the T-1h window
  // doesn't drift more than 5m late.
  setTimeout(() => {
    void reminderTick();
  }, 60_000);
  setInterval(() => {
    void reminderTick();
  }, FIVE_MIN_MS).unref();
}
