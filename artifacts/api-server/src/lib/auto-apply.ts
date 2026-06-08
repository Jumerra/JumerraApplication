import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  autoApplySettingsTable,
  autoApplySubscriptionsTable,
  autoApplyLogTable,
  candidatesTable,
  jobsTable,
  applicationsTable,
  applicationStatusHistoryTable,
  jobChallengesTable,
} from "@workspace/db";
import { calculateMatchScore } from "./matching";
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
 * paid period has not lapsed.
 */
export function subscriptionUnlocksAutoApply(
  row: AutoApplySubscriptionRow | null,
): boolean {
  if (!row) return false;
  if (row.status !== "active" && row.status !== "trialing") return false;
  return !!(row.currentPeriodEnd && row.currentPeriodEnd.getTime() > Date.now());
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
  if (rounded < settings.matchThreshold) return false;

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
  if (existing[0]) return false;

  // Daily cap (defensive — periodic pass also tracks remaining locally).
  const used = await countAutoAppliesLast24h(candidate.id);
  if (used >= settings.dailyCap) return false;

  let applicationId: number | null = null;
  try {
    await db.transaction(async (tx) => {
      const created = await tx
        .insert(applicationsTable)
        .values({
          jobId: job.id,
          candidateId: candidate.id,
          status: "applied",
          matchScore: rounded,
          source: "auto_apply",
        })
        .returning({ id: applicationsTable.id });
      const appId = created[0]?.id;
      if (!appId) throw new Error("auto-apply: application insert returned no id");
      await tx.insert(applicationStatusHistoryTable).values({
        applicationId: appId,
        status: "applied",
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

  // Skip challenge-gated jobs entirely — a manual challenge submission is
  // required there, which auto-apply cannot complete.
  const challenge = await db
    .select({ id: jobChallengesTable.id })
    .from(jobChallengesTable)
    .where(eq(jobChallengesTable.jobId, jobId))
    .limit(1);
  if (challenge[0]) return;

  const candidates = await loadOptedInCandidates();
  let processed = 0;
  for (const candidate of candidates) {
    if (processed >= 500) break; // safety cap per posting
    const sub = await loadCurrentAutoApplySubscription(candidate.id);
    if (!subscriptionUnlocksAutoApply(sub)) continue;
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
      if (!subscriptionUnlocksAutoApply(sub)) continue;
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
