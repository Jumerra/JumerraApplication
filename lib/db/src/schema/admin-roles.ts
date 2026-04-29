import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { employersTable } from "./employers";
import { institutionsTable } from "./institutions";

/**
 * Generalized roles table. Originally `admin_roles`; now also stores
 * per-employer and per-institution role definitions, scoped via the
 * `scope` column plus the appropriate org foreign key.
 *
 * Column rules:
 *   - scope='admin'        → employer_id IS NULL AND institution_id IS NULL
 *   - scope='employer'     → employer_id IS NOT NULL
 *   - scope='institution'  → institution_id IS NOT NULL
 *
 * Uniqueness is enforced via three partial indexes — one per scope —
 * so that the same role name (e.g. "owner") can exist concurrently in
 * many different orgs without collision, while staying unique inside
 * one org. The application layer is the source of truth for these
 * shape rules; the DB enforces only the uniqueness piece.
 *
 * Table name is preserved (`admin_roles`) to avoid a destructive
 * rename in `db:push --force`.
 */
export const adminRolesTable = pgTable(
  "admin_roles",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull().default("admin"),
    employerId: integer("employer_id").references(() => employersTable.id, {
      onDelete: "cascade",
    }),
    institutionId: integer("institution_id").references(
      () => institutionsTable.id,
      { onDelete: "cascade" },
    ),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scopeIdx: index("admin_roles_scope_idx").on(t.scope),
    employerIdx: index("admin_roles_employer_idx").on(t.employerId),
    institutionIdx: index("admin_roles_institution_idx").on(t.institutionId),
    adminScopeNameUnique: uniqueIndex("admin_roles_admin_scope_name_unique")
      .on(t.name)
      .where(sql`${t.scope} = 'admin'`),
    employerScopeNameUnique: uniqueIndex(
      "admin_roles_employer_scope_name_unique",
    )
      .on(t.employerId, t.name)
      .where(sql`${t.scope} = 'employer'`),
    institutionScopeNameUnique: uniqueIndex(
      "admin_roles_institution_scope_name_unique",
    )
      .on(t.institutionId, t.name)
      .where(sql`${t.scope} = 'institution'`),
  }),
);

/**
 * Permission grants. Each row is "this role has this permission".
 * The full permission catalog lives in code (lib/permissions.ts) so we
 * can rename / introduce permissions without a migration.
 */
export const adminRolePermissionsTable = pgTable(
  "admin_role_permissions",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => adminRolesTable.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permission] }),
    roleIdx: index("admin_role_perm_role_idx").on(t.roleId),
  }),
);

// Generalized aliases — preferred for new code.
export const rolesTable = adminRolesTable;
export const rolePermissionsTable = adminRolePermissionsTable;

export type AdminRole = typeof adminRolesTable.$inferSelect;
export type InsertAdminRole = typeof adminRolesTable.$inferInsert;
export type AdminRolePermission =
  typeof adminRolePermissionsTable.$inferSelect;

export type RoleScope = "admin" | "employer" | "institution";
