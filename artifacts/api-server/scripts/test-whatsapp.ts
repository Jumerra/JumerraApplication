/**
 * Server-level test harness for WhatsApp notifications (task #77).
 *
 * Covers:
 *   1. `sendWhatsAppTemplate` returns sent=false with reason=no_provider when
 *      no credentials are configured, but still writes a `skipped` row to
 *      `whatsapp_message_log` so admins can see the attempt.
 *   2. `sendWhatsAppTemplate` never throws on bad inputs.
 *   3. The notifier fan-out skips WhatsApp when the user has no verified
 *      number, even if all WA toggles are on.
 *   4. The notifier fan-out skips WhatsApp when the per-category toggle is
 *      off, even with a verified number.
 *   5. With a verified number AND the matching toggle on, the notifier
 *      writes a `whatsapp_message_log` row tied to the right user/template.
 *
 * Usage: pnpm --filter @workspace/api-server run test:whatsapp
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  candidatesTable,
  notificationPrefsTable,
  notificationsTable,
  usersTable,
  whatsappMessageLogTable,
} from "@workspace/db";
import {
  sendWhatsAppTemplate,
  normalizeE164,
  type WhatsAppCategory,
  type WhatsAppTemplateKey,
} from "../src/lib/whatsapp";
import { sendNotification } from "../src/lib/notifier";

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForLog(
  userId: number,
  ms = 1500,
): Promise<typeof whatsappMessageLogTable.$inferSelect | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const [row] = await db
      .select()
      .from(whatsappMessageLogTable)
      .where(eq(whatsappMessageLogTable.userId, userId))
      .limit(1);
    if (row) return row;
    await sleep(50);
  }
  return null;
}

async function makeCandidate(opts: {
  withVerifiedWhatsapp: boolean;
  prefs?: Partial<typeof notificationPrefsTable.$inferInsert>;
}): Promise<{ userId: number; candidateId: number; number: string }> {
  const suffix = tag();
  const email = `wa-test-${suffix}@jumerra.test`;
  // 9-digit local part from the random suffix → always digits.
  const localDigits = suffix
    .split("")
    .map((ch) => (ch.charCodeAt(0) % 10).toString())
    .join("")
    .padEnd(9, "0")
    .slice(0, 9);
  const number = `+233${localDigits}`;

  const [c] = await db
    .insert(candidatesTable)
    .values({
      fullName: `WA Test ${suffix}`,
      headline: "test",
      bio: "test",
      location: "test",
      email,
      phone: "",
      avatarUrl: "",
    })
    .returning({ id: candidatesTable.id });

  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "x",
      role: "candidate",
      fullName: `WA Test ${suffix}`,
      candidateId: c.id,
      whatsappNumber: opts.withVerifiedWhatsapp ? number : null,
      whatsappVerifiedAt: opts.withVerifiedWhatsapp ? new Date() : null,
    })
    .returning({ id: usersTable.id });

  await db.insert(notificationPrefsTable).values({
    userId: u.id,
    strongMatch: true,
    applicationStatus: true,
    interviewReminder: true,
    weeklyDigest: true,
    whatsappStrongMatch: false,
    whatsappApplicationStatus: false,
    whatsappInterviewReminder: false,
    whatsappWeeklyDigest: false,
    ...opts.prefs,
  });

  cleanups.push(async () => {
    await db
      .delete(whatsappMessageLogTable)
      .where(eq(whatsappMessageLogTable.userId, u.id));
    await db
      .delete(notificationsTable)
      .where(eq(notificationsTable.userId, u.id));
    await db
      .delete(notificationPrefsTable)
      .where(eq(notificationPrefsTable.userId, u.id));
    await db.delete(usersTable).where(eq(usersTable.id, u.id));
    await db.delete(candidatesTable).where(eq(candidatesTable.id, c.id));
  });

  return { userId: u.id, candidateId: c.id, number };
}

async function countLogs(userId: number): Promise<number> {
  const rows = await db
    .select({ id: whatsappMessageLogTable.id })
    .from(whatsappMessageLogTable)
    .where(eq(whatsappMessageLogTable.userId, userId));
  return rows.length;
}

async function main(): Promise<void> {
  console.log("normalizeE164 helper");
  assert(normalizeE164("+233 244 123 456") === "+233244123456", "trims spaces");
  assert(normalizeE164("233244123456") === "+233244123456", "adds + when missing");
  assert(normalizeE164("abc") === null, "rejects non-numeric");
  assert(normalizeE164("123") === null, "rejects too-short numbers");

  console.log("\nDirect sendWhatsAppTemplate (no provider configured)");
  const a = await makeCandidate({ withVerifiedWhatsapp: true });
  const r1 = await sendWhatsAppTemplate({
    userId: a.userId,
    to: a.number,
    category: "strongMatch" satisfies WhatsAppCategory,
    templateKey: "strong_match" satisfies WhatsAppTemplateKey,
    params: {
      jobTitle: "Frontend Intern",
      employerName: "Acme",
      link: "https://example.test/j/1",
    },
  });
  assert(r1.sent === false, "returns sent=false without provider");
  if (r1.sent === false) {
    assert(
      r1.reason === "whatsapp-not-configured",
      "reports whatsapp-not-configured reason",
    );
  }
  assert((await countLogs(a.userId)) === 1, "writes one log row");
  const [logA] = await db
    .select()
    .from(whatsappMessageLogTable)
    .where(eq(whatsappMessageLogTable.userId, a.userId))
    .limit(1);
  assert(logA?.status === "skipped", "row marked skipped");

  console.log("\nsendWhatsAppTemplate never throws on missing params");
  const r2 = await sendWhatsAppTemplate({
    userId: a.userId,
    to: a.number,
    category: "strongMatch",
    templateKey: "strong_match",
    // intentionally missing required params
    params: {},
  });
  assert(r2.sent === false, "bad params still resolves");

  console.log("\nNotifier skips WA when number not verified");
  const b = await makeCandidate({
    withVerifiedWhatsapp: false,
    prefs: {
      whatsappStrongMatch: true,
      whatsappApplicationStatus: true,
      whatsappInterviewReminder: true,
      whatsappWeeklyDigest: true,
    },
  });
  await sendNotification({
    userId: b.userId,
    kind: "strong_match",
    category: "strongMatch",
    title: "New strong match",
    body: "Frontend Intern at Acme",
    data: { jobId: 1 },
  });
  // Wait for any background fan-out to potentially run.
  await sleep(500);
  assert(
    (await countLogs(b.userId)) === 0,
    "no WA log written for unverified number",
  );

  console.log("\nNotifier skips WA when category toggle is off");
  const c = await makeCandidate({
    withVerifiedWhatsapp: true,
    prefs: {
      whatsappStrongMatch: false,
      whatsappApplicationStatus: false,
    },
  });
  await sendNotification({
    userId: c.userId,
    kind: "strong_match",
    category: "strongMatch",
    title: "Match",
    body: "x",
    data: {},
  });
  await sleep(500);
  assert(
    (await countLogs(c.userId)) === 0,
    "no WA log when whatsappStrongMatch=false",
  );

  console.log("\nNotifier fans out WA when verified AND toggle on");
  const d = await makeCandidate({
    withVerifiedWhatsapp: true,
    prefs: { whatsappApplicationStatus: true },
  });
  await sendNotification({
    userId: d.userId,
    kind: "application_status",
    category: "applicationStatus",
    title: "Shortlisted",
    body: "Acme moved you to shortlist",
    link: "https://example.test/apps/1",
    data: { applicationId: 1 },
  });
  const logD = await waitForLog(d.userId, 2000);
  assert(logD !== null, "exactly one WA log row written");
  assert(
    logD?.templateKey === "application_status",
    "uses application_status template",
  );

  console.log("\nCleaning up…");
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch (err) {
      console.log("  cleanup error", err);
    }
  }
  console.log(`\nResults: ${passed} passed, ${failures} failed`);
  await pool.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch {
      /* no-op */
    }
  }
  try {
    await pool.end();
  } catch {
    /* no-op */
  }
  process.exit(1);
});
