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
  /**
   * Provider template metadata. WhatsApp Business policy requires that
   * any business-initiated message outside the 24-hour customer-service
   * window uses an approved Message Template. We expose:
   *   - `metaTemplateName` (Meta WA Cloud "name") — passed straight to
   *     the Graph API `template.name` field.
   *   - `paramOrder` (ordered list of `required` keys) — maps named
   *     params to the positional `{{1}}, {{2}}, …` body placeholders
   *     both providers use. Twilio's Content Variables get the same
   *     mapping by index.
   *   - `twilioContentSidEnv` — name of the env var that holds the
   *     pre-approved Twilio Content SID. Falls back to the registry
   *     default if the env var isn't set.
   *
   * To go live, register each template with the provider, then either
   * set the env vars below (Twilio Content SIDs) or rely on the
   * `metaTemplateName` directly (Meta).
   */
  metaTemplateName: string;
  twilioContentSidEnv: string;
  paramOrder: readonly string[];
  metaLanguage: string;
}

const TEMPLATES: Record<WhatsAppTemplateKey, TemplateSpec> = {
  otp_verification: {
    required: ["code"],
    paramOrder: ["code"],
    metaTemplateName: "jumerra_otp_verification",
    metaLanguage: "en",
    twilioContentSidEnv: "TWILIO_CONTENT_SID_OTP_VERIFICATION",
    render: ({ code }) =>
      `Your Jumerra verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
  },
  strong_match: {
    required: ["jobTitle", "employerName", "link"],
    paramOrder: ["jobTitle", "employerName", "link"],
    metaTemplateName: "jumerra_strong_match",
    metaLanguage: "en",
    twilioContentSidEnv: "TWILIO_CONTENT_SID_STRONG_MATCH",
    render: ({ jobTitle, employerName, link }) =>
      `Jumerra: a new strong match for you — ${jobTitle} at ${employerName}. View it: ${link}`,
  },
  application_status: {
    required: ["jobTitle", "status", "link"],
    paramOrder: ["jobTitle", "status", "link"],
    metaTemplateName: "jumerra_application_status",
    metaLanguage: "en",
    twilioContentSidEnv: "TWILIO_CONTENT_SID_APPLICATION_STATUS",
    render: ({ jobTitle, status, link }) =>
      `Jumerra: your application for ${jobTitle} is now "${status}". Details: ${link}`,
  },
  interview_reminder: {
    required: ["jobTitle", "when", "link"],
    paramOrder: ["jobTitle", "when", "link"],
    metaTemplateName: "jumerra_interview_reminder",
    metaLanguage: "en",
    twilioContentSidEnv: "TWILIO_CONTENT_SID_INTERVIEW_REMINDER",
    render: ({ jobTitle, when, link }) =>
      `Jumerra reminder: interview for ${jobTitle} is ${when}. Details: ${link}`,
  },
  weekly_digest: {
    required: ["matches", "link"],
    paramOrder: ["matches", "link"],
    metaTemplateName: "jumerra_weekly_digest",
    metaLanguage: "en",
    twilioContentSidEnv: "TWILIO_CONTENT_SID_WEEKLY_DIGEST",
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
  // Positional params ({{1}}, {{2}}, …) shared by both providers.
  const orderedParams = tpl.paramOrder.map((k) => params[k] ?? "");

  try {
    if (provider === "twilio") {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const from = process.env.TWILIO_WHATSAPP_FROM!;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const form = new URLSearchParams();
      form.set("From", `whatsapp:${from.replace(/^whatsapp:/, "")}`);
      form.set("To", `whatsapp:${to}`);
      // Prefer the approved Content SID when the env var is configured
      // — Twilio's Content API enforces the pre-approved template and
      // formats the positional variables for us. Otherwise we fall
      // back to a plain Body, which only works inside an active 24-hour
      // session window (Twilio sandbox or replies). We log the mode so
      // ops can see at a glance which path is in use.
      const contentSid = process.env[tpl.twilioContentSidEnv];
      let mode: "content-sid" | "body" = "body";
      if (contentSid && contentSid.trim().length > 0) {
        form.set("ContentSid", contentSid);
        // Twilio expects a JSON object keyed by variable index ("1"…"N").
        const vars: Record<string, string> = {};
        orderedParams.forEach((v, i) => {
          vars[String(i + 1)] = v;
        });
        form.set("ContentVariables", JSON.stringify(vars));
        mode = "content-sid";
      } else {
        form.set("Body", body);
      }
      logger.info(
        { provider: "twilio", mode, templateKey, userId },
        "whatsapp send",
      );
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

    // Meta WA Cloud — always use the approved template message API
    // (`type: "template"`). Plain text would only deliver inside an
    // active 24-hour customer-initiated session, which we can't assume
    // for business-initiated alerts (matches, status updates, etc.).
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    const token = process.env.WHATSAPP_ACCESS_TOKEN!;
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const metaComponents =
      orderedParams.length > 0
        ? [
            {
              type: "body",
              parameters: orderedParams.map((v) => ({
                type: "text",
                text: v,
              })),
            },
          ]
        : [];
    logger.info(
      {
        provider: "meta",
        templateName: tpl.metaTemplateName,
        templateKey,
        userId,
      },
      "whatsapp send",
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: tpl.metaTemplateName,
          language: { code: tpl.metaLanguage },
          components: metaComponents,
        },
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
