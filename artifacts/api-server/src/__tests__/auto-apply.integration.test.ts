import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";

const { Pool } = pg;

/**
 * End-to-end integration test for the AI Auto-Apply engine.
 *
 * The sibling `auto-apply.test.ts` suite covers the *pure* decision logic
 * (`candidateEligibleForAutoApply`, `decideAutoApplySubmit`,
 * `subscriptionUnlocksAutoApply`). This suite exercises the DB-bound submit
 * path that those unit tests cannot reach:
 *  - the applications-table dedupe lookup,
 *  - the rolling-24h daily-cap count query,
 *  - the challenge re-check inside the write transaction,
 *  - the `auto_apply_log` UNIQUE(candidate_id, job_id) dedupe, and
 *  - the actual application-record creation.
 *
 * There is no pre-existing DB-backed test harness in this repo (every other
 * suite mocks `@workspace/db`), so this file stands up its own throwaway
 * Postgres database: it `CREATE DATABASE`s a uniquely-named scratch DB,
 * builds the full live Drizzle schema into it with `drizzle-kit push`
 * (the committed migration journal is stale and omits the auto_apply tables),
 * points `process.env.DATABASE_URL` at it, and only THEN dynamically imports
 * `@workspace/db` + the auto-apply module so the singleton pool binds to the
 * scratch DB. `pool: "forks"` (vitest.config.ts) isolates this env mutation to
 * this file's worker process. The DB is dropped in `afterAll`.
 */

// Loaded lazily in beforeAll AFTER DATABASE_URL is repointed.
type DbModule = typeof import("@workspace/db");
type AutoApplyModule = typeof import("../lib/auto-apply");

let dbmod: DbModule;
let autoApply: AutoApplyModule;
let adminPool: pg.Pool;
let scratchDbName: string;
let originalDatabaseUrl: string;

async function dropScratchDb(): Promise<void> {
  // Terminate any lingering backends, then drop. WITH (FORCE) covers PG13+;
  // the explicit terminate keeps it working on older servers too.
  try {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [scratchDbName],
    );
  } catch {
    /* best effort */
  }
  await adminPool.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL ?? "";
  if (!originalDatabaseUrl) {
    throw new Error("DATABASE_URL must be set to run the auto-apply integration test");
  }

  // 1. Create a uniquely-named throwaway database on the same server.
  scratchDbName = `jumerra_aa_itest_${Date.now()}_${Math.floor(
    Math.random() * 1e6,
  )}`;
  adminPool = new Pool({ connectionString: originalDatabaseUrl });
  await adminPool.query(`CREATE DATABASE "${scratchDbName}"`);

  // 2. Repoint DATABASE_URL at the scratch DB.
  const scratchUrl = new URL(originalDatabaseUrl);
  scratchUrl.pathname = `/${scratchDbName}`;
  process.env.DATABASE_URL = scratchUrl.toString();

  // 3. Build the full schema into the scratch DB with `drizzle-kit push`.
  //    This repo's source of truth is the live Drizzle schema applied via
  //    `push` — the committed migration journal (lib/db/drizzle) is stale and
  //    does NOT include newer tables such as `auto_apply_settings`/`auto_apply_log`,
  //    so `migrate()` would leave the engine's tables missing. `push --force`
  //    reads ./src/schema/index.ts directly, so every table the engine touches
  //    exists. drizzle.config.ts reads DATABASE_URL from the (child) env.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/__tests__ -> ../../../../lib/db
  const dbPackageDir = path.resolve(here, "..", "..", "..", "..", "lib", "db");
  execFileSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
  });

  // 4. Import the singleton-bound modules AFTER the schema is in place and the
  //    env is repointed so their pool connects to the scratch DB. Static
  //    imports would bind to the dev DB.
  dbmod = await import("@workspace/db");
  autoApply = await import("../lib/auto-apply");

  const { rows } = await dbmod.pool.query<{ c: string }>(
    `SELECT count(*)::int AS c FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'auto_apply_settings'`,
  );
  if (Number(rows[0]?.c ?? 0) === 0) {
    throw new Error("drizzle-kit push did not create auto_apply_settings");
  }
}, 120_000);

afterAll(async () => {
  // Close the singleton pool that bound to the scratch DB, then drop it.
  // The notifier runs fire-and-forget, so give any in-flight notification
  // writes a brief moment to settle before tearing the pool down — otherwise
  // they log a benign "Cannot use a pool after calling end" stderr line.
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    await dbmod?.pool.end();
  } catch {
    /* best effort */
  }
  if (adminPool) {
    try {
      await dropScratchDb();
    } finally {
      await adminPool.end();
    }
  }
  if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
});

// Wipe every table between tests so each starts from a clean slate. The
// drizzle migration bookkeeping lives in the `drizzle` schema, not `public`,
// so truncating all of `public` leaves the schema intact.
beforeEach(async () => {
  const { rows } = await dbmod.pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await dbmod.pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const MATCHING_SKILLS = ["react", "typescript"];

async function seedSettings(opts: {
  isActive?: boolean;
  matchThreshold?: number;
  dailyCap?: number;
}): Promise<void> {
  const { autoApplySettingsTable } = dbmod;
  await dbmod.db
    .insert(autoApplySettingsTable)
    .values({
      id: 1,
      isActive: opts.isActive ?? true,
      matchThreshold: opts.matchThreshold ?? 75,
      dailyCap: opts.dailyCap ?? 10,
    })
    .onConflictDoUpdate({
      target: autoApplySettingsTable.id,
      set: {
        isActive: opts.isActive ?? true,
        matchThreshold: opts.matchThreshold ?? 75,
        dailyCap: opts.dailyCap ?? 10,
      },
    });
}

async function seedEmployer(): Promise<number> {
  const { employersTable } = dbmod;
  const [row] = await dbmod.db
    .insert(employersTable)
    .values({
      name: "Acme Co",
      tagline: "We build things",
      description: "An employer used in tests",
      industry: "Software",
      location: "Remote",
      logoUrl: "https://example.com/logo.png",
      coverUrl: "https://example.com/cover.png",
      websiteUrl: "https://example.com",
      size: "11-50",
    })
    .returning({ id: employersTable.id });
  return row!.id;
}

async function seedJob(opts: {
  employerId: number;
  title?: string;
  skills?: string[];
  visibility?: string;
}): Promise<number> {
  const { jobsTable } = dbmod;
  const [row] = await dbmod.db
    .insert(jobsTable)
    .values({
      employerId: opts.employerId,
      title: opts.title ?? "Frontend Engineer",
      type: "full_time",
      location: "Remote",
      summary: "Build the frontend",
      description: "A job used in tests",
      skills: opts.skills ?? MATCHING_SKILLS,
      visibility: opts.visibility ?? "public",
    })
    .returning({ id: jobsTable.id });
  return row!.id;
}

async function seedCandidate(opts: {
  skills?: string[];
  yearsExperience?: number;
  talentScore?: number;
  autoApplyEnabled?: boolean;
  email?: string;
}): Promise<{ candidateId: number; userId: number }> {
  const { candidatesTable, usersTable } = dbmod;
  const email = opts.email ?? `cand_${Math.random().toString(36).slice(2)}@test.dev`;
  const [cand] = await dbmod.db
    .insert(candidatesTable)
    .values({
      fullName: "Test Candidate",
      headline: "Engineer",
      bio: "bio",
      location: "Remote",
      email,
      phone: "+10000000000",
      avatarUrl: "https://example.com/avatar.png",
      skills: opts.skills ?? MATCHING_SKILLS,
      yearsExperience: opts.yearsExperience ?? 10,
      talentScore: opts.talentScore ?? 100,
      autoApplyEnabled: opts.autoApplyEnabled ?? true,
    })
    .returning({ id: candidatesTable.id });
  const candidateId = cand!.id;
  // Link a user so notifier dispatch (nudges / success notices) resolves.
  const [user] = await dbmod.db
    .insert(usersTable)
    .values({
      email,
      role: "candidate",
      status: "active",
      fullName: "Test Candidate",
      candidateId,
    })
    .returning({ id: usersTable.id });
  return { candidateId, userId: user!.id };
}

async function seedActiveSubscription(candidateId: number): Promise<void> {
  const { autoApplySubscriptionsTable } = dbmod;
  await dbmod.db.insert(autoApplySubscriptionsTable).values({
    candidateId,
    stripeCheckoutSessionId: `cs_${candidateId}_${Math.random()
      .toString(36)
      .slice(2)}`,
    provider: "stripe",
    status: "active",
    priceCentsSnapshot: 150000,
    currencySnapshot: "ngn",
    intervalDaysSnapshot: 30,
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    startedAt: new Date(),
  });
}

async function seedChallenge(jobId: number): Promise<void> {
  const { jobChallengesTable } = dbmod;
  await dbmod.db.insert(jobChallengesTable).values({
    jobId,
    title: "Skill challenge",
    passingScore: 50,
  });
}

async function seedExistingApplication(
  jobId: number,
  candidateId: number,
): Promise<void> {
  const { applicationsTable } = dbmod;
  await dbmod.db.insert(applicationsTable).values({
    jobId,
    candidateId,
    status: "applied",
    source: "browse",
    matchScore: 80,
  });
}

// ---------------------------------------------------------------------------
// Count + poll helpers
// ---------------------------------------------------------------------------

async function countRows(table: string, where = ""): Promise<number> {
  const { rows } = await dbmod.pool.query<{ c: string }>(
    `SELECT count(*)::int AS c FROM "${table}" ${where}`,
  );
  return Number(rows[0]?.c ?? 0);
}

async function pollUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 3000,
  stepMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auto-apply engine (DB integration)", () => {
  it("writes exactly one application + one auto_apply_log row for an eligible candidate", async () => {
    await seedSettings({ isActive: true, matchThreshold: 75, dailyCap: 10 });
    const employerId = await seedEmployer();
    const jobId = await seedJob({ employerId });
    const { candidateId } = await seedCandidate({});
    await seedActiveSubscription(candidateId);

    await autoApply.runAutoApplyForJob(jobId);

    expect(
      await countRows(
        "applications",
        `WHERE job_id = ${jobId} AND candidate_id = ${candidateId}`,
      ),
    ).toBe(1);
    expect(
      await countRows(
        "auto_apply_log",
        `WHERE job_id = ${jobId} AND candidate_id = ${candidateId}`,
      ),
    ).toBe(1);

    // The created application is tagged as auto_apply and linked from the log.
    const { rows } = await dbmod.pool.query<{
      source: string;
      application_id: number | null;
      app_id: number;
    }>(
      `SELECT a.source, l.application_id, a.id AS app_id
         FROM applications a
         JOIN auto_apply_log l ON l.candidate_id = a.candidate_id AND l.job_id = a.job_id
         WHERE a.job_id = ${jobId} AND a.candidate_id = ${candidateId}`,
    );
    expect(rows[0]?.source).toBe("auto_apply");
    expect(rows[0]?.application_id).toBe(rows[0]?.app_id);
  });

  it("does not write a log row (or duplicate application) when an application already exists", async () => {
    await seedSettings({ isActive: true, matchThreshold: 75, dailyCap: 10 });
    const employerId = await seedEmployer();
    const jobId = await seedJob({ employerId });
    const { candidateId } = await seedCandidate({});
    await seedActiveSubscription(candidateId);
    await seedExistingApplication(jobId, candidateId);

    await autoApply.runAutoApplyForJob(jobId);

    // Still exactly the one pre-existing application; no second row created.
    expect(
      await countRows(
        "applications",
        `WHERE job_id = ${jobId} AND candidate_id = ${candidateId}`,
      ),
    ).toBe(1);
    // Critically: no auto_apply_log row, so the pre-existing application never
    // consumes the daily cap nor gets falsely reported as an auto-apply.
    expect(
      await countRows(
        "auto_apply_log",
        `WHERE job_id = ${jobId} AND candidate_id = ${candidateId}`,
      ),
    ).toBe(0);
  });

  it("skips challenge-gated jobs and nudges the candidate instead", async () => {
    await seedSettings({ isActive: true, matchThreshold: 75, dailyCap: 10 });
    const employerId = await seedEmployer();
    const jobId = await seedJob({ employerId });
    const { candidateId, userId } = await seedCandidate({});
    await seedActiveSubscription(candidateId);
    await seedChallenge(jobId);

    await autoApply.runAutoApplyForJob(jobId);

    // No auto-submitted application or log row for a gated job.
    expect(
      await countRows(
        "applications",
        `WHERE job_id = ${jobId} AND candidate_id = ${candidateId}`,
      ),
    ).toBe(0);
    expect(
      await countRows("auto_apply_log", `WHERE job_id = ${jobId}`),
    ).toBe(0);

    // The candidate is nudged to take the challenge (notification is dispatched
    // fire-and-forget, so poll for it).
    const nudged = await pollUntil(async () => {
      const c = await countRows(
        "notifications",
        `WHERE user_id = ${userId} AND kind = 'auto_apply' AND link = '/jobs/${jobId}'`,
      );
      return c === 1;
    });
    expect(nudged).toBe(true);
  });

  it("stops auto-submitting once the rolling daily cap is reached", async () => {
    const dailyCap = 2;
    await seedSettings({ isActive: true, matchThreshold: 75, dailyCap });
    const employerId = await seedEmployer();
    // More eligible jobs than the cap allows.
    const jobIds: number[] = [];
    for (let i = 0; i < dailyCap + 2; i++) {
      jobIds.push(await seedJob({ employerId, title: `Job ${i}` }));
    }
    const { candidateId } = await seedCandidate({});
    await seedActiveSubscription(candidateId);

    await autoApply.runAutoApplyPass();

    // Exactly `dailyCap` applications + log rows, no more.
    expect(
      await countRows("applications", `WHERE candidate_id = ${candidateId}`),
    ).toBe(dailyCap);
    expect(
      await countRows("auto_apply_log", `WHERE candidate_id = ${candidateId}`),
    ).toBe(dailyCap);
  });
});
