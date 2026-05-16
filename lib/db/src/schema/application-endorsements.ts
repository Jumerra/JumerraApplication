import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { applicationsTable } from "./applications";
import { institutionsTable } from "./institutions";
import { usersTable } from "./auth";

/**
 * Institution co-sign on a candidate application. One row per
 * application (UNIQUE on applicationId — an application is endorsed
 * by exactly one institution; "best Year-3 CS student"). Persists
 * the endorsing institution, the staff member who clicked the
 * button, an optional one-line note, and the timestamp. Removing
 * the endorsement is a hard delete; we don't keep a history.
 *
 * FK rules:
 *   - applicationId CASCADE: if the application is deleted, drop
 *     the endorsement.
 *   - institutionId CASCADE: keeps the table consistent with the
 *     rest of the institution-scoped schemas (an institution being
 *     fully removed is destructive enough that endorsements going
 *     with it is the right behaviour).
 *   - endorsedByUserId SET NULL: staff turnover happens; we still
 *     want to show "Verified by [Institution]" even after the
 *     individual leaves. The badge attribution is the institution,
 *     not the person.
 */
export const applicationEndorsementsTable = pgTable(
  "application_endorsements",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    endorsedByUserId: integer("endorsed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    appEndorsementUnique: uniqueIndex("app_endorsement_unique").on(
      t.applicationId,
    ),
    appEndorsementInstIdx: index("app_endorsement_inst_idx").on(
      t.institutionId,
    ),
  }),
);

export type ApplicationEndorsement =
  typeof applicationEndorsementsTable.$inferSelect;
export type InsertApplicationEndorsement =
  typeof applicationEndorsementsTable.$inferInsert;
