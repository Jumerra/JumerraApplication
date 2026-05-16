/**
 * Server-level test harness for the candidate growth plan (task #75).
 *
 * Covers:
 *   1. `refreshGrowthPlan` counts missing skills across the candidate's
 *      90-day rejections and upserts the top-3 as active.
 *   2. Top-3 invariant: an active skill that drops out of the top is
 *      demoted to "superseded" (active count never exceeds 3).
 *   3. `repingEmployersForCompletedSkill` notifies an employer and
 *      writes one audit row; a second call within the same quarter is
 *      blocked by the unique-quarter index (no duplicate notification).
 *   4. Dismiss via ON CONFLICT DO NOTHING is safely idempotent.
 *
 * Usage: pnpm --filter @workspace/api-server run test:growth-plan
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  applicationsTable,
  candidateGrowthRepingsTable,
  candidateGrowthSkillsTable,
  candidatesTable,
  db,
  employersTable,
  jobsTable,
  notificationsTable,
  pool,
  usersTable,
} from "@workspace/db";
import {
  refreshGrowthPlan,
  repingEmployersForCompletedSkill,
} from "../src/lib/growth-plan";

function tag(): string {
  return randomBytes(4).toString("hex");
}

async function main() {
  const t = tag();
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      failures.push(name);
      console.log(`  ✗ ${name}`);
    }
  };

  const [employer] = await db
    .insert(employersTable)
    .values({
      name: `Growth Co ${t}`,
      tagline: "t",
      description: "t",
      industry: "tech",
      location: "Remote",
      logoUrl: "",
      coverUrl: "",
      websiteUrl: "",
      size: "1-10",
    })
    .returning({ id: employersTable.id });

  const [staff] = await db
    .insert(usersTable)
    .values({
      email: `staff-${t}@test.local`,
      role: "employer",
      status: "active",
      fullName: "Staff",
      employerId: employer.id,
    })
    .returning({ id: usersTable.id });

  const [candidate] = await db
    .insert(candidatesTable)
    .values({
      fullName: `Cand ${t}`,
      headline: "h",
      bio: "b",
      location: "Testville",
      email: `cand-${t}@test.local`,
      phone: "",
      avatarUrl: "",
      skills: ["html"],
      yearsExperience: 0,
      talentScore: 50,
    })
    .returning({ id: candidatesTable.id });

  await db.insert(usersTable).values({
    email: `cuser-${t}@test.local`,
    role: "candidate",
    status: "active",
    fullName: `Cand ${t}`,
    candidateId: candidate.id,
  });

  const seedJob = async (skills: string[]) => {
    const [job] = await db
      .insert(jobsTable)
      .values({
        employerId: employer.id,
        title: `Role ${t} ${skills.join("/")}`,
        type: "full_time",
        location: "Testville",
        remote: false,
        summary: "s",
        description: "d",
        skills,
      })
      .returning({ id: jobsTable.id });
    await db.insert(applicationsTable).values({
      jobId: job.id,
      candidateId: candidate.id,
      status: "rejected",
      matchScore: 30,
    });
  };

  // react×3, typescript×2, python×1, sql×1 missing
  for (const s of [
    ["react", "typescript"],
    ["react", "python"],
    ["react", "sql"],
    ["typescript"],
  ]) {
    await seedJob(s);
  }

  await refreshGrowthPlan(candidate.id);
  const active1 = await db
    .select()
    .from(candidateGrowthSkillsTable)
    .where(
      and(
        eq(candidateGrowthSkillsTable.candidateId, candidate.id),
        eq(candidateGrowthSkillsTable.status, "active"),
      ),
    );
  assert(active1.length === 3, "top-3 active rows created");
  const names1 = active1.map((r) => r.skill);
  assert(names1.includes("react"), "react picked (3 rejections)");
  assert(names1.includes("typescript"), "typescript picked (2 rejections)");

  // Push python far above the others — invariant: still ≤3 actives.
  for (let i = 0; i < 5; i++) await seedJob(["python", "docker"]);
  await refreshGrowthPlan(candidate.id);
  const active2 = await db
    .select()
    .from(candidateGrowthSkillsTable)
    .where(
      and(
        eq(candidateGrowthSkillsTable.candidateId, candidate.id),
        eq(candidateGrowthSkillsTable.status, "active"),
      ),
    );
  assert(active2.length === 3, "still capped at top-3 after re-run");
  const supersededCount = (
    await db
      .select()
      .from(candidateGrowthSkillsTable)
      .where(
        and(
          eq(candidateGrowthSkillsTable.candidateId, candidate.id),
          eq(candidateGrowthSkillsTable.status, "superseded"),
        ),
      )
  ).length;
  assert(supersededCount >= 1, "at least one prior active was demoted");

  // First reping notifies; second blocked by unique-quarter index.
  const r1 = await repingEmployersForCompletedSkill(candidate.id, "react");
  assert(r1.employersNotified === 1, "first reping notifies 1 employer");
  const audit1 = await db
    .select()
    .from(candidateGrowthRepingsTable)
    .where(eq(candidateGrowthRepingsTable.candidateId, candidate.id));
  assert(audit1.length === 1, "one audit row written");
  const notif1 = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, staff.id),
        eq(notificationsTable.kind, "growth_skill_reping"),
      ),
    );
  assert(notif1.length === 1, "staff received exactly one notification");

  const r2 = await repingEmployersForCompletedSkill(
    candidate.id,
    "typescript",
  );
  assert(r2.employersNotified === 0, "second reping in same quarter blocked");
  const audit2 = await db
    .select()
    .from(candidateGrowthRepingsTable)
    .where(eq(candidateGrowthRepingsTable.candidateId, candidate.id));
  assert(audit2.length === 1, "no duplicate audit row");
  const notif2 = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, staff.id),
        eq(notificationsTable.kind, "growth_skill_reping"),
      ),
    );
  assert(notif2.length === 1, "no duplicate notification");

  // Idempotent dismiss (concurrent simulation via repeated insert).
  const dismissOnce = () =>
    db
      .insert(candidateGrowthSkillsTable)
      .values({
        candidateId: candidate.id,
        skill: `brand-new-${t}`,
        status: "dismissed",
        dismissedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          candidateGrowthSkillsTable.candidateId,
          candidateGrowthSkillsTable.skill,
        ],
      });
  await dismissOnce();
  await dismissOnce();
  const dismissed = await db
    .select()
    .from(candidateGrowthSkillsTable)
    .where(
      and(
        eq(candidateGrowthSkillsTable.candidateId, candidate.id),
        eq(candidateGrowthSkillsTable.skill, `brand-new-${t}`),
      ),
    );
  assert(dismissed.length === 1, "duplicate dismiss is idempotent");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("Failures:", failures);
    process.exitCode = 1;
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
