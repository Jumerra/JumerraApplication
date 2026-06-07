import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
 * Safe to leave configured (the upsert is idempotent), but removing the
 * secrets after first sign-in is recommended. The password is read from a
 * secret and is NEVER logged.
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

    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing[0]) {
      await db
        .update(usersTable)
        .set({
          passwordHash,
          role: "admin",
          orgRole: "super_admin",
          status: "active",
          approvedAt: new Date(),
        })
        .where(eq(usersTable.id, existing[0].id));
      logger.info(
        { email, action: "updated" },
        "bootstrapSuperAdmin: existing user promoted to active super_admin",
      );
    } else {
      await db.insert(usersTable).values({
        email,
        passwordHash,
        role: "admin",
        orgRole: "super_admin",
        status: "active",
        fullName,
        approvedAt: new Date(),
      });
      logger.info(
        { email, action: "created" },
        "bootstrapSuperAdmin: created new super_admin",
      );
    }
  } catch (err) {
    logger.error({ err, email }, "bootstrapSuperAdmin failed");
  }
}
