/**
 * Server-level test harness for the per-job tier system.
 *
 * Covers (per task #20):
 *   1. sweepExpiredJobTiers() demotes paid jobs whose tierExpiresAt has passed.
 *   2. pushSponsoredJobToCandidates() respects the per-job push cap.
 *   3. pushSponsoredJobToCandidates() respects the per-candidate daily cap (3/24h).
 *   4. pushSponsoredJobToCandidates() is idempotent / race-safe under concurrent calls
 *      for the same job (uniq(job_id, candidate_id) prevents duplicate pushes).
 *
 * Runs against the dev DATABASE_URL but only touches uniquely-named rows it
 * creates, and cleans them up in a `finally` block so it can be re-run.
 *
 * Usage: pnpm --filter @workspace/scripts run test:job-tier
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  jobsTable,
  employersTable,
  candidatesTable,
  usersTable,
  notificationsTable,
  sponsoredJobPushesTable,
  jobTierPaymentsTable,
} from "@workspace/db";
import {
  sweepExpiredJobTiers,
  pushSponsoredJobToCandidates,
} from "../src/routes/job-tier";

type Cleanup = () => Promise<void>;
const cleanups: Cleanup[] = [];
let failures = 0;
let passed = 0;

function tag(): string {
  return randomBytes(4).toString("hex");
}

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    passed++;
    console.log(`  ✓ ${msg}`);
  }
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
  opts: {
    tier?: "free" | "promoted" | "sponsored";
    tierExpiresAt?: Date | null;
    skills?: string[];
    location?: string;
    remote?: boolean;
  } = {},
): Promise<typeof jobsTable.$inferSelect> {
  const t = tag();
  const [row] = await db
    .insert(jobsTable)
    .values({
      employerId,
      title: `Test Job ${t}`,
      type: "full_time",
      location: opts.location ?? "Testville",
      remote: opts.remote ?? false,
      summary: "s",
      description: "d",
      skills: opts.skills ?? ["test-skill"],
      tier: opts.tier ?? "free",
      tierExpiresAt: opts.tierExpiresAt ?? null,
    })
    .returning();
  cleanups.push(async () => {
    await db
      .delete(sponsoredJobPushesTable)
      .where(eq(sponsoredJobPushesTable.jobId, row.id));
    await db.delete(jobsTable).where(eq(jobsTable.id, row.id));
  });
  return row;
}

async function createCandidateWithUser(opts: {
  skills?: string[];
  location?: string;
}): Promise<{ candidateId: number; userId: number }> {
  const t = tag();
  const email = `cand-${t}@test.local`;
  const [cand] = await db
    .insert(candidatesTable)
    .values({
      fullName: `Cand ${t}`,
      headline: "h",
      bio: "b",
      location: opts.location ?? "Testville",
      email,
      phone: "",
      avatarUrl: "",
      skills: opts.skills ?? ["test-skill"],
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
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db.delete(candidatesTable).where(eq(candidatesTable.id, cand.id));
  });
  return { candidateId: cand.id, userId: user.id };
}

async function testSweepDemotesExpired(): Promise<void> {
  console.log("\n[1] sweepExpiredJobTiers demotes expired paid jobs");
  const employerId = await createEmployer();

  // Expired promoted -> should be demoted to free.
  const expired = await createJob(employerId, {
    tier: "promoted",
    tierExpiresAt: new Date(Date.now() - 60_000),
  });
  // Future-dated sponsored -> should remain.
  const future = await createJob(employerId, {
    tier: "sponsored",
    tierExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  // Free with no expiry -> should remain free.
  const free = await createJob(employerId, { tier: "free" });

  await sweepExpiredJobTiers();

  const after = await db
    .select()
    .from(jobsTable)
    .where(inArray(jobsTable.id, [expired.id, future.id, free.id]));
  const byId = new Map(after.map((j) => [j.id, j]));
  assert(byId.get(expired.id)?.tier === "free", "expired promoted demoted to free");
  assert(
    byId.get(expired.id)?.tierExpiresAt === null,
    "expired job tierExpiresAt cleared",
  );
  assert(
    byId.get(future.id)?.tier === "sponsored",
    "future-dated sponsored is preserved",
  );
  assert(byId.get(free.id)?.tier === "free", "free job stays free");

  // Idempotent: a second sweep is a no-op.
  await sweepExpiredJobTiers();
  const [futureAgain] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, future.id));
  assert(
    futureAgain?.tier === "sponsored",
    "double sweep does not demote still-valid tier",
  );
}

async function testPerJobPushCap(): Promise<void> {
  console.log("\n[2] pushSponsoredJobToCandidates respects per-job push cap");
  const employerId = await createEmployer();
  const skill = `skill-${tag()}`;
  const loc = `Loc${tag()}`;

  // 5 matching candidates.
  const created: { candidateId: number; userId: number }[] = [];
  for (let i = 0; i < 5; i++) {
    created.push(
      await createCandidateWithUser({ skills: [skill], location: loc }),
    );
  }
  const job = await createJob(employerId, {
    tier: "sponsored",
    tierExpiresAt: new Date(Date.now() + 86_400_000),
    skills: [skill],
    location: loc,
  });

  const pushed = await pushSponsoredJobToCandidates(job, 3);
  assert(pushed === 3, `first call honours cap of 3 (got ${pushed})`);

  const pushes = await db
    .select()
    .from(sponsoredJobPushesTable)
    .where(eq(sponsoredJobPushesTable.jobId, job.id));
  assert(pushes.length === 3, `exactly 3 push rows persisted (got ${pushes.length})`);

  const userIds = created.map((c) => c.userId);
  const notifs = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        inArray(notificationsTable.userId, userIds),
        eq(notificationsTable.kind, "sponsored_job"),
      ),
    );
  assert(
    notifs.length === 3,
    `exactly 3 notifications fanned out (got ${notifs.length})`,
  );

  // A second call with the same cap should not exceed it.
  const pushed2 = await pushSponsoredJobToCandidates(job, 3);
  assert(pushed2 === 0, `second call at cap pushes nothing (got ${pushed2})`);
  const pushesAfter = await db
    .select()
    .from(sponsoredJobPushesTable)
    .where(eq(sponsoredJobPushesTable.jobId, job.id));
  assert(
    pushesAfter.length === 3,
    `still exactly 3 push rows after re-call (got ${pushesAfter.length})`,
  );

  // Raising cap to 4 should push one more (to a new candidate).
  const pushed3 = await pushSponsoredJobToCandidates(job, 4);
  assert(pushed3 === 1, `raised cap pushes 1 more (got ${pushed3})`);
}

async function testPerCandidateDailyCap(): Promise<void> {
  console.log("\n[3] per-candidate daily cap (3 pushes / 24h)");
  const employerId = await createEmployer();
  const skill = `skill-${tag()}`;
  const loc = `Loc${tag()}`;
  const cand = await createCandidateWithUser({ skills: [skill], location: loc });

  // Pre-load 3 fresh pushes against this candidate from other jobs to
  // saturate the daily cap. We need real job rows so the FK-less ints
  // are valid bookkeeping (sponsored_job_pushes has no FK on candidate).
  const otherJobs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const j = await createJob(employerId, {
      tier: "sponsored",
      tierExpiresAt: new Date(Date.now() + 86_400_000),
      skills: [skill],
      location: loc,
    });
    otherJobs.push(j.id);
    await db.insert(sponsoredJobPushesTable).values({
      jobId: j.id,
      candidateId: cand.candidateId,
    });
  }

  // New job should not push to this candidate (already at daily cap).
  const newJob = await createJob(employerId, {
    tier: "sponsored",
    tierExpiresAt: new Date(Date.now() + 86_400_000),
    skills: [skill],
    location: loc,
  });
  const pushed = await pushSponsoredJobToCandidates(newJob, 10);
  assert(
    pushed === 0,
    `candidate at daily cap is skipped (pushed=${pushed})`,
  );
  const rows = await db
    .select()
    .from(sponsoredJobPushesTable)
    .where(
      and(
        eq(sponsoredJobPushesTable.jobId, newJob.id),
        eq(sponsoredJobPushesTable.candidateId, cand.candidateId),
      ),
    );
  assert(rows.length === 0, "no push row created when candidate over daily cap");

  // Backdate one push >24h ago — daily window slides, so the candidate
  // is eligible again and the new job should push exactly once.
  await db
    .update(sponsoredJobPushesTable)
    .set({ pushedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
    .where(
      and(
        eq(sponsoredJobPushesTable.jobId, otherJobs[0]),
        eq(sponsoredJobPushesTable.candidateId, cand.candidateId),
      ),
    );
  const pushed2 = await pushSponsoredJobToCandidates(newJob, 10);
  assert(
    pushed2 === 1,
    `aged-out push frees capacity (pushed=${pushed2})`,
  );
}

async function testConcurrentVerifyIdempotent(): Promise<void> {
  console.log("\n[4] concurrent fan-out is idempotent (uniq(job, candidate))");
  const employerId = await createEmployer();
  const skill = `skill-${tag()}`;
  const loc = `Loc${tag()}`;
  // 4 matching candidates, cap = 4 -> both concurrent calls target the
  // same candidate set; the unique index must prevent dupes.
  for (let i = 0; i < 4; i++) {
    await createCandidateWithUser({ skills: [skill], location: loc });
  }
  const job = await createJob(employerId, {
    tier: "sponsored",
    tierExpiresAt: new Date(Date.now() + 86_400_000),
    skills: [skill],
    location: loc,
  });

  const [a, b] = await Promise.all([
    pushSponsoredJobToCandidates(job, 4),
    pushSponsoredJobToCandidates(job, 4),
  ]);
  const total = a + b;
  assert(
    total >= 1 && total <= 4,
    `combined pushes within cap (a=${a}, b=${b}, total=${total})`,
  );

  // Distinct candidate count must equal total push rows AND not exceed cap.
  const rows = await db
    .select()
    .from(sponsoredJobPushesTable)
    .where(eq(sponsoredJobPushesTable.jobId, job.id));
  const distinct = new Set(rows.map((r) => r.candidateId)).size;
  assert(
    rows.length === distinct,
    `no duplicate (job,candidate) rows (rows=${rows.length}, distinct=${distinct})`,
  );
  assert(
    rows.length <= 4,
    `total push rows respects cap (rows=${rows.length})`,
  );

  // Notifications mirror push rows: exactly one per winning candidate.
  const notifCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.kind, "sponsored_job"),
        eq(notificationsTable.link, `/jobs/${job.id}`),
      ),
    );
  assert(
    Number(notifCount[0]?.n ?? 0) === rows.length,
    `notifications match push rows (notifs=${notifCount[0]?.n}, pushes=${rows.length})`,
  );
}

/**
 * Models the "atomic flip pending->paid + fan-out" core of
 * POST /api/job-tier/checkout/verify (artifacts/api-server/src/routes/
 * job-tier.ts ~line 564). Mirrors the production logic so we can drive
 * concurrent verifies for the SAME payment row without touching Stripe.
 *
 * Returns { won } so the test can assert exactly one caller wins the
 * activation race and exactly one caller fans out pushes.
 */
async function simulateVerifyActivation(paymentId: number): Promise<{
  won: boolean;
  pushed: number;
}> {
  const flipped = await db
    .update(jobTierPaymentsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(
      and(
        eq(jobTierPaymentsTable.id, paymentId),
        eq(jobTierPaymentsTable.status, "pending"),
      ),
    )
    .returning({
      jobId: jobTierPaymentsTable.jobId,
      tier: jobTierPaymentsTable.tier,
      durationDays: jobTierPaymentsTable.durationDays,
    });
  if (flipped.length === 0) return { won: false, pushed: 0 };
  const row = flipped[0];

  const expires = new Date(
    Date.now() + row.durationDays * 24 * 60 * 60 * 1000,
  );
  await db
    .update(jobsTable)
    .set({ tier: row.tier, tierExpiresAt: expires })
    .where(eq(jobsTable.id, row.jobId));
  await db
    .update(jobTierPaymentsTable)
    .set({ tierExpiresAt: expires })
    .where(eq(jobTierPaymentsTable.id, paymentId));

  if (row.tier !== "sponsored") return { won: true, pushed: 0 };
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, row.jobId))
    .limit(1);
  if (!job) return { won: true, pushed: 0 };
  const pushed = await pushSponsoredJobToCandidates(job, 200);
  return { won: true, pushed };
}

async function testConcurrentVerifyRoute(): Promise<void> {
  console.log(
    "\n[5] concurrent /job-tier/checkout/verify activations are idempotent",
  );
  const employerId = await createEmployer();
  const skill = `skill-${tag()}`;
  const loc = `Loc${tag()}`;
  for (let i = 0; i < 4; i++) {
    await createCandidateWithUser({ skills: [skill], location: loc });
  }
  const job = await createJob(employerId, {
    tier: "free",
    skills: [skill],
    location: loc,
  });

  const sessionId = `cs_test_${tag()}`;
  const [payment] = await db
    .insert(jobTierPaymentsTable)
    .values({
      jobId: job.id,
      employerId,
      tier: "sponsored",
      stripeSessionId: sessionId,
      amountCents: 9900,
      currency: "usd",
      durationDays: 30,
      status: "pending",
    })
    .returning({ id: jobTierPaymentsTable.id });
  cleanups.push(async () => {
    await db
      .delete(jobTierPaymentsTable)
      .where(eq(jobTierPaymentsTable.id, payment.id));
  });

  // Fire 4 concurrent activations against the SAME payment row, the way
  // the production verify endpoint would race when a user double-clicks
  // "I paid" or two browser tabs land on the success URL at once.
  const results = await Promise.all([
    simulateVerifyActivation(payment.id),
    simulateVerifyActivation(payment.id),
    simulateVerifyActivation(payment.id),
    simulateVerifyActivation(payment.id),
  ]);
  const winners = results.filter((r) => r.won);
  assert(winners.length === 1, `exactly 1 caller wins the flip (got ${winners.length})`);

  // Job is now paid + sponsored exactly once.
  const [updated] = await db
    .select({
      tier: jobsTable.tier,
      tierExpiresAt: jobsTable.tierExpiresAt,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, job.id));
  assert(updated?.tier === "sponsored", "job tier is sponsored after race");
  assert(
    updated?.tierExpiresAt && updated.tierExpiresAt.getTime() > Date.now(),
    "job tierExpiresAt is in the future after race",
  );

  // Payment row was flipped to paid exactly once.
  const [paid] = await db
    .select({ status: jobTierPaymentsTable.status })
    .from(jobTierPaymentsTable)
    .where(eq(jobTierPaymentsTable.id, payment.id));
  assert(paid?.status === "paid", "payment row is paid after race");

  // Fan-out happened on the winner only — no duplicate (job, candidate)
  // rows; total pushes from the winner equal the persisted row count.
  const pushes = await db
    .select()
    .from(sponsoredJobPushesTable)
    .where(eq(sponsoredJobPushesTable.jobId, job.id));
  const distinct = new Set(pushes.map((p) => p.candidateId)).size;
  assert(
    pushes.length === distinct,
    `no duplicate push rows after concurrent verifies (rows=${pushes.length}, distinct=${distinct})`,
  );
  assert(
    winners[0]?.pushed === pushes.length,
    `winner's reported push count matches persisted rows (winner=${winners[0]?.pushed}, persisted=${pushes.length})`,
  );

  // A 5th late verify after the race finds status='paid' and is a no-op
  // for the flip; pushSponsoredJobToCandidates is also re-called by the
  // production code path on each "winning" verify but ON CONFLICT DO
  // NOTHING keeps the push table stable. Re-call it to confirm.
  const repushed = await pushSponsoredJobToCandidates(job, 200);
  assert(repushed === 0, `re-running fan-out adds nothing (got ${repushed})`);
  const pushesAfter = await db
    .select()
    .from(sponsoredJobPushesTable)
    .where(eq(sponsoredJobPushesTable.jobId, job.id));
  assert(
    pushesAfter.length === pushes.length,
    `push table unchanged after re-run (before=${pushes.length}, after=${pushesAfter.length})`,
  );
}

async function main(): Promise<void> {
  console.log(
    `Job tier flow harness — DATABASE_URL=${process.env.DATABASE_URL ? "set" : "MISSING"}`,
  );
  try {
    await testSweepDemotesExpired();
    await testPerJobPushCap();
    await testPerCandidateDailyCap();
    await testConcurrentVerifyIdempotent();
    await testConcurrentVerifyRoute();
  } finally {
    // LIFO cleanup so child rows go before parents.
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        await cleanups[i]();
      } catch (err) {
        console.error("cleanup error:", err);
      }
    }
    await pool.end();
  }

  console.log(`\nResult: ${passed} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Harness crashed:", err);
  process.exit(1);
});
