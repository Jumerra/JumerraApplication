---
name: Drizzle migration journal can drift behind the live schema
description: Why post-merge/prod use journal `migrate` and why catch-up migrations must be idempotent
---

# Drizzle migration journal drift (push vs migrate)

This repo's post-merge script and production deploy apply schema via the
journal-based runner (`pnpm --filter @workspace/db migrate`, i.e.
`drizzle-orm` migrator over the committed `lib/db/drizzle/*.sql` files), NOT
`drizzle-kit push`. That was a deliberate safety choice: `push` silently diffs
the live schema and can drop columns without review.

The hazard: day-to-day dev often creates new tables/columns with
`drizzle-kit push` directly against the dev (and sometimes prod) database
WITHOUT running `generate`. The live DB then has objects that have no
corresponding migration file, and `__drizzle_migrations` has fewer rows than the
journal would imply. A fresh environment that only runs `migrate` is then
MISSING those tables → the feature is broken in CI/new deploys.

**The fix, and the gotcha:** run `pnpm --filter @workspace/db generate` to emit a
catch-up migration — but that migration MUST be made idempotent before
committing (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`CREATE [UNIQUE] INDEX IF NOT EXISTS`, and a `DO $$ ... pg_constraint ... $$`
guard for `ADD CONSTRAINT`, which has no `IF NOT EXISTS`). Reason: live DBs that
already received the objects via `push` would otherwise fail the catch-up
migration with "relation/column already exists". Editing the generated SQL body
is safe — drizzle's `generate` diffs the `meta/` snapshots, not the SQL text.

**How to apply:** after any schema change, always `generate` and commit the
migration (don't leave it as push-only), and if the objects may already exist in
some environments, make that migration idempotent.
