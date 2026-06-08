---
name: DB schema source of truth
description: Why the committed Drizzle migration journal is unreliable and what to use instead
---

# DB schema is provisioned by `drizzle-kit push`, not the migration journal

The committed migration journal at `lib/db/drizzle/` is **stale** — it does not
track newer tables (e.g. the `auto_apply_*` tables defined in
`lib/db/src/schema/auto-apply.ts` have no migration). `lib/db/package.json`
exposes `push` / `push-force` (drizzle-kit push) but the team applies schema via
push, so `migrate(migrationsFolder)` produces a partial database (missing tables
→ Postgres 42P01 "relation does not exist").

**Why:** `drizzle.config.ts` `schema` points at `./src/schema/index.ts` and the
dev/prod DBs are kept in sync with `push`, which reads that live schema directly.
The journal under `out: "./drizzle"` was not regenerated as schema grew.

**How to apply:**
- To stand up a fresh/scratch DB that matches the real schema, run
  `pnpm exec drizzle-kit push --force` (cwd `lib/db`, with `DATABASE_URL` in env)
  — NOT `migrate()`. Example consumer: the auto-apply integration test in
  `artifacts/api-server/src/__tests__/auto-apply.integration.test.ts`.
- If you ever need the migration journal to be authoritative again, regenerate it
  with `drizzle-kit generate` so it includes all current tables.
