---
name: Production hosting (Render)
description: Where Jumerra's real production runs and why Replit-side fixes don't reach it.
---

# Production hosting

The user's REAL production site is a **Render** deployment served on a **custom domain**, NOT the Replit deployment.

**Confirmed Render architecture (June 2026):**
- `jumerra-web` — STATIC SITE (the talent-platform frontend), custom domain `jumerra.com`, env `VITE_API_BASE_URL=https://api.jumerra.com`. Cannot run server code; bootstrap/server env vars set here do NOTHING.
- `JumerraApplication` — NODE web service (the api-server backend), custom domain `api.jumerra.com`, internal port 10000, deploys GitHub `main`. This is where server env vars (BOOTSTRAP_SUPER_ADMIN_*, SESSION_SECRET, DATABASE_URL, ALLOWED_ORIGINS, etc.) belong.
- `jumerra-db` — Render PostgreSQL (the production DB the Node backend connects to).
- CORS for the custom domain is driven by the `ALLOWED_ORIGINS` env var (comma-separated full origins) in `app.ts` `buildAllowedOrigins()`, since REPLIT_DOMAINS is absent on Render. Frontend `jumerra.com` ↔ backend `api.jumerra.com` are same registrable domain, so session cookies are same-site.

**Why this matters:**
- Render builds from the GitHub repo `github.com/Jumerra/JumerraApplication` (remote `subrepl-0boii8td`).
- Render has its OWN database, separate from both Replit dev and the Replit deploy. An account that exists in the Replit DB does not exist in Render's DB.
- Env vars/secrets set in Replit do NOT propagate to Render. They must be set in the Render dashboard.

**How to apply:**
- Any production fix (data seeding, schema, env-driven behavior) must reach Render: code on GitHub `main`, then a Render deploy, plus the relevant env vars set in Render's dashboard.
- The boot-time super-admin bootstrap (artifacts/api-server/src/lib/bootstrap-super-admin.ts) only runs when BOOTSTRAP_SUPER_ADMIN_EMAIL + BOOTSTRAP_SUPER_ADMIN_PASSWORD are present in that environment — so it no-ops on Render until those vars are added there.
- We (the agent) cannot access Render directly; production seeding/verification on the live site requires user action in the Render dashboard — UNLESS the user provides the Render DB external connection string, in which case we can connect via psql and inspect/fix the schema directly (any schema change is shared by the live backend with no redeploy needed).

**`jumerra-db` is `drizzle-kit push`-managed, NOT file-migrator-managed (confirmed June 2026):**
- The prod DB has **no `__drizzle_migrations` tracking table** (neither in `drizzle` nor `public` schema). It was set up via `drizzle-kit push`, so the file-based migrator (`pnpm --filter @workspace/db run migrate`) would start at 0000 and FAIL with "relation already exists". Do NOT run `migrate` against prod.
- **Reconcile drift with targeted additive DDL instead.** Symptom that surfaced this: every `POST /api/auth/login` returned `500 "Login failed"` even for non-existent emails, because `findUserByEmail` does `db.select().from(usersTable)` over ALL columns and prod was missing `users.ministry_id` + the `ministries` table (migration 0005 never applied). Fix was applying just 0005's two statements (`CREATE TABLE ministries`, `ALTER TABLE users ADD COLUMN ministry_id`) via psql, idempotent with IF NOT EXISTS, in a transaction. Login then worked immediately with no Render redeploy.
- **General lesson:** a `db.select()` with no column args generates SQL naming every column in the *code's* schema; one missing column in the DB crashes the whole query → looks like an auth/credentials bug but is really schema drift. When a single endpoint 500s for ALL inputs (even invalid ones), suspect drift, not logic.
- Verify a drift fix by sweeping: extract `CREATE TABLE` names from `lib/db/drizzle/*.sql` and check each `to_regclass('public.<t>')` against prod (all 84 present as of June 2026).
