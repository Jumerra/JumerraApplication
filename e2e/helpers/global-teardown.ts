import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { RUN_TAG } from "./env";

/** Tear down everything tagged with the current run. Uses a pattern
 *  match instead of a strict equality so unique-suffixed rows
 *  (e.g. `emp-e2e-xyz123-7`) are caught alongside the base tag.
 *
 *  Ordering matters because some FKs are RESTRICT — children first. */
export default async function globalTeardown(): Promise<void> {
  const like = `%${RUN_TAG}%`;
  try {
    // Applications -> jobs -> employers / candidates
    await db.execute(sql`
      DELETE FROM applications
      WHERE candidate_id IN (SELECT id FROM candidates WHERE full_name LIKE ${like} OR email LIKE ${like})
         OR job_id IN (SELECT id FROM jobs WHERE title LIKE ${like});
    `);
    await db.execute(sql`DELETE FROM jobs WHERE title LIKE ${like};`);
    await db.execute(sql`
      DELETE FROM candidate_institutions
      WHERE candidate_id IN (SELECT id FROM candidates WHERE full_name LIKE ${like} OR email LIKE ${like})
         OR institution_id IN (SELECT id FROM institutions WHERE name LIKE ${like});
    `);
    await db.execute(sql`
      DELETE FROM boost_payments
      WHERE stripe_session_id LIKE ${like} OR paystack_reference LIKE ${like};
    `);
    await db.execute(sql`
      DELETE FROM webhook_events WHERE event_id LIKE ${like};
    `);
    await db.execute(sql`
      DELETE FROM password_setup_tokens
      WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${like} OR full_name LIKE ${like});
    `);
    await db.execute(sql`
      DELETE FROM pending_registrations
      WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${like} OR full_name LIKE ${like});
    `);
    await db.execute(sql`
      DELETE FROM users WHERE email LIKE ${like} OR full_name LIKE ${like};
    `);
    await db.execute(sql`
      DELETE FROM candidates WHERE full_name LIKE ${like} OR email LIKE ${like};
    `);
    await db.execute(sql`DELETE FROM employers WHERE name LIKE ${like};`);
    await db.execute(sql`DELETE FROM institutions WHERE name LIKE ${like};`);
  } finally {
    // Pool may already be ended by a test fixture; swallow the
    // "Called end on pool more than once" so teardown stays clean.
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }
}
