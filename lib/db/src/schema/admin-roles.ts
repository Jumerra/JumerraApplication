import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/**
 * Admin sub-roles. Distinct from `users.org_role` (which is a free-text
 * label kept in sync with `admin_roles.name` for admin users) so the
 * super-admin can create new role names and edit their permission sets
 * at runtime.
 *
 * `is_system` rows (super_admin, support, account_manager, finance,
 * hr, operations) cannot be renamed or deleted; only their permission
 * set may be edited.
 */
export const adminRolesTable = pgTable(
  "admin_roles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull().default(""),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
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

export type AdminRole = typeof adminRolesTable.$inferSelect;
export type InsertAdminRole = typeof adminRolesTable.$inferInsert;
export type AdminRolePermission =
  typeof adminRolePermissionsTable.$inferSelect;
