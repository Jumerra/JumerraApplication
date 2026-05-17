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

import { and, isNotNull, lt } from "drizzle-orm";
import {
  db,
  candidatesTable,
  employersTable,
  institutionsTable,
} from "@workspace/db";
import { logger } from "./logger";

const DEFAULT_RETENTION_DAYS = 30;
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

const ONE_DAY = ONE_DAY_MS;
let started = false;

export function startTrashPurgeScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await runTrashPurgeSweep();
    } catch (err) {
      logger.error({ err }, "Trash purge sweep crashed");
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
