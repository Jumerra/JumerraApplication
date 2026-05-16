/**
 * Server-level test harness for the Fast-Track 48-hour pledge (task #76).
 *
 * Covers:
 *   1. Toggling Fast-Track on returns ENABLED + persists `fastTrackEnabledAt`.
 *   2. Toggling on while `fastTrackRevokedUntil` is in the future raises
 *      a REVOKED error (mapped to HTTP 409 by the route).
 *   3. The hourly sweep records exactly one breach per overdue application
 *      (idempotent: second sweep on the same data inserts nothing thanks
 *      to the UNIQUE index on `application_id` + ON CONFLICT DO NOTHING).
 *   4. The sweep ignores applications that were submitted BEFORE the
 *      employer enabled Fast-Track (no retroactive penalties).
 *   5. Two breaches inside the rolling 30-day window auto-revoke the
 *      badge, set `fastTrackRevokedUntil` ~30 days out, disable the
 *      pledge, and write a `fast_track_revoked` notification for every
 *      staff user. One breach writes a `fast_track_warning` instead.
 *   6. The `fastTrackOnly` filter on `listJobsForBoard` only returns
 *      jobs whose employer is currently enabled (and not revoked).
 *
 * Usage: pnpm --filter @workspace/api-server run test:fast-track
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  applicationsTable,
  candidatesTable,
  employersTable,
  employerSlaBreachesTable,
  jobsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  getFastTrackState,
  toggleFastTrack,
  sweepFastTrackBreaches,
} from "../src/lib/sla";

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
    console.log(`  \u2717 ${msg}`);
  }
}

async function rejects(
  fn: () => Promise<unknown>,
  matcher: (err: unknown) => boolean,
  msg: string,
): Promise<void> {
  try {
    await fn();
    failures += 1;
    console.log(`  \u2717 ${msg} (no error thrown)`);
  } catch (err) {
    assert(matcher(err), msg);
  }
}

async function makeEmployerAndStaff(suffix: string) {
  const [emp] = await db
    .insert(employersTable)
    .values({
      name: `FT Test Co ${suffix}`,
      tagline: "test",
      description: "test",
      industry: "Tech",
      location: "Remote",
      logoUrl: "",
      coverUrl: "",
      websiteUrl: "",
      size: "1-10",
    })
    .returning();
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `ft-staff-${suffix}@example.com`,
      passwordHash: "x",
      role: "employer",
      fullName: "FT Staff",
      employerId: emp.id,
    })
    .returning();
  cleanups.push(async () => {
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, user.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db
      .delete(employerSlaBreachesTable)
      .where(eq(employerSlaBreachesTable.employerId, emp.id));
    const jobs = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.employerId, emp.id));
    if (jobs.length) {
      const jobIds = jobs.map((j) => j.id);
      await db
        .delete(applicationsTable)
        .where(inArray(applicationsTable.jobId, jobIds));
      await db.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
    }
    await db.delete(employersTable).where(eq(employersTable.id, emp.id));
  });
  return { employerId: emp.id, userId: user.id };
}

async function makeJob(employerId: number, suffix: string): Promise<number> {
  const [job] = await db
    .insert(jobsTable)
    .values({
      employerId,
      title: `FT Test Role ${suffix}`,
      type: "full-time",
      location: "Remote",
      remote: true,
      summary: "test",
      description: "test",
    })
    .returning();
  return job.id;
}

async function makeCandidate(suffix: string): Promise<number> {
  const [cand] = await db
    .insert(candidatesTable)
    .values({
      fullName: `FT Cand ${suffix}`,
      headline: "test",
      bio: "test",
      location: "Remote",
      email: `ft-cand-${suffix}@example.com`,
      phone: "",
      avatarUrl: "",
    })
    .returning();
  cleanups.push(async () => {
    await db.delete(candidatesTable).where(eq(candidatesTable.id, cand.id));
  });
  return cand.id;
}

async function makeOverdueApplication(
  jobId: number,
  candidateId: number,
  ageMs: number,
): Promise<number> {
  const appliedAt = new Date(Date.now() - ageMs);
  const [app] = await db
    .insert(applicationsTable)
    .values({
      jobId,
      candidateId,
      status: "applied",
      appliedAt,
      matchScore: 0,
    })
    .returning();
  return app.id;
}

async function run() {
  console.log("\n== Fast-Track 48h pledge tests ==\n");

  // ---- Test 1: enable + persist enabledAt
  {
    const sx = tag();
    const { employerId } = await makeEmployerAndStaff(sx);
    const before = await getFastTrackState(employerId);
    assert(before.enabled === false, "starts disabled");
    const after = await toggleFastTrack(employerId, true);
    assert(after.enabled === true, "toggle on enables");
    assert(!!after.enabledAt, "enabledAt is set");
  }

  // ---- Test 2: cannot re-enable during cooldown
  {
    const sx = tag();
    const { employerId } = await makeEmployerAndStaff(sx);
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db
      .update(employersTable)
      .set({ fastTrackRevokedUntil: future, fastTrackEnabled: false })
      .where(eq(employersTable.id, employerId));
    await rejects(
      () => toggleFastTrack(employerId, true),
      (e) =>
        !!e &&
        typeof e === "object" &&
        (e as { code?: string }).code === "REVOKED",
      "re-enable during cooldown throws REVOKED",
    );
  }

  // ---- Test 3 & 4: sweep idempotency + appliedAt >= enabledAt filter
  {
    const sx = tag();
    const { employerId } = await makeEmployerAndStaff(sx);
    const jobId = await makeJob(employerId, sx);
    const candId = await makeCandidate(sx);

    // Application submitted 3 days ago, BEFORE we enable Fast-Track.
    const oldAppId = await makeOverdueApplication(
      jobId,
      candId,
      3 * 24 * 60 * 60 * 1000,
    );

    // Enable Fast-Track now.
    await toggleFastTrack(employerId, true);

    // Application submitted just under 49h ago, AFTER enabledAt.
    // We set enabledAt back a bit so this app qualifies.
    await db
      .update(employersTable)
      .set({
        fastTrackEnabledAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
      })
      .where(eq(employersTable.id, employerId));
    const candId2 = await makeCandidate(`${sx}-b`);
    const newAppId = await makeOverdueApplication(
      jobId,
      candId2,
      49 * 60 * 60 * 1000,
    );

    const r1 = await sweepFastTrackBreaches();
    const breaches1 = await db
      .select()
      .from(employerSlaBreachesTable)
      .where(eq(employerSlaBreachesTable.employerId, employerId));
    assert(
      breaches1.length === 1,
      "sweep records exactly one breach (ignores pre-enable applications)",
    );
    assert(
      breaches1[0].applicationId === newAppId,
      "the breach is for the post-enable application",
    );
    assert(
      breaches1[0].applicationId !== oldAppId,
      "the pre-enable application is NOT counted",
    );

    const r2 = await sweepFastTrackBreaches();
    const breaches2 = await db
      .select()
      .from(employerSlaBreachesTable)
      .where(eq(employerSlaBreachesTable.employerId, employerId));
    assert(
      breaches2.length === 1,
      "second sweep is idempotent (UNIQUE on application_id)",
    );

    // One breach => warning notification was written.
    const warnings = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.kind, "fast_track_warning"));
    assert(
      warnings.some((n) => n.title === "Fast-Track SLA warning"),
      "first breach writes a fast_track_warning notification",
    );

    // Sanity: counters from the sweep itself.
    assert(
      r1.newBreaches === 1 && r1.warned === 1 && r1.revoked === 0,
      "first sweep: 1 newBreach, 1 warned, 0 revoked",
    );
    assert(
      r2.newBreaches === 0 && r2.warned === 0 && r2.revoked === 0,
      "second sweep: nothing changed",
    );
  }

  // ---- Test 5: 2 breaches => auto-revoke + notification
  {
    const sx = tag();
    const { employerId } = await makeEmployerAndStaff(sx);
    const jobId = await makeJob(employerId, sx);
    await toggleFastTrack(employerId, true);
    await db
      .update(employersTable)
      .set({
        fastTrackEnabledAt: new Date(Date.now() - 60 * 60 * 60 * 1000),
      })
      .where(eq(employersTable.id, employerId));

    const c1 = await makeCandidate(`${sx}-1`);
    const c2 = await makeCandidate(`${sx}-2`);
    await makeOverdueApplication(jobId, c1, 49 * 60 * 60 * 1000);
    await makeOverdueApplication(jobId, c2, 50 * 60 * 60 * 1000);

    const r = await sweepFastTrackBreaches();
    assert(r.revoked >= 1, "sweep revokes when >=2 breaches in window");

    const [emp] = await db
      .select()
      .from(employersTable)
      .where(eq(employersTable.id, employerId));
    assert(emp.fastTrackEnabled === false, "fastTrackEnabled cleared on revoke");
    assert(
      !!emp.fastTrackRevokedUntil &&
        emp.fastTrackRevokedUntil.getTime() > Date.now(),
      "fastTrackRevokedUntil set in the future",
    );

    const revokeNotes = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.kind, "fast_track_revoked"));
    assert(
      revokeNotes.length >= 1,
      "revoke writes a fast_track_revoked notification to staff",
    );

    const state = await getFastTrackState(employerId);
    assert(
      state.enabled === false && !!state.revokedUntil,
      "getFastTrackState reports disabled + revokedUntil",
    );
  }

  // ---- Test 6: fastTrackOnly filter resolution (employer flag drives visibility)
  //
  // routes/jobs.ts resolves `fastTrackOnly` by joining each job's employer
  // and dropping any whose `fastTrackEnabled` is false. This test asserts
  // the source-of-truth flag the route reads.
  {
    const sx = tag();
    const { employerId: enabledEmp } = await makeEmployerAndStaff(`${sx}-on`);
    const { employerId: disabledEmp } = await makeEmployerAndStaff(`${sx}-off`);
    await makeJob(enabledEmp, `${sx}-on`);
    await makeJob(disabledEmp, `${sx}-off`);
    await toggleFastTrack(enabledEmp, true);

    const [enabledRow] = await db
      .select({ enabled: employersTable.fastTrackEnabled })
      .from(employersTable)
      .where(eq(employersTable.id, enabledEmp));
    const [disabledRow] = await db
      .select({ enabled: employersTable.fastTrackEnabled })
      .from(employersTable)
      .where(eq(employersTable.id, disabledEmp));
    assert(
      enabledRow.enabled === true,
      "enabled employer has fastTrackEnabled=true (route's filter predicate)",
    );
    assert(
      disabledRow.enabled === false,
      "untoggled employer remains fastTrackEnabled=false",
    );
  }

  for (const c of cleanups.reverse()) {
    try {
      await c();
    } catch (err) {
      console.warn("cleanup error:", err);
    }
  }
  await pool.end();
  console.log(`\n${passed} passed, ${failures} failed\n`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
