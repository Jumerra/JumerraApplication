import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
    /**
     * Admin user (`role='admin' AND org_role='account_manager'`) who
     * "owns" this institution in the platform-admin CRM sense. See
     * employers.account_manager_id for the full rationale. Nullable;
     * ON DELETE SET NULL.
     */
    accountManagerId: integer("account_manager_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    institutionAccountManagerIdx: index(
      "institution_account_manager_idx",
    ).on(t.accountManagerId),
  }),
);

export type Institution = typeof institutionsTable.$inferSelect;
export type InsertInstitution = typeof institutionsTable.$inferInsert;

/**
 * Academic departments owned by an institution. Cascades on parent
 * delete so an institution removal cleans up its sub-resources.
 */
export const institutionDepartmentsTable = pgTable(
  "institution_departments",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id, { onDelete: "cascade" }),
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
