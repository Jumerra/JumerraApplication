/**
 * Email delivery layer.
 *
 * Currently a stub: email integration (Resend) will be wired in once the
 * connector is installed. Until then, every "send" call logs the link and
 * returns `{ sent: false, reason: "not-configured" }` so callers can fall
 * back to surfacing the link in the admin UI / for the user to recover.
 */

import type { Logger } from "pino";

export type EmailKind = "setup" | "reset" | "weekly_digest" | "saved_search_alert";

export type SendResult =
  | { sent: true; provider: string }
  | { sent: false; reason: string };

export interface SendAuthLinkArgs {
  to: string;
  fullName: string;
  /** Path-relative link, e.g. /setup-password?token=… */
  linkPath: string;
  kind: EmailKind;
  /** Absolute origin (https://app.example.com) — used to build the link. */
  origin: string;
  logger: Logger;
}

export async function sendAuthLinkEmail(
  args: SendAuthLinkArgs,
): Promise<SendResult> {
  const absoluteUrl = `${args.origin}${args.linkPath}`;

  // Logging policy:
  // - "setup" (admin-onboarding) links MAY appear in logs because the
  //   admin UI also displays them as a copyable fallback when email is
  //   not configured, so the admin already has the URL.
  // - "reset" (forgot-password) links MUST NOT be logged in plaintext —
  //   logging them would let anyone with log access take over the
  //   account by replaying the link. We log only the user, kind, and a
  //   short fingerprint of the token for audit/debugging.
  if (args.kind === "setup") {
    args.logger.info(
      { to: args.to, kind: args.kind, absoluteUrl },
      "auth link generated (setup)",
    );
  } else {
    const tokenFingerprint = args.linkPath.slice(-8);
    args.logger.info(
      { to: args.to, kind: args.kind, tokenFingerprint },
      "auth link generated (reset)",
    );
  }

  // TODO: once the Resend integration is connected, send via Resend here and
  // return { sent: true, provider: "resend" }.
  return { sent: false, reason: "email-not-configured" };
}

/**
 * Send a generic engagement email (weekly digest, saved-search alerts).
 *
 * Routes through the same provider-stub policy as `sendAuthLinkEmail`:
 * if no provider is configured we log a redacted line (kind + audience
 * id, never the email body or address) and return
 * `{ sent: false, reason: "email-not-configured" }` so callers can
 * persist the attempt without leaking PII.
 *
 * Returning `SendResult` (instead of throwing) lets the worker mark the
 * digest row as "delivery attempted" and replay later when a provider
 * is wired up — this is the contract the engagement worker depends on.
 */
export interface SendEngagementEmailArgs {
  to: string;
  kind: "weekly_digest" | "saved_search_alert";
  subject: string;
  /** Plain-text body. The provider stub never logs or transmits this. */
  body: string;
  candidateId: number;
  logger: Logger;
}

export async function sendEngagementEmail(
  args: SendEngagementEmailArgs,
): Promise<SendResult> {
  // Policy: never log the email body or recipient address — those are
  // PII / engagement content. We log only the candidate id + kind so an
  // operator can see the attempt happened.
  args.logger.info(
    { candidateId: args.candidateId, kind: args.kind },
    "engagement email queued (provider not configured)",
  );

  // TODO: once the Resend integration is connected, send via Resend here
  // and return { sent: true, provider: "resend" }.
  return { sent: false, reason: "email-not-configured" };
}

/**
 * Send a candidate-facing endorsement email when their institution
 * co-signs one of their applications.
 *
 * Follows the same stub pattern as the other senders in this file:
 * when no provider is configured we log a redacted line (candidateId
 * + institutionId, never the recipient address) and return
 * `{ sent: false, reason: "email-not-configured" }`. Callers should
 * use this *in addition* to the in-app/push dispatcher in
 * `notifier.ts` — the dispatcher covers the in-app bell + native
 * push; this covers the email channel that the product requirement
 * explicitly calls for.
 */
export interface SendEndorsementEmailArgs {
  to: string;
  candidateId: number;
  candidateName: string;
  institutionId: number;
  institutionName: string;
  jobTitle: string;
  note: string | null;
  applicationLink: string;
  logger: Logger;
}

export async function sendEndorsementEmail(
  args: SendEndorsementEmailArgs,
): Promise<SendResult> {
  // Policy: log only ids — never the recipient address, the note, or
  // the candidate's name (PII). An operator should still be able to
  // confirm the attempt happened end-to-end.
  args.logger.info(
    {
      candidateId: args.candidateId,
      institutionId: args.institutionId,
      kind: "application_endorsed",
    },
    "endorsement email queued (provider not configured)",
  );

  // TODO: once the Resend integration is connected, send via Resend
  // here and return { sent: true, provider: "resend" }. Until then,
  // the in-app + push notification dispatched alongside this call
  // ensures the candidate still hears about the endorsement.
  return { sent: false, reason: "email-not-configured" };
}

/**
 * Send a Fast-Track SLA email to an employer staff member.
 *
 * Kinds:
 *   - "fast_track_warning": one breach in the rolling 30d window
 *   - "fast_track_revoked": auto-revoke after >=2 breaches
 *
 * Same stub policy as the other senders — when no provider is wired
 * we log only ids (never the recipient address) and return
 * `{ sent: false, reason: "email-not-configured" }`. Pairs with the
 * in-app notification dispatched alongside.
 */
export interface SendFastTrackEmailArgs {
  to: string;
  employerId: number;
  employerName: string;
  userId: number;
  kind: "fast_track_warning" | "fast_track_revoked";
  breachCount: number;
  /** ISO timestamp; only present for the revoke kind. */
  revokedUntil?: string;
  logger: Logger;
}

export async function sendFastTrackEmail(
  args: SendFastTrackEmailArgs,
): Promise<SendResult> {
  args.logger.info(
    {
      employerId: args.employerId,
      userId: args.userId,
      kind: args.kind,
      breachCount: args.breachCount,
    },
    "fast-track email queued (provider not configured)",
  );
  return { sent: false, reason: "email-not-configured" };
}

/** Convenience helper to derive an absolute origin from an Express request. */
export function originFromReq(req: {
  protocol: string;
  get: (h: string) => string | undefined;
}): string {
  const proto =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.protocol;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}
