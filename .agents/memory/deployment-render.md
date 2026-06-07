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
- We (the agent) cannot access Render directly; production seeding/verification on the live site requires user action in the Render dashboard.
