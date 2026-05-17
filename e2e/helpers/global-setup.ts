import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./constants";
import { RUN_TAG } from "./env";

/** Deterministic seed phase for the Playwright suite.
 *
 *  Provisions:
 *  1. The e2e admin user (idempotent upsert by email — fixed across
 *     runs so admin login works without env knobs).
 *  2. The shared per-run RUN_TAG is touched by the first import of
 *     ./env above, which writes it to .playwright-cache/run-tag so
 *     worker processes + globalTeardown all see the same value.
 *
 *  Per-test fixtures (candidates, employers, institutions, jobs,
 *  applications, boost-payment rows) are intentionally created INSIDE
 *  the journey specs rather than seeded here, because each journey
 *  must drive the full create path through the API to prove the
 *  product flow works end-to-end. They are still deterministic with
 *  respect to RUN_TAG: every row is tagged with `${RUN_TAG}` so
 *  globalTeardown's LIKE-delete catches them. */
export default async function globalSetup(): Promise<void> {
  // Force first read so the persisted run-tag file exists by the
  // time the first worker process imports ./env.
  void RUN_TAG;

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, ADMIN_EMAIL))
    .limit(1);

  if (existing[0]) {
    await db
      .update(usersTable)
      .set({
        passwordHash,
        status: "active",
        role: "admin",
        orgRole: "super_admin",
        approvedAt: new Date(),
      })
      .where(eq(usersTable.id, existing[0].id));
  } else {
    await db.insert(usersTable).values({
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      orgRole: "super_admin",
      status: "active",
      fullName: "E2E Admin",
      approvedAt: new Date(),
    });
  }

  // Note: do NOT end the pool here. Playwright runs globalSetup and
  // globalTeardown in the same node process, sharing the @workspace/db
  // module-level singleton — closing it here would make teardown fail
  // with "Cannot use a pool after calling end on the pool".
}
