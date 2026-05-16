/**
 * Apply pending Drizzle migrations against $DATABASE_URL.
 *
 * Wired into `pnpm --filter @workspace/db migrate` (dev) and
 * `pnpm --filter @workspace/db migrate:prod` (production deploy /
 * post-merge hook). Replaces `drizzle-kit push`, which silently
 * applies whatever the live schema diff is — a footgun for prod
 * because it bypasses review and can drop columns. The migrate
 * runner only applies files committed to `lib/db/drizzle/`, so
 * schema changes go through code review like everything else.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run migrations");
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/migrate.ts → ../drizzle (lib/db/drizzle)
  const migrationsFolder = path.resolve(here, "..", "drizzle");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder });
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied migrations from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed:", err);
  process.exit(1);
});
