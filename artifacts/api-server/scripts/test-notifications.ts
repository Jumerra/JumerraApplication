/**
 * Server-level test harness for the notification dispatcher + interview
 * reminder cron (task #50 / surface of task #30).
 *
 * Covers:
 *   1. Disabling the per-user `interviewReminder` preference does NOT
 *      suppress the initial `interview_invite` push, because that push
 *      is dispatched under the `applicationStatus` category — they are
 *      intentionally separate categories.
 *   2. runInterviewReminderSweep() fires exactly one push per (invite,
 *      window) and stamps `reminded24At` / `reminded1At` so a second
 *      sweep on the same data does nothing.
 *
 * The test stubs `globalThis.fetch` so it never hits the real Expo push
 * service; it only records the messages the dispatcher tried to send.
 *
 * Usage: pnpm --filter @workspace/api-server run test:notifications
 */
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  applicationsTable,
  candidatesTable,
  employersTable,
  expoPushTokensTable,
  interviewInvitesTable,
  interviewTimeSlotsTable,
  jobsTable,
  notificationPrefsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { sendNotification } from "../src/lib/notifier";
import { runInterviewReminderSweep } from "../src/lib/digest-worker";

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
  // Replace the global fetch so the dispatcher's push fan-out never
  // touches the real Expo service. We record every message it would
  // have sent and return a synthetic 200 OK ticket for each.
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

/**
 * The push side of `sendNotification` is fire-and-forget (a detached
 * microtask). Poll the capture array until it grows or we time out.
 */
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

async function createCandidateWithUser(): Promise<{
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
      skills: ["test-skill"],
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

async function createJob(employerId: number): Promise<number> {
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
      skills: ["test-skill"],
    })
    .returning({ id: jobsTable.id });
  cleanups.push(async () => {
    await db.delete(jobsTable).where(eq(jobsTable.id, row.id));
  });
  return row.id;
}

async function createApplication(
  jobId: number,
  candidateId: number,
): Promise<number> {
  const [row] = await db
    .insert(applicationsTable)
    .values({ jobId, candidateId, status: "interview" })
    .returning({ id: applicationsTable.id });
  cleanups.push(async () => {
    await db.delete(applicationsTable).where(eq(applicationsTable.id, row.id));
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

async function setInterviewReminderPref(
  userId: number,
  on: boolean,
): Promise<void> {
  await db
    .insert(notificationPrefsTable)
    .values({
      userId,
      strongMatch: true,
      applicationStatus: true,
      interviewReminder: on,
      profileViewed: true,
    })
    .onConflictDoUpdate({
      target: notificationPrefsTable.userId,
      set: { interviewReminder: on },
    });
}

// ---------- tests -------------------------------------------------------

async function testInviteNotGatedByReminderPref(): Promise<void> {
  console.log(
    "\n[1] interview_invite push is NOT suppressed by interviewReminder=false",
  );
  const { userId } = await createCandidateWithUser();
  await registerPushToken(userId);
  await setInterviewReminderPref(userId, false);

  // Dispatch the same shape the interviews route uses for the initial
  // invite: kind=interview_invite under category=applicationStatus.
  captured = [];
  await sendNotification({
    userId,
    kind: "interview_invite",
    title: "Interview invitation",
    body: "Pick a time slot.",
    link: "/interviews/123",
    category: "applicationStatus",
    data: { inviteId: 123 },
  });
  await waitForPushes(1);

  assert(
    captured.length === 1,
    `applicationStatus push fires despite interviewReminder=false (got ${captured.length})`,
  );
  assert(
    captured[0]?.title === "Interview invitation",
    "captured push carries the invite title",
  );
  const [inAppInvite] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId));
  assert(
    inAppInvite?.kind === "interview_invite",
    "in-app row is written regardless of prefs",
  );

  // Sanity check the other direction: a push that DOES gate on
  // interviewReminder (e.g. the cron-driven reminder) is suppressed.
  captured = [];
  await sendNotification({
    userId,
    kind: "interview_reminder",
    title: "Interview tomorrow",
    body: "Reminder.",
    category: "interviewReminder",
  });
  await waitForPushes(1, 250);
  assert(
    captured.length === 0,
    `interviewReminder category IS suppressed when pref=false (got ${captured.length})`,
  );
}

async function testReminderSweepIsIdempotent(): Promise<void> {
  console.log(
    "\n[2] runInterviewReminderSweep fires once per window and stamps the dedup column",
  );
  const { candidateId, userId } = await createCandidateWithUser();
  await registerPushToken(userId);
  // Make sure interviewReminder is on so the push isn't gated.
  await setInterviewReminderPref(userId, true);

  const employerId = await createEmployer();
  const jobId = await createJob(employerId);
  const applicationId = await createApplication(jobId, candidateId);

  // Insert an accepted invite with a slot that lands inside the T-1h
  // window (60 minutes from now, within the ±5min tolerance). The
  // T-24h path is covered separately in testReminderSweep24hWindow().
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
  const [invite] = await db
    .insert(interviewInvitesTable)
    .values({
      applicationId,
      employerId,
      status: "accepted",
      location: "",
      meetingLink: "",
      notes: "",
    })
    .returning({ id: interviewInvitesTable.id });
  cleanups.push(async () => {
    await db
      .delete(interviewInvitesTable)
      .where(eq(interviewInvitesTable.id, invite.id));
  });
  const [slot] = await db
    .insert(interviewTimeSlotsTable)
    .values({ inviteId: invite.id, startsAt, endsAt })
    .returning({ id: interviewTimeSlotsTable.id });
  await db
    .update(interviewInvitesTable)
    .set({ selectedSlotId: slot.id })
    .where(eq(interviewInvitesTable.id, invite.id));

  // First sweep: should fire the T-1h reminder exactly once and stamp
  // reminded1At.
  captured = [];
  await runInterviewReminderSweep();
  await waitForPushes(1);
  assert(captured.length === 1, `first sweep dispatches one push (got ${captured.length})`);
  assert(
    captured[0]?.title?.includes("1 hour"),
    `push title reflects T-1h window (got "${captured[0]?.title ?? ""}")`,
  );

  const [afterFirst] = await db
    .select()
    .from(interviewInvitesTable)
    .where(eq(interviewInvitesTable.id, invite.id));
  assert(
    afterFirst?.reminded1At instanceof Date,
    "reminded1At is stamped after first sweep",
  );
  assert(
    afterFirst?.reminded24At === null,
    "reminded24At remains null (invite is not in the T-24h window)",
  );
  const firstStamp = afterFirst?.reminded1At?.getTime() ?? 0;

  // Second sweep on the same data: must be a no-op (no new push, no
  // re-stamp of the dedup column).
  captured = [];
  await runInterviewReminderSweep();
  await waitForPushes(1, 250);
  assert(
    captured.length === 0,
    `second sweep dispatches no new push (got ${captured.length})`,
  );

  const [afterSecond] = await db
    .select()
    .from(interviewInvitesTable)
    .where(eq(interviewInvitesTable.id, invite.id));
  assert(
    afterSecond?.reminded1At?.getTime() === firstStamp,
    "reminded1At is unchanged by the second sweep",
  );

  // And the candidate only has the one in-app reminder row.
  const reminderRows = await db
    .select()
    .from(notificationsTable)
    .where(
      inArray(notificationsTable.userId, [userId]),
    );
  const reminders = reminderRows.filter((r) => r.kind === "interview_reminder");
  assert(
    reminders.length === 1,
    `exactly one in-app interview_reminder row exists (got ${reminders.length})`,
  );
}

async function testReminderSweep24hWindow(): Promise<void> {
  console.log(
    "\n[3] runInterviewReminderSweep also handles the T-24h window and stamps reminded24At",
  );
  const { candidateId, userId } = await createCandidateWithUser();
  await registerPushToken(userId);
  await setInterviewReminderPref(userId, true);

  const employerId = await createEmployer();
  const jobId = await createJob(employerId);
  const applicationId = await createApplication(jobId, candidateId);

  // Slot 24h from now, inside the ±5min tolerance around T-24h.
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
  const [invite] = await db
    .insert(interviewInvitesTable)
    .values({
      applicationId,
      employerId,
      status: "accepted",
      location: "",
      meetingLink: "",
      notes: "",
    })
    .returning({ id: interviewInvitesTable.id });
  cleanups.push(async () => {
    await db
      .delete(interviewInvitesTable)
      .where(eq(interviewInvitesTable.id, invite.id));
  });
  const [slot] = await db
    .insert(interviewTimeSlotsTable)
    .values({ inviteId: invite.id, startsAt, endsAt })
    .returning({ id: interviewTimeSlotsTable.id });
  await db
    .update(interviewInvitesTable)
    .set({ selectedSlotId: slot.id })
    .where(eq(interviewInvitesTable.id, invite.id));

  captured = [];
  await runInterviewReminderSweep();
  await waitForPushes(1);
  assert(
    captured.length === 1,
    `T-24h sweep dispatches one push (got ${captured.length})`,
  );
  assert(
    captured[0]?.title?.includes("tomorrow"),
    `push title reflects T-24h window (got "${captured[0]?.title ?? ""}")`,
  );

  const [afterFirst] = await db
    .select()
    .from(interviewInvitesTable)
    .where(eq(interviewInvitesTable.id, invite.id));
  assert(
    afterFirst?.reminded24At instanceof Date,
    "reminded24At is stamped after T-24h sweep",
  );
  assert(
    afterFirst?.reminded1At === null,
    "reminded1At remains null (invite is not in the T-1h window)",
  );
  const firstStamp = afterFirst?.reminded24At?.getTime() ?? 0;

  captured = [];
  await runInterviewReminderSweep();
  await waitForPushes(1, 250);
  assert(
    captured.length === 0,
    `second T-24h sweep dispatches no new push (got ${captured.length})`,
  );

  const [afterSecond] = await db
    .select()
    .from(interviewInvitesTable)
    .where(eq(interviewInvitesTable.id, invite.id));
  assert(
    afterSecond?.reminded24At?.getTime() === firstStamp,
    "reminded24At is unchanged by the second T-24h sweep",
  );
}

// ---------- runner ------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Notification dispatcher harness — DATABASE_URL=${process.env.DATABASE_URL ? "set" : "MISSING"}`,
  );
  installFetchStub();
  try {
    await testInviteNotGatedByReminderPref();
    await testReminderSweepIsIdempotent();
    await testReminderSweep24hWindow();
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

main().catch((err) => {
  console.error("Harness crashed:", err);
  process.exit(1);
});
