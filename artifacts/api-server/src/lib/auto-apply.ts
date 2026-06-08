import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  autoApplySettingsTable,
  autoApplySubscriptionsTable,
  autoApplyLogTable,
  candidatesTable,
  jobsTable,
  applicationsTable,
  jobChallengesTable,
} from "@workspace/db";
import { calculateMatchScore } from "./matching";
import { createApplicationRecord } from "./application-create";
import { sendNotificationToCandidate } from "./notifier";
import { logger } from "./logger";

/**
 * AI Auto-Apply engine.
 *
 * When a candidate has opted in (`candidates.auto_apply_enabled`), holds an
 * active paid subscription, and the global admin switch is on, the platform
 * submits an application on their behalf to any open public job that scores at
 * or above the admin-configured `matchThreshold`.
 *
 * Two entry points share one submit path (`attemptAutoApply`):
 *  - `runAutoApplyForJob(jobId)` fires from the POST /jobs fan-out so a brand
 *    new posting reaches subscribed candidates immediately.
 *  - `runAutoApplyPass()` is the periodic backstop (booted in index.ts) that
 *    catches candidates who subscribed after a job was posted, or postings the
 *    fan-out missed.
 *
 * Every guard (global switch, per-candidate toggle, subscription validity,
 * threshold, daily cap, dedupe, challenge-gating, soft-delete/visibility) is
 * enforced server-side here — never trusted from a client.
 */

export const AUTO_APPLY_SETTINGS_ROW_ID = 1;

export type AutoApplySettingsRow = typeof autoApplySettingsTable.$inferSelect;
export type AutoApplySubscriptionRow =
  typeof autoApplySubscriptionsTable.$inferSelect;

/**
 * Load (and lazily seed) the singleton settings row. Same convention as
 * boost / institution-subscription settings: defaults live in the schema, and
 * the row is created inactive so an admin must explicitly enable the feature.
 */
export async function loadOrSeedAutoApplySettings(): Promise<AutoApplySettingsRow> {
  const existing = await db
    .select()
    .from(autoApplySettingsTable)
    .where(eq(autoApplySettingsTable.id, AUTO_APPLY_SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(autoApplySettingsTable)
    .values({ id: AUTO_APPLY_SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(autoApplySettingsTable)
    .where(eq(autoApplySettingsTable.id, AUTO_APPLY_SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) throw new Error("Failed to seed auto_apply_settings row");
  return reread[0];
}

/**
 * Return the most relevant subscription row for a candidate: the newest one
 * that currently unlocks the feature if any exists, otherwise the newest row
 * (so the UI can show the latest pending/expired state).
 */
export async function loadCurrentAutoApplySubscription(
  candidateId: number,
): Promise<AutoApplySubscriptionRow | null> {
  const rows = await db
    .select()
    .from(autoApplySubscriptionsTable)
    .where(eq(autoApplySubscriptionsTable.candidateId, candidateId))
    .orderBy(desc(autoApplySubscriptionsTable.createdAt));
  if (rows.length === 0) return null;
  const unlocking = rows.find((r) => subscriptionUnlocksAutoApply(r));
  return unlocking ?? rows[0]!;
}

/**
 * A subscription unlocks the feature only while it is active/trialing AND its
 * paid period has not lapsed. `now` is injectable so the gate is deterministic
 * under test.
 */
export function subscriptionUnlocksAutoApply(
  row: AutoApplySubscriptionRow | null,
  now: number = Date.now(),
): boolean {
  if (!row) return false;
  if (row.status !== "active" && row.status !== "trialing") return false;
  return !!(row.currentPeriodEnd && row.currentPeriodEnd.getTime() > now);
}

/**
 * The three eligibility gates that decide whether the engine may act for a
 * candidate at all, evaluated before any per-job work:
 *  - the global admin switch must be on,
 *  - the candidate must have opted in, and
 *  - they must hold a subscription that currently unlocks the feature.
 *
 * Pure (no DB) so it can be unit-tested in isolation. The live engine enforces
 * the candidate-opt-in gate structurally too (`loadOptedInCandidates` only
 * returns rows with `auto_apply_enabled = true`) and the global gate via an
 * early return, so passing `candidateEnabled: true`/`globalActive: true` there
 * is faithful — this helper centralises the rule.
 */
export function candidateEligibleForAutoApply(input: {
  globalActive: boolean;
  candidateEnabled: boolean;
  subscription: AutoApplySubscriptionRow | null;
  now?: number;
}): boolean {
  if (!input.globalActive) return false;
  if (!input.candidateEnabled) return false;
  return subscriptionUnlocksAutoApply(input.subscription, input.now);
}

export type AutoApplySubmitReason =
  | "below-threshold"
  | "already-applied"
  | "daily-cap-reached";

export type AutoApplySubmitDecision =
  | { proceed: true }
  | { proceed: false; reason: AutoApplySubmitReason };

/**
 * The per-job submit gates, evaluated in the exact order the engine applies
 * them: match threshold → dedupe against an existing application → rolling-24h
 * daily cap. Pure (no DB) so it can be unit-tested in isolation.
 *
 * The ordering is load-bearing: the dedupe gate (`already-applied`) is checked
 * BEFORE the daily cap so a pre-existing (often manual) application can never
 * consume the cap nor cause the engine to write an `auto_apply_log` row for an
 * application it didn't submit.
 *
 * `score` is the already-rounded match score (the engine rounds before
 * comparing), matching `settings.matchThreshold`'s integer scale.
 */
export function decideAutoApplySubmit(input: {
  score: number;
  matchThreshold: number;
  hasExistingApplication: boolean;
  dailyCapUsed: number;
  dailyCap: number;
}): AutoApplySubmitDecision {
  if (input.score < input.matchThreshold) {
    return { proceed: false, reason: "below-threshold" };
  }
  if (input.hasExistingApplication) {
    return { proceed: false, reason: "already-applied" };
  }
  if (input.dailyCapUsed >= input.dailyCap) {
    return { proceed: false, reason: "daily-cap-reached" };
  }
  return { proceed: true };
}

type EligibleCandidate = {
  id: number;
  skills: string[];
  yearsExperience: number;
  talentScore: number;
};

type OpenJob = {
  id: number;
  title: string;
  skills: string[];
  visibility: string;
  deletedAt: Date | null;
};

async function countAutoAppliesLast24h(candidateId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(autoApplyLogTable)
    .where(
      and(
        eq(autoApplyLogTable.candidateId, candidateId),
        gt(autoApplyLogTable.createdAt, since),
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * Attempt a single auto-application of `candidate` to `job`. Returns true only
 * when a new application was actually inserted. Self-contained guards:
 *  - score must clear `settings.matchThreshold`
 *  - rolling-24h daily cap must have room
 *  - candidate must not already have an application for this job
 *
 * Callers are responsible for ensuring the job is open (not soft-deleted,
 * public) and NOT challenge-gated before calling — both entry points filter
 * those out so we don't re-query per candidate.
 */
async function attemptAutoApply(
  candidate: EligibleCandidate,
  job: OpenJob,
  settings: AutoApplySettingsRow,
): Promise<boolean> {
  const { score } = calculateMatchScore(
    job.skills,
    candidate.skills,
    candidate.yearsExperience,
    candidate.talentScore,
  );
  const rounded = Math.round(score);
  // Cheap gate first: skip the DB lookups entirely for below-threshold pairs.
  if (
    !decideAutoApplySubmit({
      score: rounded,
      matchThreshold: settings.matchThreshold,
      hasExistingApplication: false,
      dailyCapUsed: 0,
      dailyCap: settings.dailyCap,
    }).proceed
  ) {
    return false;
  }

  // Dedupe against any existing application (auto or manual). We deliberately
  // do NOT write an auto_apply_log row here: that table is the source of truth
  // for both the rolling-24h daily cap and the candidate-facing "recent
  // auto-applications" feed. Logging a pre-existing (often manual) application
  // would consume the cap for an application the engine never submitted and
  // would falsely report it as an auto-apply. The applications-table check
  // below is enough to prevent a duplicate submission; re-evaluating this pair
  // on a later pass is cheap and harmless.
  const existing = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, job.id),
        eq(applicationsTable.candidateId, candidate.id),
      ),
    )
    .limit(1);
  const hasExistingApplication = !!existing[0];

  // Skip the (more expensive) rolling-24h count when we already know this is a
  // duplicate — the dedupe gate would short-circuit anyway.
  const used = hasExistingApplication
    ? 0
    : await countAutoAppliesLast24h(candidate.id);

  // Final submit decision through the single pure gate. The ordering
  // (threshold → dedupe → daily cap) guarantees a pre-existing application
  // returns `already-applied` and never reaches the write/log path below.
  if (
    !decideAutoApplySubmit({
      score: rounded,
      matchThreshold: settings.matchThreshold,
      hasExistingApplication,
      dailyCapUsed: used,
      dailyCap: settings.dailyCap,
    }).proceed
  ) {
    return false;
  }

  let applicationId: number | null = null;
  try {
    await db.transaction(async (tx) => {
      // Final challenge gate, INSIDE the write transaction. Callers
      // (runAutoApplyForJob / runAutoApplyPass) pre-filter gated jobs, but that
      // snapshot can go stale — a challenge may be attached (POST /jobs,
      // PUT /jobs/:id/challenge) between the pre-filter and this insert. Re-check
      // immediately before creating the application so a challenge-gated job can
      // never receive an auto-submitted application, mirroring the manual
      // POST /applications gate. Lock the job row FOR UPDATE so a concurrent
      // challenge-attach that also touches the job serializes against us.
      await tx
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(eq(jobsTable.id, job.id))
        .for("update")
        .limit(1);
      const gate = await tx
        .select({ id: jobChallengesTable.id })
        .from(jobChallengesTable)
        .where(eq(jobChallengesTable.jobId, job.id))
        .limit(1);
      if (gate[0]) throw new AutoApplyGated();
      // Reuse the single source of truth for application creation (insert +
      // status-history seed + mock-interview link) so the auto-apply path can
      // never drift from the manual POST /applications path.
      const appId = await createApplicationRecord(tx, {
        jobId: job.id,
        candidateId: candidate.id,
        source: "auto_apply",
        matchScore: rounded,
        changedBy: null,
      });
      // UNIQUE(candidate_id, job_id) guards against a concurrent duplicate.
      const loggedRows = await tx
        .insert(autoApplyLogTable)
        .values({
          candidateId: candidate.id,
          jobId: job.id,
          applicationId: appId,
          matchScore: rounded,
        })
        .onConflictDoNothing()
        .returning({ id: autoApplyLogTable.id });
      if (loggedRows.length === 0) {
        // Another worker already auto-applied this exact pair — roll back the
        // application we just inserted so we don't create a duplicate.
        throw new AutoApplyDuplicate();
      }
      applicationId = appId;
    });
  } catch (err) {
    if (err instanceof AutoApplyDuplicate) return false;
    if (err instanceof AutoApplyGated) return false;
    logger.warn(
      { err, candidateId: candidate.id, jobId: job.id },
      "auto-apply: submit failed",
    );
    return false;
  }

  if (applicationId == null) return false;

  void sendNotificationToCandidate(candidate.id, {
    kind: "auto_apply",
    title: "Auto-Apply submitted an application",
    body: `We applied to "${job.title}" on your behalf — you're a ${rounded}% match.`,
    link: `/account/applications`,
    category: "applicationStatus",
    data: { jobId: job.id, applicationId, score: rounded, autoApply: true },
  }).catch(() => {});

  return true;
}

class AutoApplyDuplicate extends Error {}
/** A challenge was attached to the job before the application could be inserted. */
class AutoApplyGated extends Error {}

/**
 * For a challenge-gated job the engine can't submit on a candidate's behalf — a
 * manual challenge submission is required. Instead of skipping silently, notify
 * each eligible candidate who clears the match threshold and hasn't already
 * applied, so they can take the quick test themselves. Best-effort. Only
 * invoked from the POST /jobs fan-out (once per posting) so candidates aren't
 * re-nudged on every periodic pass.
 */
async function notifyEligibleCandidatesOfGatedJob(
  job: OpenJob,
  settings: AutoApplySettingsRow,
): Promise<void> {
  const candidates = await loadOptedInCandidates();
  let processed = 0;
  for (const candidate of candidates) {
    if (processed >= 500) break; // safety cap per posting
    processed += 1;
    const sub = await loadCurrentAutoApplySubscription(candidate.id);
    if (!subscriptionUnlocksAutoApply(sub)) continue;
    const { score } = calculateMatchScore(
      job.skills,
      candidate.skills,
      candidate.yearsExperience,
      candidate.talentScore,
    );
    const rounded = Math.round(score);
    if (rounded < settings.matchThreshold) continue;
    // Nothing to nudge if they've already applied (manual or auto).
    const existing = await db
      .select({ id: applicationsTable.id })
      .from(applicationsTable)
      .where(
        and(
          eq(applicationsTable.jobId, job.id),
          eq(applicationsTable.candidateId, candidate.id),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    void sendNotificationToCandidate(candidate.id, {
      kind: "auto_apply",
      title: "A matching job needs a quick skills test",
      body: `"${job.title}" is a ${rounded}% match, but it requires a short skill challenge before applying — so Auto-Apply couldn't submit for you. Take the test to apply.`,
      link: `/jobs/${job.id}`,
      category: "applicationStatus",
      data: { jobId: job.id, score: rounded, requiresChallenge: true },
    }).catch(() => {});
  }
}

/**
 * Fetch all opted-in, non-deleted candidates. Eligibility against the global
 * switch + subscription validity is checked per-candidate by callers.
 */
async function loadOptedInCandidates(): Promise<EligibleCandidate[]> {
  return db
    .select({
      id: candidatesTable.id,
      skills: candidatesTable.skills,
      yearsExperience: candidatesTable.yearsExperience,
      talentScore: candidatesTable.talentScore,
    })
    .from(candidatesTable)
    .where(
      and(
        eq(candidatesTable.autoApplyEnabled, true),
        isNull(candidatesTable.deletedAt),
      ),
    );
}

/**
 * Fire auto-apply for a single freshly-posted job. Best-effort and capped so a
 * slow notifier never blocks the POST /jobs response.
 */
export async function runAutoApplyForJob(jobId: number): Promise<void> {
  const settings = await loadOrSeedAutoApplySettings();
  if (!settings.isActive) return;

  const jobRows = await db
    .select({
      id: jobsTable.id,
      title: jobsTable.title,
      skills: jobsTable.skills,
      visibility: jobsTable.visibility,
      deletedAt: jobsTable.deletedAt,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  const job = jobRows[0];
  if (!job || job.deletedAt || job.visibility !== "public") return;

  // Challenge-gated jobs can't be auto-submitted (a manual challenge submission
  // is required). Rather than skip silently, notify matching eligible
  // candidates so they can take the test themselves, then stop.
  const challenge = await db
    .select({ id: jobChallengesTable.id })
    .from(jobChallengesTable)
    .where(eq(jobChallengesTable.jobId, jobId))
    .limit(1);
  if (challenge[0]) {
    await notifyEligibleCandidatesOfGatedJob(job, settings);
    return;
  }

  const candidates = await loadOptedInCandidates();
  let processed = 0;
  for (const candidate of candidates) {
    if (processed >= 500) break; // safety cap per posting
    const sub = await loadCurrentAutoApplySubscription(candidate.id);
    if (
      !candidateEligibleForAutoApply({
        globalActive: settings.isActive,
        candidateEnabled: true,
        subscription: sub,
      })
    ) {
      continue;
    }
    await attemptAutoApply(candidate, job, settings);
    processed += 1;
  }
}

let passRunning = false;

/**
 * Periodic backstop sweep. Walks every opted-in candidate with an active
 * subscription against the pool of recent open public jobs, submitting up to
 * each candidate's remaining daily cap.
 */
export async function runAutoApplyPass(): Promise<void> {
  if (passRunning) return; // never overlap with a previous slow tick
  passRunning = true;
  try {
    const settings = await loadOrSeedAutoApplySettings();
    if (!settings.isActive) return;

    const candidates = await loadOptedInCandidates();
    if (candidates.length === 0) return;

    const openJobs = await db
      .select({
        id: jobsTable.id,
        title: jobsTable.title,
        skills: jobsTable.skills,
        visibility: jobsTable.visibility,
        deletedAt: jobsTable.deletedAt,
      })
      .from(jobsTable)
      .where(
        and(isNull(jobsTable.deletedAt), eq(jobsTable.visibility, "public")),
      )
      .orderBy(desc(jobsTable.postedAt))
      .limit(500);
    if (openJobs.length === 0) return;

    // Filter out challenge-gated jobs once, up front.
    const jobIds = openJobs.map((j) => j.id);
    const gated = await db
      .select({ jobId: jobChallengesTable.jobId })
      .from(jobChallengesTable)
      .where(inArray(jobChallengesTable.jobId, jobIds));
    const gatedSet = new Set(gated.map((g) => g.jobId));
    const eligibleJobs = openJobs.filter((j) => !gatedSet.has(j.id));
    if (eligibleJobs.length === 0) return;

    for (const candidate of candidates) {
      const sub = await loadCurrentAutoApplySubscription(candidate.id);
      if (
        !candidateEligibleForAutoApply({
          globalActive: settings.isActive,
          candidateEnabled: true,
          subscription: sub,
        })
      ) {
        continue;
      }
      const used = await countAutoAppliesLast24h(candidate.id);
      let remaining = settings.dailyCap - used;
      if (remaining <= 0) continue;
      for (const job of eligibleJobs) {
        if (remaining <= 0) break;
        const submitted = await attemptAutoApply(candidate, job, settings);
        if (submitted) remaining -= 1;
      }
    }
  } catch (err) {
    logger.error({ err }, "auto-apply pass crashed");
  } finally {
    passRunning = false;
  }
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let schedulerStarted = false;

/**
 * Boot the periodic auto-apply backstop. Deferred so it doesn't block startup;
 * runs every 6 hours thereafter. Unref'd so it never keeps the process alive.
 */
export function startAutoApplyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = () => {
    void runAutoApplyPass();
  };
  setTimeout(tick, 60_000);
  setInterval(tick, SIX_HOURS_MS).unref();
}
