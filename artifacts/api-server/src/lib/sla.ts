/**
 * Employer Fast-Track (48hr Response) SLA — task #76.
 *
 * An employer can opt in to a "we will respond within 48 hours"
 * pledge from their dashboard. While opted in:
 *   • every job they post displays a Fast-Track badge,
 *   • the candidate job board exposes a `fastTrackOnly` filter,
 *   • the nightly sweep enforces the SLA.
 *
 * SLA: an application is "in breach" once it has been sitting in
 * `applied` (i.e. no employer action) for >48 hours.
 *
 * Enforcement (rolling 30-day window):
 *   • 0 breaches → no-op
 *   • 1 breach  → one-time warning notification to the employer
 *   • >=2 breaches → auto-revoke for 30 days
 *       (fastTrackEnabled=false, fastTrackRevokedUntil=now+30d)
 *
 * The sweep is idempotent: a unique-by-application guard
 * (`sla_breaches_application_idx`) plus an existence check makes
 * re-runs safe.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  employersTable,
  employerSlaBreachesTable,
  jobsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendFastTrackEmail } from "./email";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Fully-derived public view of an employer's Fast-Track state. */
export interface FastTrackState {
  enabled: boolean;
  enabledAt: string | null;
  revokedUntil: string | null;
  /** Total breaches in the rolling 30-day window. */
  breachesLast30Days: number;
  /** Days since the most recent breach (null if no breach ever). */
  streakDays: number | null;
  /** Applications still in `applied` whose 48h deadline is < 12h away. */
  upcomingDeadlines: Array<{
    applicationId: number;
    candidateName: string;
    jobTitle: string;
    appliedAt: string;
    deadlineAt: string;
    hoursRemaining: number;
  }>;
}

/**
 * Read the Fast-Track state for one employer. Used by both the
 * dashboard widget and the post-toggle response so the UI never has
 * to refetch.
 */
export async function getFastTrackState(
  employerId: number,
): Promise<FastTrackState> {
  const [emp] = await db
    .select({
      fastTrackEnabled: employersTable.fastTrackEnabled,
      fastTrackEnabledAt: employersTable.fastTrackEnabledAt,
      fastTrackRevokedUntil: employersTable.fastTrackRevokedUntil,
    })
    .from(employersTable)
    .where(eq(employersTable.id, employerId));

  if (!emp) {
    throw Object.assign(new Error("Employer not found"), {
      code: "NOT_FOUND" as const,
    });
  }

  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const breaches = await db
    .select({ breachedAt: employerSlaBreachesTable.breachedAt })
    .from(employerSlaBreachesTable)
    .where(
      and(
        eq(employerSlaBreachesTable.employerId, employerId),
        gte(employerSlaBreachesTable.breachedAt, since),
      ),
    );

  const lastBreach = breaches.reduce<Date | null>(
    (acc, b) => (acc === null || b.breachedAt > acc ? b.breachedAt : acc),
    null,
  );
  const streakDays =
    lastBreach === null
      ? null
      : Math.max(
          0,
          Math.floor((Date.now() - lastBreach.getTime()) / (24 * 60 * 60 * 1000)),
        );

  // "Upcoming deadlines" = still-in-applied apps whose 48h deadline is
  // less than 12h away. Useful for the dashboard's "act now" widget.
  const twelveHourThreshold = new Date(
    Date.now() - (FORTY_EIGHT_HOURS_MS - 12 * 60 * 60 * 1000),
  );
  const fortyEightHourCutoff = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);

  const upcomingRows = await db
    .select({
      applicationId: applicationsTable.id,
      candidateName: sql<string>`coalesce(${usersTable.fullName}, 'Candidate')`,
      jobTitle: jobsTable.title,
      appliedAt: applicationsTable.appliedAt,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
    .leftJoin(usersTable, eq(usersTable.candidateId, applicationsTable.candidateId))
    .where(
      and(
        eq(jobsTable.employerId, employerId),
        eq(applicationsTable.status, "applied"),
        // appliedAt within the soon-to-breach window
        lt(applicationsTable.appliedAt, twelveHourThreshold),
        gte(applicationsTable.appliedAt, fortyEightHourCutoff),
      ),
    )
    .orderBy(applicationsTable.appliedAt)
    .limit(10);

  const upcomingDeadlines = upcomingRows.map((r) => {
    const deadline = new Date(r.appliedAt.getTime() + FORTY_EIGHT_HOURS_MS);
    const hoursRemaining = Math.max(
      0,
      Math.round((deadline.getTime() - Date.now()) / (60 * 60 * 1000)),
    );
    return {
      applicationId: r.applicationId,
      candidateName: r.candidateName,
      jobTitle: r.jobTitle,
      appliedAt: r.appliedAt.toISOString(),
      deadlineAt: deadline.toISOString(),
      hoursRemaining,
    };
  });

  return {
    enabled: emp.fastTrackEnabled,
    enabledAt: emp.fastTrackEnabledAt?.toISOString() ?? null,
    revokedUntil: emp.fastTrackRevokedUntil?.toISOString() ?? null,
    breachesLast30Days: breaches.length,
    streakDays,
    upcomingDeadlines,
  };
}

/**
 * Toggle Fast-Track on/off for an employer.
 *
 * Throws when the employer is currently under an active revocation
 * (`fastTrackRevokedUntil > now()`) and tries to re-enable — the
 * cooldown is non-bypassable from the UI on purpose.
 */
export async function toggleFastTrack(
  employerId: number,
  enable: boolean,
): Promise<FastTrackState> {
  const [current] = await db
    .select({
      fastTrackRevokedUntil: employersTable.fastTrackRevokedUntil,
    })
    .from(employersTable)
    .where(eq(employersTable.id, employerId));
  if (!current) {
    throw Object.assign(new Error("Employer not found"), {
      code: "NOT_FOUND" as const,
    });
  }

  if (
    enable &&
    current.fastTrackRevokedUntil &&
    current.fastTrackRevokedUntil.getTime() > Date.now()
  ) {
    throw Object.assign(
      new Error(
        `Fast-Track is revoked until ${current.fastTrackRevokedUntil.toISOString()}`,
      ),
      { code: "REVOKED" as const },
    );
  }

  await db
    .update(employersTable)
    .set({
      fastTrackEnabled: enable,
      fastTrackEnabledAt: enable ? new Date() : null,
    })
    .where(eq(employersTable.id, employerId));

  return getFastTrackState(employerId);
}

/**
 * Notify every employer staff user via BOTH channels required by the
 * Fast-Track spec: an in-app notification (bell) AND an email (warning
 * on the first breach, revoke + warning on the second). The email
 * sender is a stub today but logs the queued event so behaviour is
 * verifiable end-to-end; once Resend is wired in, callers don't change.
 */
async function notifyEmployerStaff(
  employerId: number,
  employerName: string,
  kind: "fast_track_warning" | "fast_track_revoked",
  title: string,
  body: string,
  breachCount: number,
  revokedUntil?: Date,
): Promise<void> {
  const staff = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.employerId, employerId));
  for (const s of staff) {
    try {
      await db.insert(notificationsTable).values({
        userId: s.id,
        kind,
        title,
        body,
        link: "/dashboard/employer",
      });
    } catch (err) {
      logger.warn({ err, userId: s.id }, "fast-track notify failed");
    }
    if (s.email) {
      try {
        await sendFastTrackEmail({
          to: s.email,
          employerId,
          employerName,
          userId: s.id,
          kind,
          breachCount,
          revokedUntil: revokedUntil?.toISOString(),
          logger,
        });
      } catch (err) {
        logger.warn({ err, userId: s.id }, "fast-track email failed");
      }
    }
  }
}

/**
 * Nightly SLA sweep.
 *
 * Scoped to employers with `fastTrackEnabled = true`. For each
 * employer:
 *   1. Find all `applied` applications older than 48h that aren't
 *      already recorded as a breach.
 *   2. Insert breach rows.
 *   3. Count breaches in the last 30 days (including newly inserted).
 *   4. If >=2 → revoke (disable + cooldown). If exactly 1 (and new
 *      breaches were just added) → warn.
 *
 * Designed to be idempotent — re-running the same minute is safe
 * because step 1 dedupes by `(employerId, applicationId)` existence
 * check.
 */
export async function sweepFastTrackBreaches(): Promise<{
  scannedEmployers: number;
  newBreaches: number;
  warned: number;
  revoked: number;
}> {
  const cutoff = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
  const employers = await db
    .select({
      id: employersTable.id,
      name: employersTable.name,
    })
    .from(employersTable)
    .where(eq(employersTable.fastTrackEnabled, true));

  let newBreaches = 0;
  let warned = 0;
  let revoked = 0;

  for (const emp of employers) {
    // Re-fetch the enabledAt for this employer so we never count
    // breaches whose `appliedAt` predates the current pledge — e.g.
    // an employer that re-enables Fast-Track shouldn't be revoked
    // for old, pre-pledge applications still sitting in `applied`.
    const [empState] = await db
      .select({ enabledAt: employersTable.fastTrackEnabledAt })
      .from(employersTable)
      .where(eq(employersTable.id, emp.id));
    const enabledAt = empState?.enabledAt ?? new Date(0);

    // Candidate-for-breach apps for this employer, filtered to those
    // applied AFTER the pledge was last enabled.
    const candidates = await db
      .select({
        applicationId: applicationsTable.id,
      })
      .from(applicationsTable)
      .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
      .where(
        and(
          eq(jobsTable.employerId, emp.id),
          eq(applicationsTable.status, "applied"),
          lt(applicationsTable.appliedAt, cutoff),
          gte(applicationsTable.appliedAt, enabledAt),
        ),
      );

    // Atomic, idempotent insert. The unique index on application_id
    // means two concurrent sweeps cannot both insert the same row;
    // ON CONFLICT DO NOTHING avoids a thrown unique-violation.
    let inserted = 0;
    for (const c of candidates) {
      const result = await db
        .insert(employerSlaBreachesTable)
        .values({
          employerId: emp.id,
          applicationId: c.applicationId,
        })
        .onConflictDoNothing({
          target: employerSlaBreachesTable.applicationId,
        })
        .returning({ id: employerSlaBreachesTable.id });
      if (result.length > 0) {
        inserted += 1;
        newBreaches += 1;
      }
    }

    // Rolling 30-day total — evaluated EVERY tick, not only when
    // we just inserted. This way an interrupted previous sweep
    // (e.g. process crashed between insert and update) still
    // eventually fires revoke/warn on the next tick.
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const recent = await db
      .select({ id: employerSlaBreachesTable.id })
      .from(employerSlaBreachesTable)
      .where(
        and(
          eq(employerSlaBreachesTable.employerId, emp.id),
          gte(employerSlaBreachesTable.breachedAt, since),
        ),
      );

    if (recent.length >= 2) {
      const until = new Date(Date.now() + THIRTY_DAYS_MS);
      await db
        .update(employersTable)
        .set({
          fastTrackEnabled: false,
          fastTrackRevokedUntil: until,
        })
        .where(eq(employersTable.id, emp.id));
      await notifyEmployerStaff(
        emp.id,
        emp.name,
        "fast_track_revoked",
        "Fast-Track pledge revoked",
        `Your 48-hour response pledge was revoked after ${recent.length} breaches in the last 30 days. You can re-enable it on ${until.toLocaleDateString()}.`,
        recent.length,
        until,
      );
      revoked += 1;
    } else if (inserted > 0 && recent.length === 1) {
      // Only send the warning on the tick where the breach was
      // newly recorded, so we don't spam an employer hourly while
      // the one breach is still in the window.
      await notifyEmployerStaff(
        emp.id,
        emp.name,
        "fast_track_warning",
        "Fast-Track SLA warning",
        `An application waited longer than 48 hours. One more breach in the next 30 days will revoke your Fast-Track badge.`,
        recent.length,
      );
      warned += 1;
    }
  }

  if (employers.length > 0) {
    logger.info(
      { scanned: employers.length, newBreaches, warned, revoked },
      "Fast-Track SLA sweep complete",
    );
  }

  return {
    scannedEmployers: employers.length,
    newBreaches,
    warned,
    revoked,
  };
}
