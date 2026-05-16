import { isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Soft-delete query helper.
 *
 * Every entity that should be reversible (`employers`, `jobs`,
 * `candidates`, `institutions`) carries a nullable `deleted_at`
 * timestamp. Callers compose this helper into their drizzle `where`
 * clauses to hide soft-deleted rows by default:
 *
 *   const rows = await db
 *     .select()
 *     .from(jobsTable)
 *     .where(and(notDeleted(jobsTable.deletedAt), eq(jobsTable.id, id)));
 *
 * Admin "trash" views opt-in to seeing soft-deleted rows by simply
 * omitting this clause (or by adding `isNotNull(table.deletedAt)`).
 * Restoring is a NULL UPDATE on `deleted_at`.
 *
 * FK references intentionally use `ON DELETE SET NULL` (data should
 * survive) or `ON DELETE CASCADE` (e.g. notifications) — soft-delete
 * is not a substitute for that explicit policy.
 */
export function notDeleted(col: PgColumn): SQL {
  return isNull(col);
}
