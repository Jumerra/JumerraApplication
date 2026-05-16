/**
 * Server-level test harness for the weekly digest worker (task #56).
 *
 * Covers:
 *   1. `runDigestForCandidate` picks the right top-5 unseen matches —
 *      jobs the candidate has applied to, dismissed, or already
 *      received in a prior digest are excluded; the remaining set is
 *      ranked by match score and capped at 5.
 *   2. With `weeklyDigest=true`, the worker dispatches via
 *      `sendNotificationToCandidate` — observable as a `weekly_digest`
 *      in-app row carrying the "N new matches" title produced by the
 *      dispatch branch, plus a fired Expo push.
 *   3. With `weeklyDigest=false`, the dispatch branch is skipped — no
 *      push is sent and the in-app row uses the opted-out title.
 *   4. The `candidate_weekly_digests` row is always written, regardless
 *      of the candidate's preference (the dashboard "Your week" card
 *      must keep rendering for opted-out users).
 *
 * Usage: pnpm --filter @workspace/api-server run test:weekly-digest
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  applicationsTable,
  candidateDismissedJobsTable,
  candidatesTable,
  candidateWeeklyDigestsTable,
  employersTable,
  expoPushTokensTable,
  jobsTable,
  notificationPrefsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  previousCompleteWeekLocal,
  runDigestForCandidate,
} from "../src/lib/digest-worker";

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];
let passed = 0;
let failures = 0;

function tag(): string {
  return randomBytes(4).toString("hex");
}

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed += 1;
    console.log(`  \u2713 ${msg}`);
  } else {
    failures += 1;
    console.error(`  \u2717 ${msg}`);
  }
}

// ---------- fetch stub --------------------------------------------------

type CapturedPush = { to: string; title: string; body: string; data?: unknown };
let captured: CapturedPush[] = [];
const realFetch = globalThis.fetch;

function installFetchStub(): void {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("exp.host")) {
      const body = init?.body ? JSON.parse(String(init.body)) : [];
      const msgs = Array.isArray(body) ? body : [body];
      for (const m of msgs) captured.push(m as CapturedPush);
      const tickets = msgs.map(() => ({ status: "ok", id: "test" }));
      return new Response(JSON.stringify({ data: tickets }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input as Parameters<typeof fetch>[0], init as RequestInit);
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

async function waitForPushes(
  expected: number,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (captured.length >= expected) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------- fixtures ----------------------------------------------------

async function createCandidateWithUser(skills: string[]): Promise<{
  candidateId: number;
  userId: number;
}> {
  const t = tag();
  const [cand] = await db
    .insert(candidatesTable)
    .values({
      fullName: `Cand ${t}`,
      headline: "h",
      bio: "b",
      location: "Testville",
      email: `cand-${t}@test.local`,
      phone: "",
      avatarUrl: "",
      skills,
      yearsExperience: 2,
      talentScore: 75,
    })
    .returning({ id: candidatesTable.id });
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `user-${t}@test.local`,
      role: "candidate",
      status: "active",
      fullName: `Cand ${t}`,
      candidateId: cand.id,
    })
    .returning({ id: usersTable.id });
  cleanups.push(async () => {
    await db
      .delete(notificationsTable)
      .where(eq(notificationsTable.userId, user.id));
    await db
      .delete(expoPushTokensTable)
      .where(eq(expoPushTokensTable.userId, user.id));
    await db
      .delete(notificationPrefsTable)
      .where(eq(notificationPrefsTable.userId, user.id));
    await db
      .delete(candidateWeeklyDigestsTable)
      .where(eq(candidateWeeklyDigestsTable.candidateId, cand.id));
    await db
      .delete(applicationsTable)
      .where(eq(applicationsTable.candidateId, cand.id));
    await db
      .delete(candidateDismissedJobsTable)
      .where(eq(candidateDismissedJobsTable.candidateId, cand.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db.delete(candidatesTable).where(eq(candidatesTable.id, cand.id));
  });
  return { candidateId: cand.id, userId: user.id };
}

async function createEmployer(): Promise<number> {
  const t = tag();
  const [row] = await db
    .insert(employersTable)
    .values({
      name: `TestCo ${t}`,
      tagline: "t",
      description: "t",
      industry: "t",
      location: "Testville",
      logoUrl: "",
      coverUrl: "",
      websiteUrl: "",
      size: "1-10",
    })
    .returning({ id: employersTable.id });
  cleanups.push(async () => {
    await db.delete(employersTable).where(eq(employersTable.id, row.id));
  });
  return row.id;
}

async function createJob(
  employerId: number,
  skills: string[],
): Promise<number> {
  const t = tag();
  const [row] = await db
    .insert(jobsTable)
    .values({
      employerId,
      title: `Test Job ${t}`,
      type: "full_time",
      location: "Testville",
      remote: false,
      summary: "s",
      description: "d",
      skills,
    })
    .returning({ id: jobsTable.id });
  cleanups.push(async () => {
    await db.delete(jobsTable).where(eq(jobsTable.id, row.id));
  });
  return row.id;
}

async function registerPushToken(userId: number): Promise<void> {
  const token = `ExponentPushToken[${tag()}${tag()}]`;
  await db.insert(expoPushTokensTable).values({
    userId,
    token,
    platform: "ios",
  });
}

async function setWeeklyDigestPref(userId: number, on: boolean): Promise<void> {
  await db
    .insert(notificationPrefsTable)
    .values({
      userId,
      strongMatch: true,
      applicationStatus: true,
      interviewReminder: true,
      profileViewed: true,
      weeklyDigest: on,
    })
    .onConflictDoUpdate({
      target: notificationPrefsTable.userId,
      set: { weeklyDigest: on },
    });
}

// ---------- tests -------------------------------------------------------

const SKILL = `digest-skill-${tag()}`;

async function testTopMatchesExcludeAppliedDismissedAndPriorDigest(): Promise<void> {
  console.log(
    "\n[1] runDigestForCandidate top-5 excludes applied / dismissed / previously-digested jobs",
  );
  const { candidateId } = await createCandidateWithUser([SKILL]);
  const employerId = await createEmployer();

  // 7 matching jobs total. We'll pre-mark one as applied, one as
  // dismissed, and one as previously-digested — leaving exactly 4
  // eligible. The selection should be capped at 5 but here naturally
  // produce 4.
  const jobIds: number[] = [];
  for (let i = 0; i < 7; i++) {
    jobIds.push(await createJob(employerId, [SKILL]));
  }
  const [appliedJob, dismissedJob, priorDigestJob, ...eligibleJobs] = jobIds;

  await db
    .insert(applicationsTable)
    .values({ jobId: appliedJob, candidateId, status: "applied" });
  await db.insert(candidateDismissedJobsTable).values({
    candidateId,
    jobId: dismissedJob,
  });
  // Seed a prior digest row containing priorDigestJob in its
  // newMatchesJson. Use a different week_start so the worker still
  // proceeds for the current window.
  await db.insert(candidateWeeklyDigestsTable).values({
    candidateId,
    weekStart: "1999-01-04",
    profileViews: 0,
    applicationsSent: 0,
    interviewsScheduled: 0,
    newMatchesJson: JSON.stringify([
      { jobId: priorDigestJob, title: "x", employerName: "x", matchScore: 0 },
    ]),
  });

  const { start, end, localWeekStartDate } = previousCompleteWeekLocal("UTC");
  await runDigestForCandidate(candidateId, start, end, localWeekStartDate);

  const [row] = await db
    .select()
    .from(candidateWeeklyDigestsTable)
    .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId))
    .orderBy(candidateWeeklyDigestsTable.id);
  // Fetch the row for the current window specifically.
  const rows = await db
    .select()
    .from(candidateWeeklyDigestsTable)
    .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId));
  const currentRow = rows.find((r) => r.weekStart === localWeekStartDate);
  assert(!!row, "a digest row exists for the candidate");
  assert(!!currentRow, "a digest row was written for the current week");

  const matches = JSON.parse(currentRow?.newMatchesJson ?? "[]") as {
    jobId: number;
  }[];
  const pickedIds = new Set(matches.map((m) => m.jobId));
  assert(
    matches.length <= 5,
    `picked at most 5 matches (got ${matches.length})`,
  );
  // Our eligible matching jobs share the unique SKILL with the
  // candidate so they score higher than any unrelated jobs in the
  // shared dev DB. They must all land in the top 5.
  const missingEligible = eligibleJobs.filter((id) => !pickedIds.has(id));
  assert(
    missingEligible.length === 0,
    `all ${eligibleJobs.length} eligible matching jobs are in the digest (missing ${JSON.stringify(missingEligible)})`,
  );
  assert(
    !pickedIds.has(appliedJob),
    "applied job is excluded from the digest",
  );
  assert(
    !pickedIds.has(dismissedJob),
    "dismissed job is excluded from the digest",
  );
  assert(
    !pickedIds.has(priorDigestJob),
    "previously-digested job is excluded from the digest",
  );
}

async function testTopMatchesCapsAtFive(): Promise<void> {
  console.log(
    "\n[2] runDigestForCandidate caps the new-matches list at the top 5",
  );
  const { candidateId } = await createCandidateWithUser([SKILL]);
  const employerId = await createEmployer();
  for (let i = 0; i < 8; i++) {
    await createJob(employerId, [SKILL]);
  }
  const { start, end, localWeekStartDate } = previousCompleteWeekLocal("UTC");
  await runDigestForCandidate(candidateId, start, end, localWeekStartDate);
  const [row] = await db
    .select()
    .from(candidateWeeklyDigestsTable)
    .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId));
  const matches = JSON.parse(row?.newMatchesJson ?? "[]") as unknown[];
  assert(matches.length === 5, `exactly 5 matches kept (got ${matches.length})`);
}

async function testDispatchWhenOptedIn(): Promise<void> {
  console.log(
    "\n[3] weeklyDigest=true → sendNotificationToCandidate is called (push fires, dispatch-branch title)",
  );
  const { candidateId, userId } = await createCandidateWithUser([SKILL]);
  await registerPushToken(userId);
  await setWeeklyDigestPref(userId, true);
  const employerId = await createEmployer();
  await createJob(employerId, [SKILL]);

  captured = [];
  const { start, end, localWeekStartDate } = previousCompleteWeekLocal("UTC");
  await runDigestForCandidate(candidateId, start, end, localWeekStartDate);
  await waitForPushes(1);

  assert(
    captured.length === 1,
    `weeklyDigest=true dispatched one push (got ${captured.length})`,
  );
  assert(
    captured[0]?.title?.startsWith("Your week on Jumerra:"),
    `push title is the dispatch-branch title (got "${captured[0]?.title ?? ""}")`,
  );

  const inApp = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  const digestRow = inApp.find((r) => r.kind === "weekly_digest");
  assert(!!digestRow, "in-app weekly_digest row exists");
  assert(
    digestRow?.title?.startsWith("Your week on Jumerra:") === true,
    "in-app row uses the dispatch-branch title (with colon + match count)",
  );
}

async function testNoDispatchWhenOptedOut(): Promise<void> {
  console.log(
    "\n[4] weeklyDigest=false → sendNotificationToCandidate is skipped, digest row still written",
  );
  const { candidateId, userId } = await createCandidateWithUser([SKILL]);
  await registerPushToken(userId);
  await setWeeklyDigestPref(userId, false);
  const employerId = await createEmployer();
  await createJob(employerId, [SKILL]);

  captured = [];
  const { start, end, localWeekStartDate } = previousCompleteWeekLocal("UTC");
  await runDigestForCandidate(candidateId, start, end, localWeekStartDate);
  await waitForPushes(1, 250);

  assert(
    captured.length === 0,
    `weeklyDigest=false suppresses push (got ${captured.length})`,
  );

  // The digest row is the contract for the dashboard "Your week" card.
  // It must be written regardless of the candidate's pref.
  const [digestRow] = await db
    .select()
    .from(candidateWeeklyDigestsTable)
    .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId));
  assert(!!digestRow, "candidate_weekly_digests row written for opted-out user");
  assert(
    digestRow?.emailSendResult === "pending:user-opted-out",
    `email send result reflects opt-out (got ${digestRow?.emailSendResult})`,
  );

  // The opted-out branch still writes an in-app row, but uses the
  // simpler title (no colon, no per-pick count) and skips the push.
  const inApp = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  const digestNotif = inApp.find((r) => r.kind === "weekly_digest");
  assert(
    digestNotif?.title === "Your week on Jumerra",
    `in-app row uses the opted-out title (got "${digestNotif?.title ?? ""}")`,
  );
}

// ---------- runner ------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Weekly-digest worker harness — DATABASE_URL=${process.env.DATABASE_URL ? "set" : "MISSING"}`,
  );
  installFetchStub();
  try {
    await testTopMatchesExcludeAppliedDismissedAndPriorDigest();
    await testTopMatchesCapsAtFive();
    await testDispatchWhenOptedIn();
    await testNoDispatchWhenOptedOut();
  } finally {
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        await cleanups[i]();
      } catch (err) {
        console.error("cleanup error:", err);
      }
    }
    restoreFetch();
    await pool.end();
  }
  console.log(`\nResult: ${passed} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("harness crashed:", err);
  for (let i = cleanups.length - 1; i >= 0; i--) {
    try {
      await cleanups[i]();
    } catch {
      /* ignore */
    }
  }
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

