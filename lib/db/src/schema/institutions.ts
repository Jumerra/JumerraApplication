import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const institutionsTable = pgTable(
  "institutions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    location: text("location").notNull(),
    logoUrl: text("logo_url").notNull(),
    websiteUrl: text("website_url").notNull(),
    description: text("description").notNull(),
    slug: text("slug"),
    /**
     * Admin user (`role='admin' AND org_role='account_manager'`) who
     * "owns" this institution in the platform-admin CRM sense. See
     * employers.account_manager_id for the full rationale. Nullable;
     * ON DELETE SET NULL.
     */
    accountManagerId: integer("account_manager_id").references(
      (): AnyPgColumn => usersTable.id,
      { onDelete: "set null" },
    ),
    /**
     * Whether the public cohort placement leaderboard at
     * `/institutions/:id/leaderboard` is browseable by anonymous
     * visitors. Defaults to true so institutions opt-in by default
     * (drives SEO + recruiting visibility). Owners can flip it off
     * from the institution-edit page; admin staff can flip it from
     * the admin institution edit screen.
     */
    publicLeaderboardEnabled: boolean("public_leaderboard_enabled")
      .notNull()
      .default(true),
    /**
     * Pro-only branded fields. Visible on the public institution
     * detail page; editable only when the institution has an active
     * Pro subscription (UI gates the edit form, server-side gating
     * lives on PATCH /institutions/me). Nullable so Starter orgs
     * simply omit them from the page.
     */
    bannerUrl: text("banner_url"),
    featuredPrograms: jsonb("featured_programs")
      .$type<Array<{ title: string; description: string }>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete marker. Null = active. See lib/soft-delete.ts.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // User id of the admin who soft-deleted this row (audit trail).
    deletedBy: integer("deleted_by"),
  },
  (t) => ({
    institutionAccountManagerIdx: index(
      "institution_account_manager_idx",
    ).on(t.accountManagerId),
    institutionSlugIdx: uniqueIndex("institution_slug_idx").on(t.slug),
  }),
);

export type Institution = typeof institutionsTable.$inferSelect;
export type InsertInstitution = typeof institutionsTable.$inferInsert;

/**
 * Academic faculties (a.k.a. schools/colleges) owned by an institution.
 * A faculty groups multiple departments, e.g. "Faculty of Engineering"
 * contains "Department of Computer Engineering". Senior High Schools
 * typically don't use faculties, so this layer is optional — every
 * institution_departments row may or may not have a parent faculty.
 *
 * Cascades on institution delete.
 */
export const institutionFacultiesTable = pgTable(
  "institution_faculties",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    deanName: text("dean_name"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    institutionFacultyInstIdx: index("institution_faculty_inst_idx").on(
      t.institutionId,
    ),
    institutionFacultyUniqueName: uniqueIndex(
      "institution_faculty_inst_name_idx",
    ).on(t.institutionId, t.name),
  }),
);

export type InstitutionFaculty = typeof institutionFacultiesTable.$inferSelect;
export type InsertInstitutionFaculty =
  typeof institutionFacultiesTable.$inferInsert;

/**
 * Academic departments owned by an institution. Cascades on parent
 * delete so an institution removal cleans up its sub-resources.
 *
 * `facultyId` is optional: it groups departments under an academic
 * faculty for permission scoping (a Dean assigned to a faculty can
 * see candidates across every department under it). Set NULL on
 * faculty delete so departments aren't orphaned.
 */
export const institutionDepartmentsTable = pgTable(
  "institution_departments",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    facultyId: integer("faculty_id").references(
      (): AnyPgColumn => institutionFacultiesTable.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    code: text("code"),
    headName: text("head_name"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    institutionDeptInstIdx: index("institution_dept_inst_idx").on(
      t.institutionId,
    ),
    institutionDeptFacultyIdx: index("institution_dept_faculty_idx").on(
      t.facultyId,
    ),
    institutionDeptUniqueName: uniqueIndex(
      "institution_dept_inst_name_idx",
    ).on(t.institutionId, t.name),
  }),
);

export type InstitutionDepartment =
  typeof institutionDepartmentsTable.$inferSelect;
export type InsertInstitutionDepartment =
  typeof institutionDepartmentsTable.$inferInsert;

/**
 * Physical/virtual facilities operated by an institution (libraries,
 * labs, auditoriums, dormitories, etc). Cascades on parent delete.
 */
export const institutionFacilitiesTable = pgTable(
  "institution_facilities",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    location: text("location"),
    description: text("description"),
    capacity: integer("capacity"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    institutionFacilityInstIdx: index("institution_facility_inst_idx").on(
      t.institutionId,
    ),
    institutionFacilityUniqueName: uniqueIndex(
      "institution_facility_inst_name_idx",
    ).on(t.institutionId, t.name),
  }),
);

export type InstitutionFacility =
  typeof institutionFacilitiesTable.$inferSelect;
export type InsertInstitutionFacility =
  typeof institutionFacilitiesTable.$inferInsert;
