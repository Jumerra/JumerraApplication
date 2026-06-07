import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Government ministry accounts (oversight tenants). Created exclusively
 * by platform super-admins — there is NO self-onboarding path. Each
 * ministry account links to one or more `users` rows (role='ministry',
 * ministry_id = this row) who sign in to a read-only oversight
 * dashboard.
 *
 * type:
 *   - 'education' : Ministry of Education. Tracks how each university /
 *                   college / school performs at placing its students.
 *   - 'labour'   : Ministry of Labour. National labour-market overview
 *                   (jobs, hiring, salary/wage insights, employer
 *                   activity, skills demand).
 *
 * dataAccess is the per-ministry allowlist of dashboard data-scope keys
 * (see lib/ministry-scopes.ts). The super-admin toggles which slices a
 * ministry may view; the dashboard only returns/renders permitted
 * sections. Every figure surfaced to a ministry is an AGGREGATE — no
 * individual candidate names or contact details are ever exposed.
 */
export const ministriesTable = pgTable("ministries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'education' | 'labour'
  dataAccess: text("data_access").array().notNull().default([]),
  // Admin user id who created this ministry (audit trail). Nullable.
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Soft-delete marker. Null = active. When set, the ministry's users
  // are also disabled so they can no longer sign in.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Ministry = typeof ministriesTable.$inferSelect;
export type InsertMinistry = typeof ministriesTable.$inferInsert;
