import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * T7: API keys minted by an institution owner so external SIS / IT
 * systems can read the verified-student roster via Bearer auth at
 * `GET /api/v1/institutions/students`.
 *
 * Only the SHA-256 of the key is stored — the plaintext is shown
 * exactly once at creation time. `prefix` (first 8 chars of the
 * plaintext) is kept un-hashed for UI display so users can identify
 * keys in the list / revoke the right one without revealing the key.
 *
 * `lastUsedAt` is bumped (best-effort) on every successful Bearer
 * request, giving owners a "stale key" signal in the UI.
 */
export const institutionApiKeysTable = pgTable(
  "institution_api_keys",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id").notNull(),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    institutionIdx: index("institution_api_keys_institution_idx").on(
      t.institutionId,
    ),
  }),
);

export type InstitutionApiKey = typeof institutionApiKeysTable.$inferSelect;
export type InsertInstitutionApiKey =
  typeof institutionApiKeysTable.$inferInsert;
