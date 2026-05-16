import {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { employersTable } from "./employers";
import { applicationsTable } from "./applications";

/**
 * Audit table for the Fast-Track pledge (task #76).
 *
 * One row per (employer, application) breach. A breach is recorded when
 * an application has been sitting in a "no-action" status (submitted /
 * new / applied) for more than 48 hours without the employer responding.
 *
 * The sweep is idempotent: it only inserts for applications it hasn't
 * already flagged. ON DELETE CASCADE keeps the table tidy if an
 * application is removed.
 */
export const employerSlaBreachesTable = pgTable(
  "employer_sla_breaches",
  {
    id: serial("id").primaryKey(),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employersTable.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    breachedAt: timestamp("breached_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // The rolling-window query is "all breaches for employer X in the
    // last 30 days" — the composite (employerId, breachedAt) index is
    // exactly what that needs.
    perEmployerIdx: index("sla_breaches_employer_idx").on(
      t.employerId,
      t.breachedAt,
    ),
    // Hard uniqueness on application_id makes the sweep insert
    // atomically idempotent — two concurrent sweeps cannot
    // double-count the same application. Combined with
    // ON CONFLICT DO NOTHING this removes the read-then-write race.
    perApplicationIdx: uniqueIndex("sla_breaches_application_uq").on(
      t.applicationId,
    ),
  }),
);

export type EmployerSlaBreach = typeof employerSlaBreachesTable.$inferSelect;
export type InsertEmployerSlaBreach =
  typeof employerSlaBreachesTable.$inferInsert;
