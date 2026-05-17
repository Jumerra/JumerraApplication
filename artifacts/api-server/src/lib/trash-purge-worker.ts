/**
 * Trash auto-purge worker.
 *
 * Soft-deleted candidates, employers, and institutions sit in their
 * tables indefinitely with `deleted_at IS NOT NULL`. Without a sweeper
 * the trash grows unbounded and old PII lingers past any reasonable
 * retention window. This worker hard-deletes any row whose `deleted_at`
 * is older than the configured retention window (default 30 days).
 *
 * Retention is configurable via `TRASH_RETENTION_DAYS` — admins who
 * want a different recovery window only have to set the env var, no
 * code change required. Values < 1 are clamped to 1 to keep the sweep
 * from ever deleting freshly-trashed rows that an admin might still
 * want to restore in the same hour.
 *
 * The sweep runs in-process every 24h (with a one-time delayed run on
 * boot) — same pattern as the engagement scheduler. Replit's runtime
 * doesn't expose cron, and we're a single-instance deployment, so a
 * timer is sufficient. A missed tick (process restart) just catches up
 * on the next interval — purging is idempotent.
 *
 * Hard-delete cascades follow each table's existing FK policy
 * (ON DELETE CASCADE / SET NULL declared in the schema). We don't try
 * to be clever here: if a soft-deleted row has children that should
 * have been cleaned earlier, the schema-level cascade handles them.
 */

import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import {
  db,
  candidatesTable,
  employersTable,
  institutionsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  sendTrashPurgeWarningEmail,
  sendTrashPurgeFailureEmail,
  originForBackground,
  type TrashPurgeWarningGroup,
} from "./email";
import { getUserPermissions, isImplicitAllUser } from "./permissions";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_WARNING_LEAD_DAYS = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the retention window in days. Reads `TRASH_RETENTION_DAYS`
 * if set; falls back to the 30-day default. Parsing is **fail-safe**
 * for a destructive job: a non-numeric value (e.g. `"30d"`) or a
 * blank/whitespace value falls back to the 30-day default rather than
 * collapsing to a 1-day purge. Valid numeric values below 1 are still
 * clamped up to 1 (an intentional "minimum 1 day" policy).
 */
export function getTrashRetentionDays(): number {
  const raw = process.env["TRASH_RETENTION_DAYS"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  // Number("30d") === NaN; Number("") === 0; reject both → use default
  // so a typo can never silently shrink retention.
  if (!Number.isFinite(n)) {
    logger.warn(
      { raw },
      "TRASH_RETENTION_DAYS is not a number — falling back to default 30 days",
    );
    return DEFAULT_RETENTION_DAYS;
  }
  if (n < 1) return 1;
  return Math.floor(n);
}

/**
 * Resolve the warning lead time in days (how many days before the
 * scheduled hard-delete admins receive the heads-up email). Reads
 * `TRASH_PURGE_WARNING_LEAD_DAYS` if set; falls back to a 3-day
 * default. Fail-safe parsing matches `getTrashRetentionDays`: a
 * non-numeric or empty value reverts to the default, values < 1 are
 * clamped to 1. Additionally, a lead-time >= the retention window is
 * clamped to `retention - 1` so the sweep window stays non-empty
 * (otherwise the same row would be both warned-on and purged on the
 * same tick).
 */
export function getTrashPurgeWarningLeadDays(retentionDays?: number): number {
  const retention = retentionDays ?? getTrashRetentionDays();
  const raw = process.env["TRASH_PURGE_WARNING_LEAD_DAYS"];
  let lead = DEFAULT_WARNING_LEAD_DAYS;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      logger.warn(
        { raw },
        "TRASH_PURGE_WARNING_LEAD_DAYS is not a number — falling back to default 3 days",
      );
    } else {
      lead = Math.max(1, Math.floor(n));
    }
  }
  // Keep the [retention-lead, retention-lead+1) sweep window strictly
  // before the purge cutoff. If lead >= retention the window would
  // sit in the future (no rows yet old enough to match) or overlap
  // the purge tick itself.
  if (lead >= retention) lead = Math.max(1, retention - 1);
  return lead;
}

interface PurgeResult {
  candidates: number;
  employers: number;
  institutions: number;
  cutoff: string;
}

export async function runTrashPurgeSweep(): Promise<PurgeResult> {
  const days = getTrashRetentionDays();
  const cutoff = new Date(Date.now() - days * ONE_DAY_MS);

  const deletedCandidates = await db
    .delete(candidatesTable)
    .where(
      and(
        isNotNull(candidatesTable.deletedAt),
        lt(candidatesTable.deletedAt, cutoff),
      ),
    )
    .returning({ id: candidatesTable.id });

  const deletedEmployers = await db
    .delete(employersTable)
    .where(
      and(
        isNotNull(employersTable.deletedAt),
        lt(employersTable.deletedAt, cutoff),
      ),
    )
    .returning({ id: employersTable.id });

  const deletedInstitutions = await db
    .delete(institutionsTable)
    .where(
      and(
        isNotNull(institutionsTable.deletedAt),
        lt(institutionsTable.deletedAt, cutoff),
      ),
    )
    .returning({ id: institutionsTable.id });

  const result: PurgeResult = {
    candidates: deletedCandidates.length,
    employers: deletedEmployers.length,
    institutions: deletedInstitutions.length,
    cutoff: cutoff.toISOString(),
  };

  const total = result.candidates + result.employers + result.institutions;
  if (total > 0) {
    logger.info(
      { ...result, retentionDays: days },
      "trash-purge: hard-deleted expired soft-deleted rows",
    );
  } else {
    logger.debug(
      { ...result, retentionDays: days },
      "trash-purge: nothing to purge",
    );
  }
  return result;
}

interface WarningItem {
  id: number;
  label: string;
  secondary: string | null;
  /** ISO timestamp the row will be hard-deleted. */
  purgeOn: string;
}

interface WarningSweepResult {
  candidates: WarningItem[];
  employers: WarningItem[];
  institutions: WarningItem[];
  /** Number of admin recipients that received the heads-up. */
  recipients: number;
  windowStart: string;
  windowEnd: string;
  leadDays: number;
}

/**
 * Find soft-deleted rows that will be hard-deleted on the next
 * `runTrashPurgeSweep()` tick ~`leadDays` from now, and email each
 * admin who could still restore them a single roll-up. Window is
 * `[retention - leadDays, retention - leadDays + 1)` days ago — a
 * one-day slice so each row receives **at most one** warning across
 * the lifetime of the trash row. Designed to be safe to run from
 * the same daily timer as the purge sweep itself.
 */
export async function runTrashPurgeWarningsSweep(): Promise<WarningSweepResult> {
  const retentionDays = getTrashRetentionDays();
  const leadDays = getTrashPurgeWarningLeadDays(retentionDays);
  const now = Date.now();
  // Rows whose deleted_at is at least (retention - lead) days old will
  // be purged within `lead` days. The +1 day upper bound on the
  // deleted_at window is what makes this a "one notification per row"
  // sweep when the timer ticks once per day.
  const windowEnd = new Date(now - (retentionDays - leadDays) * ONE_DAY_MS);
  const windowStart = new Date(
    now - (retentionDays - leadDays + 1) * ONE_DAY_MS,
  );

  const candidateRows = await db
    .select({
      id: candidatesTable.id,
      label: candidatesTable.fullName,
      secondary: candidatesTable.email,
      deletedAt: candidatesTable.deletedAt,
    })
    .from(candidatesTable)
    .where(
      and(
        isNotNull(candidatesTable.deletedAt),
        gte(candidatesTable.deletedAt, windowStart),
        lt(candidatesTable.deletedAt, windowEnd),
      ),
    );

  const employerRows = await db
    .select({
      id: employersTable.id,
      label: employersTable.name,
      secondary: employersTable.industry,
      deletedAt: employersTable.deletedAt,
    })
    .from(employersTable)
    .where(
      and(
        isNotNull(employersTable.deletedAt),
        gte(employersTable.deletedAt, windowStart),
        lt(employersTable.deletedAt, windowEnd),
      ),
    );

  const institutionRows = await db
    .select({
      id: institutionsTable.id,
      label: institutionsTable.name,
      secondary: institutionsTable.location,
      deletedAt: institutionsTable.deletedAt,
    })
    .from(institutionsTable)
    .where(
      and(
        isNotNull(institutionsTable.deletedAt),
        gte(institutionsTable.deletedAt, windowStart),
        lt(institutionsTable.deletedAt, windowEnd),
      ),
    );

  const toWarningItem = (r: {
    id: number;
    label: string | null;
    secondary: string | null;
    deletedAt: Date | null;
  }): WarningItem => ({
    id: r.id,
    label: r.label ?? `#${r.id}`,
    secondary: r.secondary,
    purgeOn: new Date(
      (r.deletedAt?.getTime() ?? now) + retentionDays * ONE_DAY_MS,
    ).toISOString(),
  });

  const result: WarningSweepResult = {
    candidates: candidateRows.map(toWarningItem),
    employers: employerRows.map(toWarningItem),
    institutions: institutionRows.map(toWarningItem),
    recipients: 0,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    leadDays,
  };

  const total =
    result.candidates.length +
    result.employers.length +
    result.institutions.length;
  if (total === 0) {
    logger.debug(
      { leadDays, retentionDays },
      "trash-purge-warnings: nothing maturing in this window",
    );
    return result;
  }

  // Find admin accounts that could still restore the listed rows.
  // We pull all active admins (small population) and filter by their
  // computed permission set so a finance/support admin without any
  // *:manage perm doesn't get pinged about something they can't act on.
  const adminUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      orgRole: usersTable.orgRole,
      candidateId: usersTable.candidateId,
      employerId: usersTable.employerId,
      institutionId: usersTable.institutionId,
      assignedDepartmentId: usersTable.assignedDepartmentId,
      assignedFacultyId: usersTable.assignedFacultyId,
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.status, "active")));

  const dashboardUrl = `${originForBackground()}/dashboard/admin/trash`;
  let recipients = 0;

  for (const u of adminUsers) {
    // `getUserPermissions` accepts the User row shape; the few columns
    // we don't select default to null on `User`, but the helper only
    // touches role/orgRole/employerId/institutionId so the cast is safe.
    const implicit = isImplicitAllUser(u as never);
    const perms = implicit ? null : await getUserPermissions(u as never);

    const groups: TrashPurgeWarningGroup[] = [];
    if (
      result.candidates.length > 0 &&
      (implicit || perms?.has("candidates:manage"))
    ) {
      groups.push({ label: "Candidates", items: result.candidates });
    }
    if (
      result.employers.length > 0 &&
      (implicit || perms?.has("employers:manage"))
    ) {
      groups.push({ label: "Employers", items: result.employers });
    }
    if (
      result.institutions.length > 0 &&
      (implicit || perms?.has("institutions:manage"))
    ) {
      groups.push({ label: "Institutions", items: result.institutions });
    }

    if (groups.length === 0) continue;

    recipients += 1;
    const send = await sendTrashPurgeWarningEmail({
      to: u.email,
      recipientName: u.fullName,
      leadDays,
      groups,
      dashboardUrl,
      logger,
    });
    if (!send.sent) {
      logger.warn(
        { userId: u.id, reason: send.reason },
        "trash-purge-warnings: heads-up email not delivered",
      );
    }
  }

  result.recipients = recipients;
  logger.info(
    {
      candidates: result.candidates.length,
      employers: result.employers.length,
      institutions: result.institutions.length,
      recipients,
      leadDays,
      retentionDays,
    },
    "trash-purge-warnings: heads-up sweep complete",
  );
  return result;
}

const ONE_DAY = ONE_DAY_MS;
let started = false;

// Module-scoped rate-limit timestamp for failure alerts. Resend's free
// tier and humans alike will quickly stop reading a flood of identical
// "purge failed" emails if the underlying error is persistent (e.g. a
// migration mismatch). We cap to one alert per 24h so a wedged worker
// can't generate dozens of duplicate emails per day; once a human
// resolves the underlying issue, a process restart resets the clock
// (the in-memory timestamp is intentionally not persisted — alerts
// after a restart are a useful "still broken" signal).
let lastFailureAlertAt = 0;
const FAILURE_ALERT_COOLDOWN_MS = ONE_DAY_MS;

/** Exposed for tests so they can reset the cooldown between cases. */
export function _resetTrashPurgeFailureAlertState(): void {
  lastFailureAlertAt = 0;
}

/**
 * Send an admin alert when the purge sweep throws. No-op when:
 *  - `TRASH_PURGE_ALERT_EMAIL` is unset (no recipient configured), or
 *  - we already sent an alert within the cooldown window, or
 *  - `RESEND_API_KEY` is unset (the dispatcher itself short-circuits
 *    in that case — see `lib/email.ts`).
 *
 * Returns `true` if a dispatch was attempted (rate-limit accounting
 * happens whenever a dispatch is attempted, even if the dispatcher
 * itself short-circuits, so a missing API key doesn't burn the slot).
 */
export async function notifyTrashPurgeFailure(err: unknown): Promise<boolean> {
  const to = process.env["TRASH_PURGE_ALERT_EMAIL"]?.trim();
  if (!to) return false;
  const now = Date.now();
  if (now - lastFailureAlertAt < FAILURE_ALERT_COOLDOWN_MS) {
    logger.debug(
      { sinceLastAlertMs: now - lastFailureAlertAt },
      "trash-purge: failure alert suppressed by 24h cooldown",
    );
    return false;
  }
  lastFailureAlertAt = now;
  const errorMessage =
    err instanceof Error ? err.message : String(err ?? "unknown error");
  const errorStack = err instanceof Error ? err.stack ?? null : null;
  try {
    await sendTrashPurgeFailureEmail({
      to,
      errorMessage,
      errorStack,
      occurredAt: new Date(now).toISOString(),
      logger,
    });
  } catch (sendErr) {
    // Never let the alerter itself crash the scheduler tick.
    logger.warn(
      { err: sendErr },
      "trash-purge: failed to send failure alert email",
    );
  }
  return true;
}

export function startTrashPurgeScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      // Warn first so admins see the heads-up before the same tick
      // ever hard-deletes anything (in practice the warning window
      // sits `leadDays` ahead of the purge cutoff so the two never
      // act on the same row anyway).
      await runTrashPurgeWarningsSweep();
    } catch (err) {
      logger.error({ err }, "Trash purge warning sweep crashed");
    }
    try {
      await runTrashPurgeSweep();
    } catch (err) {
      logger.error({ err }, "Trash purge sweep crashed");
      await notifyTrashPurgeFailure(err);
    }
  };

  // Defer the first sweep so it doesn't compete with boot work.
  setTimeout(() => {
    void tick();
  }, 90_000);
  setInterval(() => {
    void tick();
  }, ONE_DAY).unref();
}
