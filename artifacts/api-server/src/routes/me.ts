/**
 * Per-user mobile-companion endpoints:
 *   - Expo push token registration / revocation
 *   - Notification preferences (per-category toggles)
 *   - For-You feed of ranked job matches with persisted dismissals
 *
 * All routes require an authenticated session and act on `currentUser`.
 * The For-You feed only makes sense for candidates and 4xx's other roles.
 */

import { randomInt } from "node:crypto";
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  candidateDismissedJobsTable,
  candidatesTable,
  employersTable,
  expoPushTokensTable,
  jobsTable,
  notificationPrefsTable,
  usersTable,
} from "@workspace/db";
import { calculateMatchScore } from "../lib/matching";
import {
  previousCompleteWeekLocal,
  runDigestForCandidate,
} from "../lib/digest-worker";
import { requireAuth } from "../middleware/require-auth";
import { normalizeE164, sendWhatsAppTemplate } from "../lib/whatsapp";

const router: IRouter = Router();

router.use("/me", requireAuth);

// --- Push tokens ---------------------------------------------------------

const PushTokenBody = z.object({
  token: z.string().min(8).max(256),
  platform: z.enum(["ios", "android", "web", "unknown"]).default("unknown"),
});

router.post("/me/push-tokens", async (req, res) => {
  const parsed = PushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  try {
    // Upsert by token. If the same token was previously bound to a
    // different user (device handed off), reassign + bump lastSeenAt.
    await db
      .insert(expoPushTokensTable)
      .values({
        userId: me.id,
        token: parsed.data.token,
        platform: parsed.data.platform,
      })
      .onConflictDoUpdate({
        target: expoPushTokensTable.token,
        set: {
          userId: me.id,
          platform: parsed.data.platform,
          lastSeenAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "register push token failed");
    res.status(500).json({ error: "Failed to register token" });
  }
});

router.delete("/me/push-tokens", async (req, res) => {
  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  await db
    .delete(expoPushTokensTable)
    .where(
      and(
        eq(expoPushTokensTable.token, parsed.data.token),
        eq(expoPushTokensTable.userId, me.id),
      ),
    );
  res.json({ ok: true });
});

// --- Notification preferences --------------------------------------------

const PREF_DEFAULTS = {
  strongMatch: true,
  applicationStatus: true,
  interviewReminder: true,
  profileViewed: true,
  weeklyDigest: true,
  // WhatsApp toggles default off — opt-in only (matches schema).
  whatsappStrongMatch: false,
  whatsappApplicationStatus: false,
  whatsappInterviewReminder: false,
  whatsappWeeklyDigest: false,
  digestDow: 1,
  digestHour: 9,
  digestTz: null as string | null,
};

/**
 * Resolve the candidate's effective digest timezone: explicit pref
 * `digestTz` wins, otherwise the candidate row's `timezone`, otherwise
 * UTC. Returned only for display in the prefs UI — the worker performs
 * the same resolution server-side.
 */
async function resolveDigestTz(
  candidateId: number | null,
  prefTz: string | null | undefined,
): Promise<string> {
  if (prefTz && prefTz.length > 0) return prefTz;
  if (candidateId != null) {
    const [c] = await db
      .select({ timezone: candidatesTable.timezone })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId))
      .limit(1);
    if (c?.timezone && c.timezone.length > 0) return c.timezone;
  }
  return "UTC";
}

router.get("/me/notification-prefs", async (req, res) => {
  const me = req.currentUser!;
  const [row] = await db
    .select()
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.userId, me.id))
    .limit(1);
  const effectiveTz = await resolveDigestTz(me.candidateId ?? null, row?.digestTz ?? null);
  res.json({
    strongMatch: row?.strongMatch ?? PREF_DEFAULTS.strongMatch,
    applicationStatus:
      row?.applicationStatus ?? PREF_DEFAULTS.applicationStatus,
    interviewReminder:
      row?.interviewReminder ?? PREF_DEFAULTS.interviewReminder,
    profileViewed: row?.profileViewed ?? PREF_DEFAULTS.profileViewed,
    weeklyDigest: row?.weeklyDigest ?? PREF_DEFAULTS.weeklyDigest,
    whatsappStrongMatch:
      row?.whatsappStrongMatch ?? PREF_DEFAULTS.whatsappStrongMatch,
    whatsappApplicationStatus:
      row?.whatsappApplicationStatus ??
      PREF_DEFAULTS.whatsappApplicationStatus,
    whatsappInterviewReminder:
      row?.whatsappInterviewReminder ??
      PREF_DEFAULTS.whatsappInterviewReminder,
    whatsappWeeklyDigest:
      row?.whatsappWeeklyDigest ?? PREF_DEFAULTS.whatsappWeeklyDigest,
    digestDow: row?.digestDow ?? PREF_DEFAULTS.digestDow,
    digestHour: row?.digestHour ?? PREF_DEFAULTS.digestHour,
    digestTz: row?.digestTz ?? null,
    effectiveDigestTz: effectiveTz,
  });
});

const PrefsBody = z.object({
  strongMatch: z.boolean().optional(),
  applicationStatus: z.boolean().optional(),
  interviewReminder: z.boolean().optional(),
  profileViewed: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
  whatsappStrongMatch: z.boolean().optional(),
  whatsappApplicationStatus: z.boolean().optional(),
  whatsappInterviewReminder: z.boolean().optional(),
  whatsappWeeklyDigest: z.boolean().optional(),
  digestDow: z.number().int().min(0).max(6).optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  // Empty string clears the override (fall back to candidate.timezone).
  digestTz: z.string().max(64).nullable().optional(),
});

router.put("/me/notification-prefs", async (req, res) => {
  const parsed = PrefsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  const patch = parsed.data;

  // Compute the merged final state in one shot so onConflict can
  // overwrite atomically. Read existing first, then write the union.
  const [existing] = await db
    .select()
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.userId, me.id))
    .limit(1);

  // Normalize the optional `digestTz` patch:
  //   - omitted → keep existing
  //   - explicit null or empty string → clear the override
  //   - non-empty string → store as-is (validated against Intl below)
  let digestTzPatch: string | null | undefined = undefined;
  if (Object.prototype.hasOwnProperty.call(patch, "digestTz")) {
    const v = patch.digestTz;
    if (v == null || v === "") {
      digestTzPatch = null;
    } else {
      try {
        // Throws RangeError on invalid IANA id.
        new Intl.DateTimeFormat("en-US", { timeZone: v }).format(new Date());
        digestTzPatch = v;
      } catch {
        res.status(400).json({ error: `Invalid IANA timezone: ${v}` });
        return;
      }
    }
  }

  const merged = {
    strongMatch:
      patch.strongMatch ?? existing?.strongMatch ?? PREF_DEFAULTS.strongMatch,
    applicationStatus:
      patch.applicationStatus ??
      existing?.applicationStatus ??
      PREF_DEFAULTS.applicationStatus,
    interviewReminder:
      patch.interviewReminder ??
      existing?.interviewReminder ??
      PREF_DEFAULTS.interviewReminder,
    profileViewed:
      patch.profileViewed ??
      existing?.profileViewed ??
      PREF_DEFAULTS.profileViewed,
    weeklyDigest:
      patch.weeklyDigest ??
      existing?.weeklyDigest ??
      PREF_DEFAULTS.weeklyDigest,
    whatsappStrongMatch:
      patch.whatsappStrongMatch ??
      existing?.whatsappStrongMatch ??
      PREF_DEFAULTS.whatsappStrongMatch,
    whatsappApplicationStatus:
      patch.whatsappApplicationStatus ??
      existing?.whatsappApplicationStatus ??
      PREF_DEFAULTS.whatsappApplicationStatus,
    whatsappInterviewReminder:
      patch.whatsappInterviewReminder ??
      existing?.whatsappInterviewReminder ??
      PREF_DEFAULTS.whatsappInterviewReminder,
    whatsappWeeklyDigest:
      patch.whatsappWeeklyDigest ??
      existing?.whatsappWeeklyDigest ??
      PREF_DEFAULTS.whatsappWeeklyDigest,
    digestDow:
      patch.digestDow ?? existing?.digestDow ?? PREF_DEFAULTS.digestDow,
    digestHour:
      patch.digestHour ?? existing?.digestHour ?? PREF_DEFAULTS.digestHour,
    digestTz:
      digestTzPatch !== undefined ? digestTzPatch : existing?.digestTz ?? null,
  };

  await db
    .insert(notificationPrefsTable)
    .values({ userId: me.id, ...merged, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: notificationPrefsTable.userId,
      set: { ...merged, updatedAt: new Date() },
    });

  const effectiveTz = await resolveDigestTz(me.candidateId ?? null, merged.digestTz);
  res.json({ ...merged, effectiveDigestTz: effectiveTz });
});

// --- Weekly digest preview ------------------------------------------------

/**
 * Per-candidate "send me a preview" rate limit. In-memory by design:
 * the rate limit is a UX guard against accidental double-taps and
 * mild abuse, not a security control — losing it across deploys is
 * fine, and the cost of one extra preview email per candidate per
 * deploy is negligible. Keyed by candidateId (not userId) because the
 * digest itself is candidate-scoped. The map grows by at most one
 * entry per candidate that ever previews, which is fine at our scale;
 * if it ever needs pruning, swap in a TTL cache here.
 */
const PREVIEW_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const digestPreviewLastFiredAt = new Map<number, number>();

function consumeDigestPreviewSlot(candidateId: number, now: number): {
  ok: boolean;
  retryAfterSeconds: number;
} {
  const last = digestPreviewLastFiredAt.get(candidateId);
  if (last != null && now - last < PREVIEW_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((PREVIEW_COOLDOWN_MS - (now - last)) / 1000),
    };
  }
  digestPreviewLastFiredAt.set(candidateId, now);
  return { ok: true, retryAfterSeconds: 0 };
}

router.post("/me/digest-preview", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Weekly digest is candidate-only" });
    return;
  }
  const candidateId = me.candidateId;

  const now = Date.now();
  const slot = consumeDigestPreviewSlot(candidateId, now);
  if (!slot.ok) {
    res.setHeader("Retry-After", String(slot.retryAfterSeconds));
    res.status(429).json({
      error:
        "You can only send a preview once per hour. Please try again later.",
      retryAfterSeconds: slot.retryAfterSeconds,
    });
    return;
  }

  // Use the candidate's effective digest timezone for the reporting
  // window so the preview summarises the same Mon→Mon week the real
  // worker would summarise at the next slot fire.
  const [prefRow] = await db
    .select({ digestTz: notificationPrefsTable.digestTz })
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.userId, me.id))
    .limit(1);
  const effectiveTz = await resolveDigestTz(
    candidateId,
    prefRow?.digestTz ?? null,
  );
  const { start, end, localWeekStartDate } = previousCompleteWeekLocal(
    effectiveTz,
  );

  try {
    await runDigestForCandidate(
      candidateId,
      start,
      end,
      localWeekStartDate,
      { preview: true },
    );
    res.json({ ok: true, weekStart: localWeekStartDate });
  } catch (err) {
    // Roll the rate-limit slot back so the candidate isn't punished
    // for a server-side failure — they should be able to retry
    // immediately once we recover.
    digestPreviewLastFiredAt.delete(candidateId);
    req.log.warn({ err, candidateId }, "digest preview failed");
    res.status(500).json({ error: "Failed to send digest preview" });
  }
});

// --- For You feed --------------------------------------------------------

router.get("/me/feed", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "For You feed is candidate-only" });
    return;
  }
  const candidateId = me.candidateId;

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, candidateId))
    .limit(1);
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Pull dismissed job ids and applied job ids; both filter the feed.
  const dismissed = await db
    .select({ jobId: candidateDismissedJobsTable.jobId })
    .from(candidateDismissedJobsTable)
    .where(eq(candidateDismissedJobsTable.candidateId, candidateId));
  const dismissedSet = new Set(dismissed.map((r) => r.jobId));

  const applied = await db.execute(
    sql`select job_id as "jobId" from applications where candidate_id = ${candidateId}`,
  );
  const appliedSet = new Set(
    (applied.rows as { jobId: number }[]).map((r) => r.jobId),
  );

  const jobs = await db
    .select({ job: jobsTable, employer: employersTable })
    .from(jobsTable)
    .leftJoin(employersTable, eq(jobsTable.employerId, employersTable.id))
    .limit(500);

  const ranked = jobs
    .filter(
      ({ job }) => !dismissedSet.has(job.id) && !appliedSet.has(job.id),
    )
    .map(({ job, employer }) => {
      const breakdown = calculateMatchScore(
        job.skills,
        candidate.skills,
        candidate.yearsExperience,
        candidate.talentScore,
      );
      const tier = (job.tier ?? "free") as "free" | "promoted" | "sponsored";
      const tierBias = tier === "sponsored" ? 25 : tier === "promoted" ? 10 : 0;
      return {
        jobId: job.id,
        title: job.title,
        description: job.description,
        location: job.location,
        type: job.type,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        skills: job.skills,
        employer: employer
          ? {
              id: employer.id,
              name: employer.name,
              logoUrl: employer.logoUrl,
              industry: employer.industry,
              location: employer.location,
            }
          : null,
        matchScore: Math.min(100, breakdown.score + tierBias),
        matchedSkills: breakdown.matchedSkills,
        missingSkills: breakdown.missingSkills,
        summary: breakdown.summary,
        tier,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 30);

  res.json({ items: ranked });
});

router.post("/me/feed/dismiss", async (req, res) => {
  const parsed = z
    .object({ jobId: z.number().int().positive() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  try {
    await db
      .insert(candidateDismissedJobsTable)
      .values({ candidateId: me.candidateId, jobId: parsed.data.jobId })
      .onConflictDoNothing();
  } catch (err) {
    req.log.warn({ err }, "dismiss feed job failed");
  }
  res.json({ ok: true });
});

/**
 * Used by the mobile one-tap apply confirm sheet. Returns the cached
 * AI CV text + a candidate snapshot so the UI can show what's about to
 * be submitted without firing the heavier `/candidates/:id` query.
 */
router.get("/me/apply-snapshot", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  const [c] = await db
    .select({
      id: candidatesTable.id,
      fullName: candidatesTable.fullName,
      headline: candidatesTable.headline,
      avatarUrl: candidatesTable.avatarUrl,
      skills: candidatesTable.skills,
      aiCvText: candidatesTable.aiCvText,
      aiCvUnlocked: candidatesTable.aiCvUnlocked,
    })
    .from(candidatesTable)
    .where(eq(candidatesTable.id, me.candidateId))
    .limit(1);
  if (!c) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json({
    candidate: {
      id: c.id,
      fullName: c.fullName,
      headline: c.headline,
      avatarUrl: c.avatarUrl,
      skills: c.skills,
    },
    cv: {
      hasGeneratedCv: Boolean(c.aiCvText),
      aiCvUnlocked: c.aiCvUnlocked,
      preview: c.aiCvText ? c.aiCvText.slice(0, 400) : null,
    },
  });
});

// --- WhatsApp number verification ---------------------------------------

/**
 * Per-user rate limit on OTP issuance. In-memory by design (same
 * tradeoff as the digest preview cooldown above) — losing it across
 * deploys is fine; the cost of one extra OTP is negligible and the
 * provider has its own rate caps.
 */
const WA_OTP_COOLDOWN_MS = 60 * 1000; // 1 minute between sends
const WA_OTP_TTL_MS = 10 * 60 * 1000; // 10 minute lifetime
const WA_OTP_MAX_ATTEMPTS = 5;

const WhatsAppStartBody = z.object({
  number: z.string().min(6).max(32),
});

router.get("/me/whatsapp", async (req, res) => {
  const me = req.currentUser!;
  const [u] = await db
    .select({
      whatsappNumber: usersTable.whatsappNumber,
      whatsappVerifiedAt: usersTable.whatsappVerifiedAt,
      whatsappOtpExpiresAt: usersTable.whatsappOtpExpiresAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, me.id))
    .limit(1);
  res.json({
    number: u?.whatsappNumber ?? null,
    verified: !!u?.whatsappVerifiedAt,
    verifiedAt: u?.whatsappVerifiedAt?.toISOString() ?? null,
    pendingVerification:
      !!u?.whatsappOtpExpiresAt &&
      u.whatsappOtpExpiresAt.getTime() > Date.now() &&
      !u.whatsappVerifiedAt,
  });
});

router.post("/me/whatsapp/start-verification", async (req, res) => {
  const parsed = WhatsAppStartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.currentUser!;
  const normalized = normalizeE164(parsed.data.number);
  if (!normalized) {
    res
      .status(400)
      .json({ error: "Enter a valid phone number including country code." });
    return;
  }

  // Generate a 6-digit OTP up-front so we can persist its hash in the
  // same atomic UPDATE that enforces the per-user cooldown. We never
  // store the plaintext code — a database leak can't be replayed.
  const now = Date.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const otpHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(now + WA_OTP_TTL_MS);

  // Atomic cooldown enforcement. The previous OTP was issued at
  // (whatsappOtpExpiresAt - TTL); cooldown is satisfied iff that
  // moment was >= COOLDOWN_MS ago, i.e.
  //   whatsappOtpExpiresAt <= NOW() + (TTL - COOLDOWN).
  // Doing this as a single conditional UPDATE…RETURNING means two
  // concurrent requests can't both race past the cooldown, and it
  // works correctly across multiple API instances (where an in-memory
  // Map would not).
  const cooldownSlackMs = WA_OTP_TTL_MS - WA_OTP_COOLDOWN_MS;
  const updated = await db
    .update(usersTable)
    .set({
      whatsappNumber: normalized,
      whatsappOtpHash: otpHash,
      whatsappOtpExpiresAt: expiresAt,
      whatsappOtpAttempts: 0,
      // Preserve verification on a plain resend (same number, already
      // verified). Only clear when the user is switching numbers, so a
      // "Resend code" tap doesn't temporarily disable WA dispatch.
      whatsappVerifiedAt: sql`CASE WHEN ${usersTable.whatsappNumber} = ${normalized} THEN ${usersTable.whatsappVerifiedAt} ELSE NULL END`,
    })
    .where(
      and(
        eq(usersTable.id, me.id),
        sql`(${usersTable.whatsappOtpExpiresAt} IS NULL OR ${usersTable.whatsappOtpExpiresAt} <= NOW() + (${cooldownSlackMs}::int * INTERVAL '1 millisecond'))`,
      ),
    )
    .returning({ id: usersTable.id });

  if (updated.length === 0) {
    // Read back the current expiry to compute an honest Retry-After.
    const [cur] = await db
      .select({ whatsappOtpExpiresAt: usersTable.whatsappOtpExpiresAt })
      .from(usersTable)
      .where(eq(usersTable.id, me.id))
      .limit(1);
    let retryAfter = Math.ceil(WA_OTP_COOLDOWN_MS / 1000);
    if (cur?.whatsappOtpExpiresAt) {
      const issuedAt = cur.whatsappOtpExpiresAt.getTime() - WA_OTP_TTL_MS;
      retryAfter = Math.max(
        1,
        Math.ceil((issuedAt + WA_OTP_COOLDOWN_MS - now) / 1000),
      );
    }
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Please wait before requesting another code.",
      retryAfter,
    });
    return;
  }

  // Best-effort send; the WhatsApp library never throws.
  const result = await sendWhatsAppTemplate({
    userId: me.id,
    to: normalized,
    category: "otp",
    templateKey: "otp_verification",
    params: { code },
  });

  // When no provider is configured we expose the code in the response
  // so the developer can complete the flow locally. In production
  // (sent === true) we never echo the code back.
  const body: {
    ok: true;
    sent: boolean;
    devCode?: string;
    devReason?: string;
  } = {
    ok: true,
    sent: result.sent,
  };
  if (!result.sent) {
    body.devReason = result.reason;
    if (process.env.NODE_ENV !== "production") {
      body.devCode = code;
    }
  }
  res.json(body);
});

const WhatsAppConfirmBody = z.object({
  code: z.string().regex(/^\d{4,8}$/),
});

router.post("/me/whatsapp/confirm", async (req, res) => {
  const parsed = WhatsAppConfirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the code we sent on WhatsApp." });
    return;
  }
  const me = req.currentUser!;

  // Atomic "charge an attempt" — only succeeds when there's an active
  // (non-expired) OTP and the attempt counter is still under the cap.
  // Returning the hash + new counter lets us run the bcrypt compare
  // off the row we just locked, with no read-then-write race.
  const charged = await db
    .update(usersTable)
    .set({
      whatsappOtpAttempts: sql`${usersTable.whatsappOtpAttempts} + 1`,
    })
    .where(
      and(
        eq(usersTable.id, me.id),
        sql`${usersTable.whatsappOtpHash} IS NOT NULL`,
        sql`${usersTable.whatsappOtpExpiresAt} > NOW()`,
        sql`${usersTable.whatsappOtpAttempts} < ${WA_OTP_MAX_ATTEMPTS}`,
      ),
    )
    .returning({
      whatsappOtpHash: usersTable.whatsappOtpHash,
      whatsappOtpAttempts: usersTable.whatsappOtpAttempts,
    });

  if (charged.length === 0) {
    // Disambiguate: was there nothing to verify, expired, or capped?
    const [cur] = await db
      .select({
        whatsappOtpHash: usersTable.whatsappOtpHash,
        whatsappOtpExpiresAt: usersTable.whatsappOtpExpiresAt,
        whatsappOtpAttempts: usersTable.whatsappOtpAttempts,
      })
      .from(usersTable)
      .where(eq(usersTable.id, me.id))
      .limit(1);
    if (!cur || !cur.whatsappOtpHash || !cur.whatsappOtpExpiresAt) {
      res.status(400).json({
        error: "No active verification — please request a new code.",
      });
      return;
    }
    if (cur.whatsappOtpExpiresAt.getTime() < Date.now()) {
      res
        .status(400)
        .json({ error: "Code expired — please request a new one." });
      return;
    }
    res
      .status(429)
      .json({ error: "Too many attempts — please request a new code." });
    return;
  }

  const row = charged[0]!;
  const ok =
    row.whatsappOtpHash !== null &&
    (await bcrypt.compare(parsed.data.code, row.whatsappOtpHash));
  if (!ok) {
    res.status(400).json({ error: "That code didn't match." });
    return;
  }

  // Success — clear OTP state, stamp verified.
  await db
    .update(usersTable)
    .set({
      whatsappVerifiedAt: new Date(),
      whatsappOtpHash: null,
      whatsappOtpExpiresAt: null,
      whatsappOtpAttempts: 0,
    })
    .where(eq(usersTable.id, me.id));
  res.json({ ok: true, verified: true });
});

router.delete("/me/whatsapp", async (req, res) => {
  const me = req.currentUser!;
  // Disconnect: drop number and verification, and turn off all WA
  // toggles so the dispatcher stops trying to send.
  await db
    .update(usersTable)
    .set({
      whatsappNumber: null,
      whatsappVerifiedAt: null,
      whatsappOtpHash: null,
      whatsappOtpExpiresAt: null,
      whatsappOtpAttempts: 0,
    })
    .where(eq(usersTable.id, me.id));
  await db
    .insert(notificationPrefsTable)
    .values({
      userId: me.id,
      whatsappStrongMatch: false,
      whatsappApplicationStatus: false,
      whatsappInterviewReminder: false,
      whatsappWeeklyDigest: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: notificationPrefsTable.userId,
      set: {
        whatsappStrongMatch: false,
        whatsappApplicationStatus: false,
        whatsappInterviewReminder: false,
        whatsappWeeklyDigest: false,
        updatedAt: new Date(),
      },
    });
  res.json({ ok: true });
});

export default router;
