---
name: Production hosting (Render)
description: Where Jumerra's real production runs and why Replit-side fixes don't reach it.
---

# Production hosting

The user's REAL production site is a **Render** deployment served on a **custom domain**, NOT the Replit deployment.

**Why this matters:**
- Render builds from the GitHub repo `github.com/Jumerra/JumerraApplication` (remote `subrepl-0boii8td`).
- Render has its OWN database, separate from both Replit dev and the Replit deploy. An account that exists in the Replit DB does not exist in Render's DB.
- Env vars/secrets set in Replit do NOT propagate to Render. They must be set in the Render dashboard.

**How to apply:**
- Any production fix (data seeding, schema, env-driven behavior) must reach Render: code on GitHub `main`, then a Render deploy, plus the relevant env vars set in Render's dashboard.
- The boot-time super-admin bootstrap (artifacts/api-server/src/lib/bootstrap-super-admin.ts) only runs when BOOTSTRAP_SUPER_ADMIN_EMAIL + BOOTSTRAP_SUPER_ADMIN_PASSWORD are present in that environment — so it no-ops on Render until those vars are added there.
- We (the agent) cannot access Render directly; production seeding/verification on the live site requires user action in the Render dashboard.
