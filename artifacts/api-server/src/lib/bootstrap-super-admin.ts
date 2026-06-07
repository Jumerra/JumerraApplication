import { db, usersTable } from "@workspace/db";
import { hashPassword } from "./auth";
import { logger } from "./logger";

/**
 * One-time, idempotent super-admin bootstrap.
 *
 * When BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD are
 * both present in the environment, ensure a super-admin account exists with
 * that email + password. It runs against whatever database the process is
 * connected to (development OR production).
 *
 * Why this exists: the production database is separate from development and
 * is read-only to external tooling, so the only supported way to seed a
 * super-admin into production is from the running production app itself.
 * Set the two secrets, publish, sign in, then remove the secrets.
 *
 * NOTE: while configured, every boot re-applies the password (and promotes
 * the account to active super_admin). That makes it self-healing but also
 * means a manual password change would be reverted on the next restart —
 * remove the two secrets once you have signed in. The password is read from
 * a secret and is NEVER logged.
 */
export async function bootstrapSuperAdmin(): Promise<void> {
  const email = process.env["BOOTSTRAP_SUPER_ADMIN_EMAIL"]
    ?.trim()
    .toLowerCase();
  const password = process.env["BOOTSTRAP_SUPER_ADMIN_PASSWORD"];

  if (!email || !password) {
    return; // not configured — no-op
  }

  if (password.length < 8) {
    logger.error(
      { email },
      "bootstrapSuperAdmin: BOOTSTRAP_SUPER_ADMIN_PASSWORD must be at least 8 characters — skipping",
    );
    return;
  }

  const fullName =
    process.env["BOOTSTRAP_SUPER_ADMIN_NAME"]?.trim() || "Super Admin";

  try {
    const passwordHash = await hashPassword(password);

    // Single atomic upsert keyed on the unique email index. This is
    // race-safe across concurrent autoscale instance boots — there's no
    // read-then-write window where two instances both try to INSERT.
    await db
      .insert(usersTable)
      .values({
        email,
        passwordHash,
        role: "admin",
        orgRole: "super_admin",
        status: "active",
        fullName,
        approvedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: {
          passwordHash,
          role: "admin",
          orgRole: "super_admin",
          status: "active",
          fullName,
          approvedAt: new Date(),
        },
      });

    logger.info(
      { email },
      "bootstrapSuperAdmin: ensured active super_admin (idempotent upsert)",
    );
  } catch (err) {
    logger.error({ err, email }, "bootstrapSuperAdmin failed");
  }
}
