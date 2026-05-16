/**
 * Server-level tests for the weekly-digest *slot* logic (task #60).
 *
 * Two layers:
 *
 *   1. Pure unit tests for `isCandidateLocalDigestSlot` — no DB, no
 *      Drizzle. Verifies the local-time gate across UTC,
 *      America/New_York, Asia/Tokyo, Pacific/Honolulu, and at the
 *      March/November DST transitions in New York. Guards against a
 *      future timezone-library swap silently regressing back to
 *      "everyone gets it Monday UTC".
 *
 *   2. Worker-level tests for `runWeeklyDigestSweep(now)` — verifies
 *      the sweep skips candidates whose effective slot doesn't match
 *      `now` and fires exactly once when it does. Covers:
 *        a) candidate with a prefs row whose (digestDow, digestHour,
 *           digestTz) matches `now`
 *        b) candidate with a prefs row whose slot does *not* match
 *        c) candidate without a prefs row (default Mon 09:00 in the
 *           candidate's `timezone`)
 *        d) candidate with a junk IANA id in `digestTz` (falls back
 *           cleanly through `timezone` → UTC without crashing the
 *           sweep)
 *
 * Usage: pnpm --filter @workspace/api-server run test:digest-slot
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  candidatesTable,
  candidateWeeklyDigestsTable,
  employersTable,
  jobsTable,
  notificationPrefsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  isCandidateLocalDigestSlot,
  runWeeklyDigestSweep,
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

// ---------- fetch stub (swallow Expo push calls) -------------------------

const realFetch = globalThis.fetch;
function installFetchStub(): void {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("exp.host")) {
      const body = init?.body ? JSON.parse(String(init.body)) : [];
      const msgs = Array.isArray(body) ? body : [body];
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

// =========================================================================
// 1. Unit tests for isCandidateLocalDigestSlot
// =========================================================================

/**
 * Helper: build a UTC `Date` for the chosen wall-clock moment.
 * Tests use these as the simulated "now" passed into the slot gate.
 */
function utc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm = 0,
): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
}

function unitTests(): void {
  // Guard rail: the WEEKLY_DIGEST_FORCE escape hatch must not be set,
  // otherwise the gate short-circuits to true and these tests are
  // meaningless.
  const prevForce = process.env.WEEKLY_DIGEST_FORCE;
  delete process.env.WEEKLY_DIGEST_FORCE;
  try {
    console.log("\n[U1] isCandidateLocalDigestSlot — UTC zone");
    // Mon 2024-01-01 09:00 UTC → Mon 09:00 local
    const monNineUtc = utc(2024, 1, 1, 9);
    assert(
      isCandidateLocalDigestSlot("UTC", 1, 9, monNineUtc) === true,
      "UTC: matches at Mon 09:00",
    );
    assert(
      isCandidateLocalDigestSlot("UTC", 1, 8, monNineUtc) === false,
      "UTC: rejects when hour differs by one",
    );
    assert(
      isCandidateLocalDigestSlot("UTC", 2, 9, monNineUtc) === false,
      "UTC: rejects when dow differs",
    );
    // null / empty / undefined all behave as UTC
    assert(
      isCandidateLocalDigestSlot(null, 1, 9, monNineUtc) === true,
      "null tz: defaults to UTC",
    );
    assert(
      isCandidateLocalDigestSlot("", 1, 9, monNineUtc) === true,
      "empty tz: defaults to UTC",
    );
    assert(
      isCandidateLocalDigestSlot(undefined, 1, 9, monNineUtc) === true,
      "undefined tz: defaults to UTC",
    );
    // Bad IANA id falls back to UTC instead of throwing
    assert(
      isCandidateLocalDigestSlot("Mars/Olympus", 1, 9, monNineUtc) === true,
      "junk tz: falls back to UTC (no throw)",
    );

    console.log("\n[U2] isCandidateLocalDigestSlot — America/New_York");
    // 2024-03-11 is a Monday. NY is on EDT (UTC-4) at that point.
    // 09:00 EDT == 13:00 UTC.
    const mon0900NyEdt = utc(2024, 3, 11, 13);
    assert(
      isCandidateLocalDigestSlot("America/New_York", 1, 9, mon0900NyEdt) === true,
      "NY (EDT): matches at Mon 09:00 local",
    );
    // At 13:00 UTC the same instant is 09:00 in NY but Mon 13:00 in
    // UTC — checking against UTC would yield (1, 13), not (1, 9), so a
    // tz-naive implementation would fail here.
    assert(
      isCandidateLocalDigestSlot("UTC", 1, 9, mon0900NyEdt) === false,
      "NY (EDT): same instant does NOT match Mon 09 UTC (regression guard)",
    );
    // 2024-01-15 is a Monday. NY is on EST (UTC-5).
    // 09:00 EST == 14:00 UTC.
    const mon0900NyEst = utc(2024, 1, 15, 14);
    assert(
      isCandidateLocalDigestSlot("America/New_York", 1, 9, mon0900NyEst) === true,
      "NY (EST): matches at Mon 09:00 local in winter",
    );

    console.log("\n[U3] isCandidateLocalDigestSlot — Asia/Tokyo (UTC+9)");
    // Tokyo has no DST. 09:00 JST = 00:00 UTC. 2024-01-01 was a Monday
    // in Tokyo at 09:00 JST → that's 2024-01-01 00:00 UTC, still Mon.
    const monTokyo = utc(2024, 1, 1, 0);
    assert(
      isCandidateLocalDigestSlot("Asia/Tokyo", 1, 9, monTokyo) === true,
      "Tokyo: matches at Mon 09:00 local",
    );
    // The same UTC instant is Mon 00:00 UTC — must NOT match Mon 09 UTC.
    assert(
      isCandidateLocalDigestSlot("UTC", 1, 9, monTokyo) === false,
      "Tokyo: instant differs from UTC 09 (regression guard)",
    );
    // Day rollover: Sun 2023-12-31 22:00 UTC = Mon 2024-01-01 07:00 JST.
    const sunEveningUtcMonMorningTokyo = utc(2023, 12, 31, 22);
    assert(
      isCandidateLocalDigestSlot(
        "Asia/Tokyo",
        1,
        7,
        sunEveningUtcMonMorningTokyo,
      ) === true,
      "Tokyo: Sun-UTC evening reads as Mon-local morning",
    );

    console.log("\n[U4] isCandidateLocalDigestSlot — Pacific/Honolulu (UTC-10)");
    // Honolulu has no DST. 09:00 HST = 19:00 UTC same day.
    // Pick Mon 2024-01-01 19:00 UTC → Mon 09:00 HST.
    const monHonolulu = utc(2024, 1, 1, 19);
    assert(
      isCandidateLocalDigestSlot("Pacific/Honolulu", 1, 9, monHonolulu) === true,
      "Honolulu: matches at Mon 09:00 local",
    );
    // Tue 2024-01-02 05:00 UTC = Mon 2024-01-01 19:00 HST → still Mon,
    // hour 19. Demonstrates that the UTC calendar day flipped to Tue
    // but the local day is still Mon. A UTC-naive implementation that
    // gated on `now.getUTCDay()` would skip this instant.
    const tueUtcMonHonolulu = utc(2024, 1, 2, 5);
    assert(
      isCandidateLocalDigestSlot(
        "Pacific/Honolulu",
        1,
        19,
        tueUtcMonHonolulu,
      ) === true,
      "Honolulu: late local-Monday instant reads as Mon, not Tue",
    );

    console.log("\n[U5] isCandidateLocalDigestSlot — DST transitions in NY");
    // Spring-forward: 2024-03-10 02:00 EST → 03:00 EDT. The 02:00–03:00
    // local hour does not exist. We test the hours on either side to
    // confirm we stay on the right calendar day and the offset flips.
    //
    // Sun 2024-03-10 06:30 UTC = Sun 01:30 EST (pre-jump).
    const beforeSpring = utc(2024, 3, 10, 6, 30);
    assert(
      isCandidateLocalDigestSlot("America/New_York", 0, 1, beforeSpring) === true,
      "NY DST spring: 06:30 UTC reads as Sun 01:xx EST (pre-jump)",
    );
    // Sun 2024-03-10 07:30 UTC = Sun 03:30 EDT (post-jump). The clock
    // jumped from 02:00 EST to 03:00 EDT, so the local hour is 03.
    const afterSpring = utc(2024, 3, 10, 7, 30);
    assert(
      isCandidateLocalDigestSlot("America/New_York", 0, 3, afterSpring) === true,
      "NY DST spring: 07:30 UTC reads as Sun 03:xx EDT (post-jump)",
    );
    // Fall-back: 2024-11-03 02:00 EDT → 01:00 EST. The 01:00 local hour
    // repeats. We check one definitive post-fallback instant.
    // Sun 2024-11-03 12:00 UTC = Sun 07:00 EST (after fallback to
    // UTC-5). Pre-fallback at 12:00 UTC would have been 08:00 EDT.
    const afterFall = utc(2024, 11, 3, 12);
    assert(
      isCandidateLocalDigestSlot("America/New_York", 0, 7, afterFall) === true,
      "NY DST fall: 12:00 UTC reads as Sun 07:00 EST (post-fallback)",
    );
    assert(
      isCandidateLocalDigestSlot("America/New_York", 0, 8, afterFall) === false,
      "NY DST fall: 12:00 UTC is NOT 08:00 (would be wrong offset)",
    );
  } finally {
    if (prevForce !== undefined) process.env.WEEKLY_DIGEST_FORCE = prevForce;
  }
}

// =========================================================================
// 2. Worker-level tests for runWeeklyDigestSweep
// =========================================================================

async function createCandidate(opts: {
  timezone: string | null;
  withUser: boolean;
}): Promise<{ candidateId: number; userId: number | null }> {
  const t = tag();
  const [cand] = await db
    .insert(candidatesTable)
    .values({
      fullName: `SlotCand ${t}`,
      headline: "h",
      bio: "b",
      location: "Testville",
      email: `slot-${t}@test.local`,
      phone: "",
      avatarUrl: "",
      skills: [],
      yearsExperience: 0,
      talentScore: 50,
      timezone: opts.timezone,
    })
    .returning({ id: candidatesTable.id });
  let userId: number | null = null;
  if (opts.withUser) {
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `slotuser-${t}@test.local`,
        role: "candidate",
        status: "active",
        fullName: `SlotCand ${t}`,
        candidateId: cand.id,
      })
      .returning({ id: usersTable.id });
    userId = user.id;
  }
  cleanups.push(async () => {
    if (userId !== null) {
      await db
        .delete(notificationsTable)
        .where(eq(notificationsTable.userId, userId));
      await db
        .delete(notificationPrefsTable)
        .where(eq(notificationPrefsTable.userId, userId));
    }
    await db
      .delete(candidateWeeklyDigestsTable)
      .where(eq(candidateWeeklyDigestsTable.candidateId, cand.id));
    if (userId !== null) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    await db.delete(candidatesTable).where(eq(candidatesTable.id, cand.id));
  });
  return { candidateId: cand.id, userId };
}

async function ensureBackgroundJob(): Promise<void> {
  // The sweep ranks all open jobs; nothing under test depends on the
  // results, but at least one employer+job in the DB keeps
  // runDigestForCandidate from short-circuiting on an empty job set.
  const [emp] = await db
    .insert(employersTable)
    .values({
      name: `SlotCo ${tag()}`,
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
  const [job] = await db
    .insert(jobsTable)
    .values({
      employerId: emp.id,
      title: `Slot Job ${tag()}`,
      type: "full_time",
      location: "Testville",
      remote: false,
      summary: "s",
      description: "d",
      skills: [],
    })
    .returning({ id: jobsTable.id });
  cleanups.push(async () => {
    await db.delete(jobsTable).where(eq(jobsTable.id, job.id));
    await db.delete(employersTable).where(eq(employersTable.id, emp.id));
  });
}

async function setPrefs(
  userId: number,
  opts: { dow: number; hour: number; tz: string | null },
): Promise<void> {
  await db
    .insert(notificationPrefsTable)
    .values({
      userId,
      strongMatch: true,
      applicationStatus: true,
      interviewReminder: true,
      profileViewed: true,
      weeklyDigest: true,
      digestDow: opts.dow,
      digestHour: opts.hour,
      digestTz: opts.tz,
    })
    .onConflictDoUpdate({
      target: notificationPrefsTable.userId,
      set: {
        digestDow: opts.dow,
        digestHour: opts.hour,
        digestTz: opts.tz,
      },
    });
}

async function digestRowsFor(candidateId: number): Promise<number> {
  const rows = await db
    .select({ id: candidateWeeklyDigestsTable.id })
    .from(candidateWeeklyDigestsTable)
    .where(eq(candidateWeeklyDigestsTable.candidateId, candidateId));
  return rows.length;
}

async function workerTests(): Promise<void> {
  // Pinned "now": Mon 2024-01-01 14:00 UTC.
  //   - In UTC                  → Mon 14:00 (dow=1, hour=14)
  //   - In America/New_York EST → Mon 09:00 (dow=1, hour=9)
  //   - In Asia/Tokyo           → Mon 23:00 (dow=1, hour=23)
  // Picking a single fixed instant lets us drive several distinct
  // "is this candidate's slot right now?" outcomes from one sweep.
  const now = utc(2024, 1, 1, 14);

  await ensureBackgroundJob();

  console.log(
    "\n[W1] sweep: candidate with prefs matching `now` generates exactly one digest",
  );
  const matchA = await createCandidate({ timezone: null, withUser: true });
  await setPrefs(matchA.userId!, { dow: 1, hour: 14, tz: "UTC" });

  console.log(
    "[W2] sweep: candidate with prefs NOT matching `now` is skipped",
  );
  const missB = await createCandidate({ timezone: null, withUser: true });
  // Same dow but hour offset by +3 → won't match this tick.
  await setPrefs(missB.userId!, { dow: 1, hour: 17, tz: "UTC" });

  console.log(
    "[W3] sweep: candidate with no prefs row falls back to (Mon 09:00, candidate.timezone)",
  );
  // candidate.timezone = America/New_York → 09:00 EST matches `now`.
  const matchC = await createCandidate({
    timezone: "America/New_York",
    withUser: true,
  });
  // intentionally NO setPrefs() — exercises the leftJoin-null fallback

  console.log(
    "[W4] sweep: candidate with junk IANA id falls back without crashing",
  );
  // digestTz is junk → fallback to candidate.timezone (also junk) →
  // fallback to UTC. Default Mon 09:00 in UTC does NOT match `now`
  // (14:00 UTC), so this candidate should be skipped — and crucially
  // the sweep should not throw.
  const junkD = await createCandidate({
    timezone: "Mars/Olympus",
    withUser: true,
  });
  await setPrefs(junkD.userId!, {
    dow: 1,
    hour: 9,
    tz: "Not/AReal_Zone",
  });

  // Safety: ensure the gate isn't being short-circuited.
  const prevForce = process.env.WEEKLY_DIGEST_FORCE;
  delete process.env.WEEKLY_DIGEST_FORCE;
  try {
    await runWeeklyDigestSweep(now);
  } finally {
    if (prevForce !== undefined) process.env.WEEKLY_DIGEST_FORCE = prevForce;
  }

  assert(
    (await digestRowsFor(matchA.candidateId)) === 1,
    "[W1] matching prefs → exactly one digest row written",
  );
  assert(
    (await digestRowsFor(missB.candidateId)) === 0,
    "[W2] non-matching prefs → no digest row written",
  );
  assert(
    (await digestRowsFor(matchC.candidateId)) === 1,
    "[W3] no prefs row + matching candidate.timezone → exactly one digest row written",
  );
  assert(
    (await digestRowsFor(junkD.candidateId)) === 0,
    "[W4] junk tz falls back to UTC and is skipped (no crash)",
  );

  // Idempotency: re-running the sweep at the same instant must not
  // produce a second row for the matching candidate.
  delete process.env.WEEKLY_DIGEST_FORCE;
  await runWeeklyDigestSweep(now);
  if (prevForce !== undefined) process.env.WEEKLY_DIGEST_FORCE = prevForce;

  assert(
    (await digestRowsFor(matchA.candidateId)) === 1,
    "[W1] re-running sweep at same `now` is idempotent (still one row)",
  );
}

// ---------- runner ------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Digest-slot test harness — DATABASE_URL=${process.env.DATABASE_URL ? "set" : "MISSING"}`,
  );
  installFetchStub();
  try {
    unitTests();
    await workerTests();
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
