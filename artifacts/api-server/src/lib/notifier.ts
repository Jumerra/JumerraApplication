/**
 * Cross-channel notification dispatcher.
 *
 * Every notification fans out through one helper:
 *   1. Insert an in-app `notifications` row (the bell list & badge).
 *   2. If the receiving user has any registered Expo push tokens AND
 *      the per-category preference is on (defaults true), enqueue an
 *      Expo push message.
 *
 * Expo push is best-effort — failures never throw, never block the
 * caller. Tokens that the Expo service reports as `DeviceNotRegistered`
 * are removed so we don't keep spamming a dead device.
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  expoPushTokensTable,
  notificationPrefsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  sendWhatsAppTemplate,
  type WhatsAppCategory,
  type WhatsAppTemplateKey,
} from "./whatsapp";

export type NotificationCategory =
  | "strongMatch"
  | "applicationStatus"
  | "interviewReminder"
  | "profileViewed"
  | "weeklyDigest"
  | "introRequest";

export type DispatchOpts = {
  userId: number;
  /** Free-text kind that ends up on the notification row (used for
   * client-side icon/route mapping). */
  kind: string;
  title: string;
  body?: string;
  link?: string;
  /** Which preference toggle gates the push side of the dispatch.
   * The in-app row is written regardless. */
  category: NotificationCategory;
  /** Optional structured payload delivered alongside the push so the
   * mobile app can deep-link without parsing the link string. */
  data?: Record<string, unknown>;
};

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  channelId?: string;
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type ExpoPushResponse = {
  data?: ExpoTicket[] | ExpoTicket;
  errors?: { message: string }[];
};

function isExpoToken(t: string): boolean {
  return t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[");
}

interface LoadedPrefs {
  // Push gates (default true).
  strongMatch: boolean;
  applicationStatus: boolean;
  interviewReminder: boolean;
  profileViewed: boolean;
  weeklyDigest: boolean;
  /** Intro requests are user-initiated and rare — always on for push. */
  introRequest: boolean;
  // WhatsApp gates (default false; opt-in only).
  whatsappStrongMatch: boolean;
  whatsappApplicationStatus: boolean;
  whatsappInterviewReminder: boolean;
  whatsappWeeklyDigest: boolean;
}

async function loadPrefs(userId: number): Promise<LoadedPrefs> {
  const [row] = await db
    .select()
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.userId, userId))
    .limit(1);
  if (row) {
    return {
      strongMatch: row.strongMatch,
      applicationStatus: row.applicationStatus,
      interviewReminder: row.interviewReminder,
      profileViewed: row.profileViewed,
      weeklyDigest: row.weeklyDigest,
      introRequest: true,
      whatsappStrongMatch: row.whatsappStrongMatch,
      whatsappApplicationStatus: row.whatsappApplicationStatus,
      whatsappInterviewReminder: row.whatsappInterviewReminder,
      whatsappWeeklyDigest: row.whatsappWeeklyDigest,
    };
  }
  return {
    strongMatch: true,
    applicationStatus: true,
    interviewReminder: true,
    profileViewed: true,
    weeklyDigest: true,
    introRequest: true,
    whatsappStrongMatch: false,
    whatsappApplicationStatus: false,
    whatsappInterviewReminder: false,
    whatsappWeeklyDigest: false,
  };
}

/**
 * Map an in-app NotificationCategory to a WhatsApp template + toggle
 * key. Returns null for categories that don't have a WhatsApp channel
 * (profileViewed, introRequest — kept in-app/push only to limit
 * cross-channel spam).
 */
function whatsappRoutingFor(category: NotificationCategory): {
  toggleKey: keyof LoadedPrefs;
  templateKey: WhatsAppTemplateKey;
  waCategory: WhatsAppCategory;
} | null {
  switch (category) {
    case "strongMatch":
      return {
        toggleKey: "whatsappStrongMatch",
        templateKey: "strong_match",
        waCategory: "strongMatch",
      };
    case "applicationStatus":
      return {
        toggleKey: "whatsappApplicationStatus",
        templateKey: "application_status",
        waCategory: "applicationStatus",
      };
    case "interviewReminder":
      return {
        toggleKey: "whatsappInterviewReminder",
        templateKey: "interview_reminder",
        waCategory: "interviewReminder",
      };
    case "weeklyDigest":
      return {
        toggleKey: "whatsappWeeklyDigest",
        templateKey: "weekly_digest",
        waCategory: "weeklyDigest",
      };
    default:
      return null;
  }
}

/**
 * Derive template parameters for the WhatsApp template from the
 * generic DispatchOpts. We deliberately use the `title`/`body` already
 * composed by the caller so we don't have to re-implement
 * category-specific copy in two places. The router-mapped template
 * still uses real placeholders so a future provider switch can render
 * proper WA template variables.
 */
function whatsappParamsFor(
  templateKey: WhatsAppTemplateKey,
  opts: DispatchOpts,
): Record<string, string> {
  const link = opts.link ?? "";
  switch (templateKey) {
    case "strong_match":
      return {
        jobTitle: opts.title,
        employerName: opts.body || "Jumerra",
        link,
      };
    case "application_status":
      return {
        jobTitle: opts.title,
        status: opts.body || "updated",
        link,
      };
    case "interview_reminder":
      return {
        jobTitle: opts.title,
        when: opts.body || "soon",
        link,
      };
    case "weekly_digest":
      return {
        matches: opts.body || "new",
        link,
      };
    default:
      return {};
  }
}

async function fetchExpo(messages: ExpoPushMessage[]): Promise<ExpoTicket[]> {
  const res = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "accept-encoding": "gzip, deflate",
      "content-type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    throw new Error(`Expo push HTTP ${res.status}`);
  }
  const json = (await res.json()) as ExpoPushResponse;
  if (!json.data) return [];
  return Array.isArray(json.data) ? json.data : [json.data];
}

/**
 * Send a notification across in-app + push channels.
 *
 * The in-app insert is awaited so callers know the row exists when the
 * function resolves. Push fan-out is fired-and-best-effort; errors are
 * logged but never thrown.
 */
export async function sendNotification(opts: DispatchOpts): Promise<void> {
  const { userId, kind, title, body = "", link, category, data } = opts;

  try {
    await db.insert(notificationsTable).values({
      userId,
      kind,
      title,
      body,
      link: link ?? null,
    });
  } catch (err) {
    // If we can't persist the in-app row there's nothing left to do —
    // surfacing the failure isn't useful here either, so just log.
    logger.warn({ err, userId, kind }, "notifier: in-app insert failed");
    return;
  }

  // Fire-and-forget push side. Wrapped in a microtask + catch so
  // callers never await network latency or transient Expo failures.
  void (async () => {
    try {
      const prefs = await loadPrefs(userId);
      if (!prefs[category]) return;

      const tokens = await db
        .select({ id: expoPushTokensTable.id, token: expoPushTokensTable.token })
        .from(expoPushTokensTable)
        .where(eq(expoPushTokensTable.userId, userId));
      if (tokens.length === 0) return;

      const valid = tokens.filter((t) => isExpoToken(t.token));
      if (valid.length === 0) return;

      const messages: ExpoPushMessage[] = valid.map((t) => ({
        to: t.token,
        title,
        body,
        sound: "default",
        channelId: "default",
        data: { kind, link, ...(data ?? {}) },
      }));

      const tickets = await fetchExpo(messages);

      // Trim dead tokens. Expo returns one ticket per message in order.
      const dead: number[] = [];
      tickets.forEach((ticket, idx) => {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const id = valid[idx]?.id;
          if (id != null) dead.push(id);
        }
      });
      if (dead.length > 0) {
        try {
          await db
            .delete(expoPushTokensTable)
            .where(inArray(expoPushTokensTable.id, dead));
        } catch (err) {
          logger.warn({ err }, "notifier: failed to prune dead push tokens");
        }
      }
    } catch (err) {
      logger.warn({ err, userId, category }, "notifier: push fan-out failed");
    }
  })();

  // Fire-and-forget WhatsApp side. Gated on (a) the category having a
  // WhatsApp route, (b) the per-category WA toggle being on (defaults
  // false — opt-in), and (c) the user having a *verified* WhatsApp
  // number. Failures never throw — the WhatsApp stub records every
  // attempt in `whatsapp_message_log` regardless.
  void (async () => {
    try {
      const routing = whatsappRoutingFor(category);
      if (!routing) return;

      const prefs = await loadPrefs(userId);
      if (!prefs[routing.toggleKey]) return;

      const [u] = await db
        .select({
          whatsappNumber: usersTable.whatsappNumber,
          whatsappVerifiedAt: usersTable.whatsappVerifiedAt,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!u || !u.whatsappNumber || !u.whatsappVerifiedAt) return;

      await sendWhatsAppTemplate({
        userId,
        to: u.whatsappNumber,
        category: routing.waCategory,
        templateKey: routing.templateKey,
        params: whatsappParamsFor(routing.templateKey, opts),
      });
    } catch (err) {
      logger.warn(
        { err, userId, category },
        "notifier: whatsapp fan-out failed",
      );
    }
  })();
}

/**
 * Convenience: resolve the user-id that owns a candidate, then dispatch.
 * Silently no-ops if the candidate has no linked user (e.g. seeded
 * historic record).
 */
export async function sendNotificationToCandidate(
  candidateId: number,
  opts: Omit<DispatchOpts, "userId">,
): Promise<void> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.candidateId, candidateId))
    .limit(1);
  if (!row) return;
  await sendNotification({ ...opts, userId: row.id });
}
