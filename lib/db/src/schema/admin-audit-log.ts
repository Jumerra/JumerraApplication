import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Audit trail for destructive + recovery actions on soft-deletable
 * rows (candidates, employers, institutions, jobs).
 *
 * Both delete and restore can happen through two very different paths:
 *  - "dashboard": a session-authenticated admin clicking in the trash
 *    console. The actor is known (`actorUserId` + `actorName`).
 *  - "email-link": the one-click restore link in the trash-purge
 *    warning email. That endpoint is intentionally session-less (the
 *    HMAC-signed token IS the authorization), so we have no user id.
 *    For these we record `source = 'email-link'` and a short
 *    `tokenFingerprint` (last chars of the signed token) so a "who
 *    undid this delete?" investigation can at least correlate the
 *    action with the specific email that was sent.
 *
 * This is an append-only log; rows are never updated. It is read back
 * by `GET /admin/trash/audit` to power the "recent restores" list.
 */
export const adminAuditLogTable = pgTable(
  "admin_audit_log",
  {
    id: serial("id").primaryKey(),
    /** "restore" | "delete". */
    action: text("action").notNull(),
    /** "candidate" | "employer" | "institution" | "job". */
    entity: text("entity").notNull(),
    entityId: integer("entity_id").notNull(),
    /**
     * "dashboard" (session admin) or "email-link" (signed restore
     * link, no session).
     */
    source: text("source").notNull(),
    /** User id of the actor when known. Null for email-link actions. */
    actorUserId: integer("actor_user_id"),
    /**
     * Snapshot of the actor's display name at action time. Denormalized
     * on purpose so the log stays readable even if the user is later
     * removed. Null for anonymous email-link actions.
     */
    actorName: text("actor_name"),
    /**
     * Short fingerprint (last chars) of the signed restore token, for
     * email-link actions only. Never the full token. Lets an
     * investigation tie the action back to a specific warning email
     * without storing anything that could re-authorize a restore.
     */
    tokenFingerprint: text("token_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byCreatedAt: index("admin_audit_log_created_at_idx").on(t.createdAt),
    byEntity: index("admin_audit_log_entity_idx").on(t.entity, t.entityId),
  }),
);

export type AdminAuditLogRow = typeof adminAuditLogTable.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLogTable.$inferInsert;
