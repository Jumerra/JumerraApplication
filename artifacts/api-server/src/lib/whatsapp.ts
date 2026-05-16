/**
 * WhatsApp delivery layer.
 *
 * Currently a stub: provider integration (Twilio WhatsApp Business or
 * Meta WhatsApp Cloud) will be wired in once credentials are
 * configured. Until then every `sendWhatsAppTemplate` call writes a
 * "skipped" row to `whatsapp_message_log` and returns
 * `{ sent: false, reason: "whatsapp-not-configured" }` so callers can
 * fan out without throwing and admins can still see the attempt in the
 * delivery-log view.
 *
 * Provider selection priority (first non-empty wins):
 *   1. TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM   (Twilio)
 *   2. WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN                (Meta WA Cloud)
 *
 * Templates: every body is rendered from a small in-file template
 * registry so the spec-required "pre-approved templates" surface is
 * deterministic and easy to register with the provider later. To add a
 * new template, extend `TEMPLATES` below — no other call sites change.
 */

import { db, whatsappMessageLogTable } from "@workspace/db";
import { logger } from "./logger";

export type WhatsAppTemplateKey =
  | "otp_verification"
  | "strong_match"
  | "application_status"
  | "interview_reminder"
  | "weekly_digest";

export type WhatsAppCategory =
  | "otp"
  | "strongMatch"
  | "applicationStatus"
  | "interviewReminder"
  | "weeklyDigest";

export type WhatsAppSendResult =
  | { sent: true; provider: string; providerMessageId: string | null }
  | { sent: false; reason: string };

interface TemplateSpec {
  /** Render the localized body from named parameters. */
  render: (params: Record<string, string>) => string;
  /** Required parameter names for safety / debugging. */
  required: readonly string[];
}

const TEMPLATES: Record<WhatsAppTemplateKey, TemplateSpec> = {
  otp_verification: {
    required: ["code"],
    render: ({ code }) =>
      `Your Jumerra verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
  },
  strong_match: {
    required: ["jobTitle", "employerName", "link"],
    render: ({ jobTitle, employerName, link }) =>
      `Jumerra: a new strong match for you — ${jobTitle} at ${employerName}. View it: ${link}`,
  },
  application_status: {
    required: ["jobTitle", "status", "link"],
    render: ({ jobTitle, status, link }) =>
      `Jumerra: your application for ${jobTitle} is now "${status}". Details: ${link}`,
  },
  interview_reminder: {
    required: ["jobTitle", "when", "link"],
    render: ({ jobTitle, when, link }) =>
      `Jumerra reminder: interview for ${jobTitle} is ${when}. Details: ${link}`,
  },
  weekly_digest: {
    required: ["matches", "link"],
    render: ({ matches, link }) =>
      `Jumerra weekly digest: ${matches} new matches this week. Open the app: ${link}`,
  },
};

/** Returns the list of template keys for OpenAPI/UI consumption. */
export function listTemplateKeys(): readonly WhatsAppTemplateKey[] {
  return Object.keys(TEMPLATES) as WhatsAppTemplateKey[];
}

/**
 * Normalize a user-entered WhatsApp number to E.164. Accepts inputs
 * with spaces, dashes, parentheses, or a leading "+". Returns null if
 * the result isn't a plausible E.164 number (8–15 digits).
 *
 * This is intentionally lenient — we never call libphonenumber here
 * because most candidates type a local number; the provider performs
 * the final validation on send.
 */
export function normalizeE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${hasPlus ? digits : digits}`;
}

function detectProvider(): "twilio" | "meta" | null {
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  ) {
    return "twilio";
  }
  if (
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_ACCESS_TOKEN
  ) {
    return "meta";
  }
  return null;
}

async function logAttempt(args: {
  userId: number | null;
  to: string;
  category: WhatsAppCategory;
  templateKey: WhatsAppTemplateKey;
  status: "queued" | "sent" | "failed" | "skipped";
  providerMessageId?: string | null;
  error?: string | null;
}): Promise<void> {
  try {
    await db.insert(whatsappMessageLogTable).values({
      userId: args.userId,
      toNumber: args.to,
      category: args.category,
      templateKey: args.templateKey,
      status: args.status,
      providerMessageId: args.providerMessageId ?? null,
      error: args.error ?? null,
    });
  } catch (err) {
    // Logging failure should never break the dispatch path.
    logger.warn({ err }, "whatsapp: failed to write delivery log");
  }
}

export interface SendWhatsAppTemplateArgs {
  userId: number | null;
  to: string;
  category: WhatsAppCategory;
  templateKey: WhatsAppTemplateKey;
  params: Record<string, string>;
}

/**
 * Render and send a WhatsApp template message. Always writes a delivery
 * log row. Never throws — failures resolve to `{ sent: false }`.
 */
export async function sendWhatsAppTemplate(
  args: SendWhatsAppTemplateArgs,
): Promise<WhatsAppSendResult> {
  const { userId, to, category, templateKey, params } = args;
  const tpl = TEMPLATES[templateKey];
  if (!tpl) {
    await logAttempt({
      userId,
      to,
      category,
      templateKey,
      status: "failed",
      error: `unknown template: ${templateKey}`,
    });
    return { sent: false, reason: "unknown-template" };
  }
  const missing = tpl.required.filter(
    (k) => !params[k] || params[k].length === 0,
  );
  if (missing.length > 0) {
    await logAttempt({
      userId,
      to,
      category,
      templateKey,
      status: "failed",
      error: `missing params: ${missing.join(",")}`,
    });
    return { sent: false, reason: "missing-params" };
  }

  const provider = detectProvider();
  if (!provider) {
    // Stub path — log "skipped" so admins still see the attempt.
    // Policy: never log the rendered body (may contain links / OTPs).
    logger.info(
      { userId, category, templateKey, provider: "none" },
      "whatsapp send queued (provider not configured)",
    );
    await logAttempt({
      userId,
      to,
      category,
      templateKey,
      status: "skipped",
      error: "whatsapp-not-configured",
    });
    return { sent: false, reason: "whatsapp-not-configured" };
  }

  const body = tpl.render(params);

  try {
    if (provider === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const from = process.env.TWILIO_WHATSAPP_FROM!;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const form = new URLSearchParams();
      form.set("From", `whatsapp:${from.replace(/^whatsapp:/, "")}`);
      form.set("To", `whatsapp:${to}`);
      form.set("Body", body);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        await logAttempt({
          userId,
          to,
          category,
          templateKey,
          status: "failed",
          error: `twilio ${res.status}: ${text.slice(0, 200)}`,
        });
        return { sent: false, reason: `twilio-${res.status}` };
      }
      const json = (await res.json()) as { sid?: string };
      await logAttempt({
        userId,
        to,
        category,
        templateKey,
        status: "sent",
        providerMessageId: json.sid ?? null,
      });
      return {
        sent: true,
        provider: "twilio",
        providerMessageId: json.sid ?? null,
      };
    }

    // Meta WA Cloud
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    const token = process.env.WHATSAPP_ACCESS_TOKEN!;
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await logAttempt({
        userId,
        to,
        category,
        templateKey,
        status: "failed",
        error: `meta ${res.status}: ${text.slice(0, 200)}`,
      });
      return { sent: false, reason: `meta-${res.status}` };
    }
    const json = (await res.json()) as {
      messages?: Array<{ id?: string }>;
    };
    const providerMessageId = json.messages?.[0]?.id ?? null;
    await logAttempt({
      userId,
      to,
      category,
      templateKey,
      status: "sent",
      providerMessageId,
    });
    return { sent: true, provider: "meta", providerMessageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAttempt({
      userId,
      to,
      category,
      templateKey,
      status: "failed",
      error: msg.slice(0, 200),
    });
    return { sent: false, reason: "exception" };
  }
}
