/**
 * Seed (or update) a super admin user.
 *
 * Reads DATABASE_URL from env. Idempotent: if the email already exists,
 * the password and role/status are updated; otherwise a new row is inserted.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed-super-admin \
 *     -- --email=foo@bar.com --password='SecretPw!' --name='Full Name'
 *
 * If --email/--password are omitted, defaults below are used.
 */
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main() {
  const email = arg("email", "moses@jumerra.com").trim().toLowerCase();
  const password = arg("password", "Encrypted@1992");
  const fullName = arg("name", "Moses (Super Admin)");

  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);

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
        fullName,
        approvedAt: new Date(),
      })
      .where(eq(usersTable.id, existing[0].id));
    console.log(
      `Updated existing user id=${existing[0].id} email=${email} -> super_admin/active`,
    );
  } else {
    const inserted = await db
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
      .returning({ id: usersTable.id });
    console.log(
      `Created super admin id=${inserted[0].id} email=${email}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
