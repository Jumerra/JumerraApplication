import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Paths are relative to the lib/db package (drizzle-kit is always
// invoked via `pnpm --filter @workspace/db ...`). Absolute paths here
// break `drizzle-kit generate` because the snapshot loader prepends
// `./` to the configured `out` and ends up reading `.//abs/path`.
export default defineConfig({
  schema: "./src/schema/index.ts",
  // Committed migrations land here so `pnpm --filter @workspace/db migrate`
  // (and the prod post-merge hook) applies the same set the team reviewed.
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
