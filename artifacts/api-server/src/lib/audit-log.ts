import { db, adminAuditLogTable } from "@workspace/db";
import type { RestoreEntity } from "./signed-restore-link";

export type AuditAction = "restore" | "delete";
export type AuditSource = "dashboard" | "email-link";

export interface RecordAuditArgs {
  action: AuditAction;
  entity: RestoreEntity;
  entityId: number;
  source: AuditSource;
  /** User id of the actor when known (dashboard actions). */
  actorUserId?: number | null;
  /** Snapshot of the actor's display name at action time. */
  actorName?: string | null;
  /** Short fingerprint of the signed token, for email-link actions. */
  tokenFingerprint?: string | null;
}

/**
 * Append one row to the admin audit log. Best-effort: a failure to
 * write the audit row must never block or roll back the underlying
 * delete/restore (which has its own success path), so callers should
 * await this and let it throw only into a try/catch they already own,
 * or call `recordAuditSafe` which swallows + logs the error.
 */
export async function recordAudit(args: RecordAuditArgs): Promise<void> {
  await db.insert(adminAuditLogTable).values({
    action: args.action,
    entity: args.entity,
    entityId: args.entityId,
    source: args.source,
    actorUserId: args.actorUserId ?? null,
    actorName: args.actorName ?? null,
    tokenFingerprint: args.tokenFingerprint ?? null,
  });
}

/**
 * Fire-and-forget variant: never throws. Use it from happy paths where
 * the primary mutation already succeeded and we don't want an audit
 * write failure to turn a successful restore into a 500.
 */
export async function recordAuditSafe(
  args: RecordAuditArgs,
  logger?: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  try {
    await recordAudit(args);
  } catch (err) {
    logger?.error({ err, audit: args }, "failed to write admin audit log");
  }
}

/**
 * Short, non-reversible fingerprint of a signed restore token. We store
 * only the last 8 chars so an investigation can correlate an email-link
 * restore with the specific warning email, without persisting anything
 * that could re-authorize a restore.
 */
export function fingerprintToken(token: string): string {
  return token.slice(-8);
}
