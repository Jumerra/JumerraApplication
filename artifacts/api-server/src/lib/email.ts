/**
 * Email delivery layer (Resend-backed).
 *
 * All transactional senders in the platform go through this file.
 * When `RESEND_API_KEY` is set we hand off to the Resend SDK; when
 * it isn't (local dev, CI without secrets) we fall back to the
 * legacy stub policy of logging a redacted line and returning
 * `{ sent: false, reason: "email-not-configured" }` so callers can
 * surface a copy-paste fallback in the UI without breaking.
 *
 * Every send also goes through `renderEmailHtml()` so brand tweaks
 * (header, footer, primary colour) are a one-file change.
 */

import { Resend } from "resend";
import type { Logger } from "pino";
import { logger as rootLogger } from "./logger";
import { renderEmailHtml } from "./email-templates";

export type EmailKind =
  | "setup"
  | "reset"
  | "weekly_digest"
  | "saved_search_alert"
  | "trash_purge_warning";

export type SendResult =
  | { sent: true; provider: string; id: string | null }
  | { sent: false; reason: string };

const DEFAULT_FROM =
  process.env.EMAIL_DEFAULT_FROM ?? "Jumerra <onboarding@resend.dev>";
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? null;

let _resend: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Tags surfaced in the Resend dashboard for filtering. */
  tags?: { name: string; value: string }[];
  logger: Logger;
}

/**
 * Single dispatcher every higher-level helper routes through. Failures
 * are logged but never thrown — callers depend on `SendResult` so the
 * route can decide whether to surface a fallback (e.g. admin sees the
 * setup link when email is not configured).
 */
async function dispatch(opts: SendOpts): Promise<SendResult> {
  const resend = getResend();
  if (!resend) {
    // Never log the recipient address — emails are PII and route logs
    // are widely accessible. The subject is benign (no token contents)
    // so it's fine to keep for ops visibility.
    opts.logger.info(
      { subject: opts.subject, provider: "stub" },
      "email send skipped (RESEND_API_KEY not configured)",
    );
    return { sent: false, reason: "email-not-configured" };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: DEFAULT_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
    });
    if (error) {
      opts.logger.warn(
        { err: error, subject: opts.subject, provider: "resend" },
        "resend send failed",
      );
      return { sent: false, reason: error.message ?? "resend-error" };
    }
    return { sent: true, provider: "resend", id: data?.id ?? null };
  } catch (err) {
    opts.logger.warn(
      { err, subject: opts.subject, provider: "resend" },
      "resend send threw",
    );
    return { sent: false, reason: "resend-threw" };
  }
}

// ---------- Auth links (setup / reset) ----------

export interface SendAuthLinkArgs {
  to: string;
  fullName: string;
  /** Either a path (`/setup-password?token=…`) or a fully-qualified URL.
   * If a path is given `origin` is prepended. */
  linkPath: string;
  kind: EmailKind;
  /** Absolute origin (https://app.example.com) — used to build the link. */
  origin: string;
  logger: Logger;
}

export async function sendAuthLinkEmail(
  args: SendAuthLinkArgs,
): Promise<SendResult> {
  const absoluteUrl = /^https?:\/\//.test(args.linkPath)
    ? args.linkPath
    : `${args.origin}${args.linkPath}`;

  // Logging policy preserved from the stub era:
  //  - "setup" (admin onboarding) links MAY appear in logs because the
  //    admin UI also surfaces them as a copyable fallback when email is
  //    not configured, so the admin already has the URL.
  //  - "reset" (forgot password) links MUST NOT be logged in plaintext —
  //    logging them would let anyone with log access take over the
  //    account by replaying the link. We log only kind + a short
  //    fingerprint of the token for audit/debugging.
  if (args.kind === "setup") {
    args.logger.info(
      { kind: args.kind, absoluteUrl },
      "auth link generated (setup)",
    );
  } else {
    const tokenFingerprint = absoluteUrl.slice(-8);
    args.logger.info(
      { kind: args.kind, tokenFingerprint },
      "auth link generated (reset)",
    );
  }

  const isReset = args.kind === "reset";
  const subject = isReset
    ? "Reset your Jumerra password"
    : "Welcome to Jumerra — set your password";
  const heading = isReset ? "Reset your password" : "Welcome to Jumerra";
  const intro = isReset
    ? `Hi ${args.fullName}, we received a request to reset your password. Use the secure link below — it expires soon.`
    : `Hi ${args.fullName}, your Jumerra account has been created. Use the secure link below to choose a password and finish setting up your account.`;
  const cta = isReset ? "Reset password" : "Set your password";

  const html = renderEmailHtml({
    heading,
    body: `<p>${intro}</p>`,
    cta: { href: absoluteUrl, label: cta },
    footer: `If you didn't request this, you can safely ignore this email.`,
  });
  const text = `${intro}\n\n${cta}: ${absoluteUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  return dispatch({
    to: args.to,
    subject,
    html,
    text,
    tags: [{ name: "category", value: isReset ? "auth.reset" : "auth.setup" }],
    logger: args.logger,
  });
}

// ---------- Engagement / weekly digest ----------

export interface SendEngagementEmailArgs {
  to: string;
  kind: "weekly_digest" | "saved_search_alert";
  subject: string;
  /** Plain-text body assembled by the worker. We wrap it in our HTML
   * template (preserving line breaks) so we don't have to rebuild the
   * digest body in two places. */
  body: string;
  candidateId: number;
  logger: Logger;
}

export async function sendEngagementEmail(
  args: SendEngagementEmailArgs,
): Promise<SendResult> {
  args.logger.info(
    { candidateId: args.candidateId, kind: args.kind },
    "engagement email dispatch",
  );
  const safeBody = args.body
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br/>");
  const html = renderEmailHtml({
    heading: args.subject,
    body: `<p>${safeBody}</p>`,
    footer: `You can adjust your notification preferences any time from your Jumerra account.`,
  });
  return dispatch({
    to: args.to,
    subject: args.subject,
    html,
    text: args.body,
    tags: [
      { name: "category", value: `engagement.${args.kind}` },
      { name: "candidateId", value: String(args.candidateId) },
    ],
    logger: args.logger,
  });
}

// ---------- Institution endorsements ----------

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
  args.logger.info(
    {
      candidateId: args.candidateId,
      institutionId: args.institutionId,
      kind: "application_endorsed",
    },
    "endorsement email dispatch",
  );
  const subject = `${args.institutionName} co-signed your application`;
  const intro = `Hi ${escapeHtml(args.candidateName)}, <strong>${escapeHtml(
    args.institutionName,
  )}</strong> just verified and co-signed your application for <strong>${escapeHtml(
    args.jobTitle,
  )}</strong>. Employers see a "Verified by" badge on your application — this dramatically improves your chances of an interview.`;
  const noteBlock = args.note
    ? `<p style="background:#f1f5f9;padding:12px 16px;border-radius:8px;color:#0f172a;">"${escapeHtml(
        args.note,
      )}"</p>`
    : "";
  const html = renderEmailHtml({
    heading: "Your application was co-signed",
    body: `<p>${intro}</p>${noteBlock}`,
    cta: { href: args.applicationLink, label: "View application" },
    footer: `You're receiving this because your institution verified your enrolment on Jumerra.`,
  });
  const text = `${args.institutionName} co-signed your application for ${args.jobTitle}.\n${
    args.note ? `\nNote: ${args.note}\n` : ""
  }\nView: ${args.applicationLink}`;
  return dispatch({
    to: args.to,
    subject,
    html,
    text,
    tags: [{ name: "category", value: "endorsement" }],
    logger: args.logger,
  });
}

// ---------- Fast-track SLA ----------

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
    "fast-track email dispatch",
  );
  const isRevoke = args.kind === "fast_track_revoked";
  const subject = isRevoke
    ? `Your Fast-Track pledge has been revoked`
    : `Fast-Track SLA breach warning`;
  const heading = subject;
  const body = isRevoke
    ? `<p>Hi team at <strong>${escapeHtml(
        args.employerName,
      )}</strong>, your Fast-Track pledge has been revoked after <strong>${
        args.breachCount
      }</strong> SLA breaches in the last 30 days.${
        args.revokedUntil
          ? ` Eligibility resumes on <strong>${escapeHtml(
              new Date(args.revokedUntil).toLocaleDateString(),
            )}</strong>.`
          : ""
      } The Fast-Track badge has been removed from your job postings.</p>`
    : `<p>Hi team at <strong>${escapeHtml(
        args.employerName,
      )}</strong>, one of your Fast-Track applications missed the 48-hour SLA. One more breach in the next 30 days will revoke the pledge automatically.</p>`;
  const html = renderEmailHtml({
    heading,
    body,
    footer: `Manage your Fast-Track pledge from the employer dashboard.`,
  });
  const text = `${heading}\n\n${stripTags(body)}`;
  return dispatch({
    to: args.to,
    subject,
    html,
    text,
    tags: [{ name: "category", value: `fast-track.${args.kind}` }],
    logger: args.logger,
  });
}

// ---------- Hire-event notifications to institutions ----------

export interface SendHireNotificationEmailArgs {
  to: string;
  recipientName: string;
  candidateName: string;
  employerName: string;
  jobTitle: string;
  institutionName: string;
  link: string;
  logger: Logger;
}

export async function sendHireNotificationEmail(
  args: SendHireNotificationEmailArgs,
): Promise<SendResult> {
  args.logger.info(
    {
      institutionName: args.institutionName,
      employerName: args.employerName,
      jobTitle: args.jobTitle,
      kind: "hire_notification",
    },
    "hire notification email dispatch",
  );
  const subject = `${args.candidateName} was hired by ${args.employerName}`;
  const html = renderEmailHtml({
    heading: "A verified student was hired",
    body: `<p>Hi ${escapeHtml(args.recipientName)},</p>
<p><strong>${escapeHtml(
      args.candidateName,
    )}</strong> — a verified student of <strong>${escapeHtml(
      args.institutionName,
    )}</strong> — was just hired by <strong>${escapeHtml(
      args.employerName,
    )}</strong> for the role <em>${escapeHtml(args.jobTitle)}</em>.</p>
<p>This placement will appear in your institution analytics on the next refresh.</p>`,
    cta: { href: args.link, label: "Open dashboard" },
    footer: `You're receiving this because you are an owner or registrar of ${escapeHtml(
      args.institutionName,
    )}.`,
  });
  const text = `${args.candidateName} (verified student of ${args.institutionName}) was hired by ${args.employerName} for ${args.jobTitle}.\n\nDashboard: ${args.link}`;
  return dispatch({
    to: args.to,
    subject,
    html,
    text,
    tags: [{ name: "category", value: "hire-notification" }],
    logger: args.logger,
  });
}

// ---------- Approval / rejection notifications ----------

export interface SendRegistrationDecisionEmailArgs {
  to: string;
  recipientName: string;
  decision: "approved" | "rejected";
  role: "employer" | "institution" | "candidate";
  note: string | null;
  signInUrl: string;
  logger: Logger;
}

export async function sendRegistrationDecisionEmail(
  args: SendRegistrationDecisionEmailArgs,
): Promise<SendResult> {
  args.logger.info(
    { decision: args.decision, role: args.role, kind: "registration_decision" },
    "registration decision email dispatch",
  );
  const approved = args.decision === "approved";
  const subject = approved
    ? `Your Jumerra ${args.role} account is approved`
    : `Update on your Jumerra ${args.role} application`;
  const heading = approved ? "You're in" : "Your application wasn't accepted";
  const noteBlock = args.note
    ? `<p style="background:#f1f5f9;padding:12px 16px;border-radius:8px;color:#0f172a;">${escapeHtml(
        args.note,
      )}</p>`
    : "";
  const body = approved
    ? `<p>Hi ${escapeHtml(
        args.recipientName,
      )}, your ${args.role} account on Jumerra has been approved. Sign in to set up your profile and get started.</p>${noteBlock}`
    : `<p>Hi ${escapeHtml(
        args.recipientName,
      )}, after review we weren't able to approve your ${args.role} application at this time.</p>${noteBlock}<p>If you believe this was a mistake you can reply to this email and we'll take another look.</p>`;
  const html = renderEmailHtml({
    heading,
    body,
    cta: approved ? { href: args.signInUrl, label: "Sign in to Jumerra" } : null,
    footer: approved
      ? `Welcome aboard.`
      : `Thanks for your interest in Jumerra.`,
  });
  const text = approved
    ? `Your ${args.role} account is approved. Sign in: ${args.signInUrl}${
        args.note ? `\n\nNote: ${args.note}` : ""
      }`
    : `Your ${args.role} application wasn't approved.${
        args.note ? `\n\n${args.note}` : ""
      }`;
  return dispatch({
    to: args.to,
    subject,
    html,
    text,
    tags: [
      { name: "category", value: `registration.${args.decision}` },
      { name: "role", value: args.role },
    ],
    logger: args.logger,
  });
}

// ---------- Trash purge pre-warning ----------

export interface TrashPurgeWarningGroup {
  /** Human-readable category label e.g. "Candidates". */
  label: string;
  items: { id: number; label: string; secondary: string | null; purgeOn: string }[];
}

export interface SendTrashPurgeWarningEmailArgs {
  to: string;
  recipientName: string;
  leadDays: number;
  groups: TrashPurgeWarningGroup[];
  dashboardUrl: string;
  logger: Logger;
}

export async function sendTrashPurgeWarningEmail(
  args: SendTrashPurgeWarningEmailArgs,
): Promise<SendResult> {
  const total = args.groups.reduce((n, g) => n + g.items.length, 0);
  args.logger.info(
    { kind: "trash_purge_warning", leadDays: args.leadDays, total },
    "trash purge warning email dispatch",
  );
  const subject =
    total === 1
      ? `1 trash item will be permanently deleted in ${args.leadDays} day${
          args.leadDays === 1 ? "" : "s"
        }`
      : `${total} trash items will be permanently deleted in ${args.leadDays} day${
          args.leadDays === 1 ? "" : "s"
        }`;

  const groupsHtml = args.groups
    .filter((g) => g.items.length > 0)
    .map((g) => {
      const rows = g.items
        .map(
          (it) =>
            `<li style="margin:4px 0;"><strong>${escapeHtml(it.label)}</strong>${
              it.secondary ? ` — <span style="color:#64748b;">${escapeHtml(it.secondary)}</span>` : ""
            } <span style="color:#64748b;">(purges ${escapeHtml(
              new Date(it.purgeOn).toLocaleDateString(),
            )})</span></li>`,
        )
        .join("");
      return `<p style="margin:16px 0 4px 0;font-weight:600;">${escapeHtml(
        g.label,
      )} (${g.items.length})</p><ul style="margin:0;padding-left:20px;">${rows}</ul>`;
    })
    .join("");

  const html = renderEmailHtml({
    heading: "Trash items scheduled for permanent deletion",
    body: `<p>Hi ${escapeHtml(args.recipientName)},</p>
<p>The following items in the Jumerra admin trash will be permanently deleted in <strong>${
      args.leadDays
    } day${args.leadDays === 1 ? "" : "s"}</strong>. If any should be kept, restore them before the purge runs.</p>
${groupsHtml}`,
    cta: { href: args.dashboardUrl, label: "Open trash dashboard" },
    footer: `You're receiving this because you have permission to manage the listed item types.`,
  });

  const textLines: string[] = [
    `Hi ${args.recipientName},`,
    "",
    `${total} trash item${total === 1 ? "" : "s"} will be permanently deleted in ${
      args.leadDays
    } day${args.leadDays === 1 ? "" : "s"}.`,
  ];
  for (const g of args.groups) {
    if (g.items.length === 0) continue;
    textLines.push("", `${g.label} (${g.items.length}):`);
    for (const it of g.items) {
      textLines.push(
        `  - ${it.label}${it.secondary ? ` — ${it.secondary}` : ""} (purges ${new Date(it.purgeOn).toLocaleDateString()})`,
      );
    }
  }
  textLines.push("", `Open: ${args.dashboardUrl}`);

  return dispatch({
    to: args.to,
    subject,
    html,
    text: textLines.join("\n"),
    tags: [{ name: "category", value: "trash.purge_warning" }],
    logger: args.logger,
  });
}

// ---------- Helpers ----------

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

/**
 * Best-effort origin for background workers (digest, SLA sweeps) that
 * don't have an incoming request to derive a host from. Prefers the
 * first production domain, falls back to the dev domain, then to a
 * recognisable placeholder so the email still renders.
 */
export function originForBackground(): string {
  const prod = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, "")}`;
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev.replace(/^https?:\/\//, "")}`;
  return "https://app.jumerra.com";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Re-export the root logger so callers that already have it can pass
// it through without an extra import.
export { rootLogger as defaultEmailLogger };
