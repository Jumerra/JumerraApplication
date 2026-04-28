/**
 * Email delivery layer.
 *
 * Currently a stub: email integration (Resend) will be wired in once the
 * connector is installed. Until then, every "send" call logs the link and
 * returns `{ sent: false, reason: "not-configured" }` so callers can fall
 * back to surfacing the link in the admin UI / for the user to recover.
 */

import type { Logger } from "pino";

export type EmailKind = "setup" | "reset";

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
