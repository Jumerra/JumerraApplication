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
 * CREATE-ONLY BY DEFAULT: this seeds the super-admin only when the account
 * does NOT already exist. If the account is already present, the bootstrap is
 * a no-op — it will NOT touch the stored password, role, or status. This means
 * leaving the secrets configured can no longer silently revert a password you
 * later changed from the dashboard on the next restart/redeploy.
 *
 * ROTATE OPT-IN: set BOOTSTRAP_SUPER_ADMIN_ROTATE=true to force-reset the
 * password (and re-promote the account to active super_admin) on the next
 * boot — use this only when you've genuinely lost access. Remember to turn it
 * back off (and ideally remove the secrets) once you've signed in, otherwise
 * every boot will keep re-applying the password again.
 *
 * The password is read from a secret and is NEVER logged.
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

  // Opt-in password rotation. Off by default so an existing account is never
  // silently reset. Accepts the usual truthy spellings.
  const rotate = ["true", "1", "yes"].includes(
    (process.env["BOOTSTRAP_SUPER_ADMIN_ROTATE"] ?? "").trim().toLowerCase(),
  );

  const fullName =
    process.env["BOOTSTRAP_SUPER_ADMIN_NAME"]?.trim() || "Super Admin";

  try {
    const passwordHash = await hashPassword(password);

    // Single atomic upsert keyed on the unique email index. This is
    // race-safe across concurrent autoscale instance boots — there's no
    // read-then-write window where two instances both try to INSERT.
    //
    // Default path: onConflictDoNothing — create the account if missing,
    // otherwise leave the existing row (and its password) untouched. The
    // rotate path additionally resets the password + re-promotes on conflict.
    const insert = db
      .insert(usersTable)
      .values({
        email,
        passwordHash,
        role: "admin",
        orgRole: "super_admin",
        status: "active",
        fullName,
        approvedAt: new Date(),
      });

    if (rotate) {
      await insert.onConflictDoUpdate({
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
      logger.warn(
        { email },
        "bootstrapSuperAdmin: rotate enabled — force-reset password and re-promoted super_admin (disable BOOTSTRAP_SUPER_ADMIN_ROTATE once signed in)",
      );
    } else {
      const inserted = await insert
        .onConflictDoNothing({ target: usersTable.email })
        .returning({ id: usersTable.id });

      if (inserted.length > 0) {
        logger.info(
          { email },
          "bootstrapSuperAdmin: seeded new active super_admin (create-only)",
        );
      } else {
        logger.info(
          { email },
          "bootstrapSuperAdmin: account already exists — leaving password untouched (set BOOTSTRAP_SUPER_ADMIN_ROTATE=true to force a reset)",
        );
      }
    }
  } catch (err) {
    logger.error({ err, email }, "bootstrapSuperAdmin failed");
  }
}
